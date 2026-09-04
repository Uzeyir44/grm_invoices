import uuid
from datetime import timedelta

from django.conf import settings
from django.urls import reverse
from django.utils import timezone

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.authentication.models import User
from apps.companies.models import Company

PASSWORD = "Str0ng-pass-123!"


def make_company(status_=Company.Status.ACTIVE):
    suffix = uuid.uuid4().hex[:10]
    return Company.objects.create(
        legal_name=f"Legal {suffix}",
        display_name=f"Display {suffix}",
        status=status_,
    )


def make_user(
    company,
    email=None,
    password=PASSWORD,
    is_active=True,
    first_name="Test",
    last_name="User",
):
    user = User.objects.create_user(
        company=company,
        email=email or f"{uuid.uuid4().hex[:10]}@example.com",
        password=password,
        first_name=first_name,
        last_name=last_name,
    )
    if not is_active:
        user.is_active = False
        user.save(update_fields=["is_active"])
    return user


class AuthenticationAPITestCase(APITestCase):
    def setUp(self):
        # Login/refresh throttles key on the client IP (shared by every test),
        # so reset the throttle cache to keep each test deterministic.
        from django.core.cache import cache

        cache.clear()
        self.company_a = make_company()
        self.company_b = make_company()
        self.alice_a = make_user(self.company_a, email="alice@example.com")
        self.alice_b = make_user(self.company_b, email="alice@example.com")
        self.bob_a = make_user(self.company_a, email="bob@example.com")

    def post_login(self, company_id, email, password=PASSWORD):
        return self.client.post(
            reverse("auth-token-obtain"),
            {"company_id": company_id, "email": email, "password": password},
            format="json",
        )

    def login_pair(self):
        response = self.post_login(self.company_a.id, "alice@example.com", PASSWORD)
        return response.json()

    def get_me(self, access_token=None, query=None):
        url = reverse("auth-me")
        if query:
            url = f"{url}?{query}"
        if access_token is None:
            return self.client.get(url)
        return self.client.get(url, HTTP_AUTHORIZATION=f"Bearer {access_token}")


class CompanyLoginTests(AuthenticationAPITestCase):
    def test_login_success_returns_token_pair(self):
        response = self.post_login(self.company_a.id, "alice@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("access", data)
        self.assertIn("refresh", data)

        access = AccessToken(data["access"])
        self.assertEqual(access["user_id"], str(self.alice_a.id))
        self.assertEqual(access["company_id"], self.company_a.id)

    def test_login_wrong_password_is_rejected(self):
        response = self.post_login(self.company_a.id, "alice@example.com", "wrong-pass")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_nonexistent_user_is_rejected(self):
        response = self.post_login(self.company_a.id, "ghost@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_nonexistent_company_is_rejected(self):
        response = self.post_login(10**9, "alice@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_inactive_user_is_rejected(self):
        make_user(self.company_a, email="inactive@example.com", is_active=False)
        response = self.post_login(self.company_a.id, "inactive@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_suspended_company_is_rejected(self):
        suspended = make_company(status_=Company.Status.SUSPENDED)
        make_user(suspended, email="carol@example.com")
        response = self.post_login(suspended.id, "carol@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_cancelled_company_is_rejected(self):
        cancelled = make_company(status_=Company.Status.CANCELLED)
        make_user(cancelled, email="erin@example.com")
        response = self.post_login(cancelled.id, "erin@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_trial_company_is_allowed(self):
        trial = make_company(status_=Company.Status.TRIAL)
        make_user(trial, email="dave@example.com")
        response = self.post_login(trial.id, "dave@example.com", PASSWORD)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_login_wrong_company_context_is_rejected(self):
        bob_belongs_to_a = self.post_login(
            self.company_b.id, "bob@example.com", PASSWORD
        )
        self.assertEqual(bob_belongs_to_a.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_same_email_in_two_companies_logs_into_correct_company(self):
        response_a = self.post_login(self.company_a.id, "alice@example.com", PASSWORD)
        self.assertEqual(
            AccessToken(response_a.json()["access"])["user_id"], str(self.alice_a.id)
        )
        response_b = self.post_login(self.company_b.id, "alice@example.com", PASSWORD)
        self.assertEqual(
            AccessToken(response_b.json()["access"])["user_id"], str(self.alice_b.id)
        )

    def test_login_email_is_case_insensitive(self):
        response = self.post_login(
            self.company_a.id, "ALICE@example.COM", PASSWORD
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            AccessToken(response.json()["access"])["user_id"], str(self.alice_a.id)
        )

    def test_login_missing_fields_returns_400(self):
        response = self.client.post(reverse("auth-token-obtain"), {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_failures_return_identical_generic_error(self):
        wrong_password = self.post_login(
            self.company_a.id, "bob@example.com", "wrong-pass"
        )
        nonexistent_user = self.post_login(
            self.company_a.id, "ghost@example.com", PASSWORD
        )
        wrong_company = self.post_login(
            self.company_b.id, "bob@example.com", PASSWORD
        )
        self.assertEqual(wrong_password.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(wrong_password.json(), nonexistent_user.json())
        self.assertEqual(wrong_password.json(), wrong_company.json())


class CompanyTokenTests(AuthenticationAPITestCase):
    def test_refresh_returns_new_access_token(self):
        pair = self.login_pair()
        response = self.client.post(
            reverse("auth-token-refresh"),
            {"refresh": pair["refresh"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.json())
        self.assertEqual(
            AccessToken(response.json()["access"])["user_id"], str(self.alice_a.id)
        )

    def test_refresh_invalid_token_is_rejected(self):
        response = self.client.post(
            reverse("auth-token-refresh"),
            {"refresh": "not-a-token"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_verify_valid_token(self):
        pair = self.login_pair()
        response = self.client.post(
            reverse("auth-token-verify"),
            {"token": pair["access"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_verify_invalid_token_is_rejected(self):
        response = self.client.post(
            reverse("auth-token-verify"), {"token": "garbage"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_verify_expired_token_is_rejected(self):
        token = AccessToken.for_user(self.alice_a)
        token["exp"] = (timezone.now() - timedelta(minutes=1)).timestamp()
        response = self.client.post(
            reverse("auth-token-verify"), {"token": str(token)}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class MeEndpointTests(AuthenticationAPITestCase):
    def test_me_requires_authentication(self):
        response = self.get_me()
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_safe_user_info(self):
        access = self.login_pair()["access"]
        response = self.get_me(access)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["id"], self.alice_a.id)
        self.assertEqual(data["email"], "alice@example.com")
        self.assertEqual(data["first_name"], "Test")
        self.assertEqual(data["last_name"], "User")
        self.assertIs(data["is_active"], True)
        self.assertEqual(data["company_id"], self.company_a.id)
        self.assertEqual(data["company_name"], self.company_a.display_name)

    def test_me_never_exposes_password(self):
        access = self.login_pair()["access"]
        self.assertNotIn("password", self.get_me(access).json())

    def test_me_invalid_token_is_rejected(self):
        response = self.get_me("garbage-token")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_tampered_token_is_rejected(self):
        access = str(AccessToken.for_user(self.alice_a))
        response = self.get_me(f"{access}x")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_expired_token_is_rejected(self):
        token = AccessToken.for_user(self.alice_a)
        token["exp"] = (timezone.now() - timedelta(minutes=1)).timestamp()
        response = self.get_me(str(token))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_access_revoked_when_company_suspended(self):
        access = str(AccessToken.for_user(self.alice_a))
        self.company_a.status = Company.Status.SUSPENDED
        self.company_a.save(update_fields=["status"])
        response = self.get_me(access)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_access_revoked_when_user_deactivated(self):
        access = str(AccessToken.for_user(self.alice_a))
        self.alice_a.is_active = False
        self.alice_a.save(update_fields=["is_active"])
        response = self.get_me(access)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_token_user_ignoring_query_parameters(self):
        access = str(AccessToken.for_user(self.alice_a))
        response = self.get_me(
            access,
            query=f"user_id={self.alice_b.id}&company_id={self.company_b.id}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["id"], self.alice_a.id)
        self.assertEqual(data["company_id"], self.company_a.id)


class CompanyIsolationTests(AuthenticationAPITestCase):
    def test_each_user_sees_only_their_company(self):
        access_a = str(AccessToken.for_user(self.alice_a))
        access_b = str(AccessToken.for_user(self.alice_b))

        data_a = self.get_me(access_a).json()
        self.assertEqual(data_a["company_id"], self.company_a.id)
        self.assertEqual(data_a["id"], self.alice_a.id)

        data_b = self.get_me(access_b).json()
        self.assertEqual(data_b["company_id"], self.company_b.id)
        self.assertEqual(data_b["id"], self.alice_b.id)

    def test_company_b_token_never_resolves_to_company_a_context(self):
        access_b = str(AccessToken.for_user(self.alice_b))
        data = self.get_me(access_b).json()
        self.assertNotEqual(data["company_id"], self.company_a.id)


class PasswordSecurityTests(AuthenticationAPITestCase):
    def test_password_is_stored_hashed_not_plaintext(self):
        user = make_user(self.company_a, email="hash@example.com", password=PASSWORD)
        self.assertNotEqual(user.password, PASSWORD)
        self.assertNotIn(PASSWORD, user.password)
        self.assertTrue(user.password.startswith("pbkdf2_sha256$"))
        self.assertTrue(user.check_password(PASSWORD))
        self.assertFalse(user.check_password("wrong-password"))

    def test_login_response_contains_no_password_data(self):
        response = self.post_login(self.company_a.id, "alice@example.com", PASSWORD)
        payload = response.json()
        self.assertNotIn("password", payload)
        self.assertNotIn("hash", payload)
        self.assertNotIn("mfa_secret_encrypted", payload)

    def test_me_response_contains_no_password_data(self):
        access = str(AccessToken.for_user(self.alice_a))
        payload = self.get_me(access).json()
        self.assertNotIn("password", payload)
        self.assertNotIn("hash", payload)
        self.assertNotIn("mfa_secret_encrypted", payload)

    def test_stock_model_backend_is_not_used(self):
        backends = settings.AUTHENTICATION_BACKENDS
        self.assertNotIn("django.contrib.auth.backends.ModelBackend", backends)
        self.assertIn(
            "apps.authentication.backends.CompanyEmailBackend", backends
        )


class TokenRefreshLifetimeTests(AuthenticationAPITestCase):
    def test_refresh_token_can_obtain_new_access(self):
        pair = self.login_pair()
        response = self.client.post(
            reverse("auth-token-refresh"),
            {"refresh": pair["refresh"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.json())

    def test_login_issued_tokens_carry_company_claim(self):
        pair = self.login_pair()
        access = AccessToken(pair["access"])
        refresh = RefreshToken(pair["refresh"])
        self.assertEqual(access["user_id"], str(self.alice_a.id))
        self.assertEqual(access["company_id"], self.company_a.id)
        self.assertEqual(refresh["company_id"], self.company_a.id)

    def test_user_id_claim_is_a_string(self):
        token = AccessToken.for_user(self.alice_a)
        self.assertEqual(token["user_id"], str(self.alice_a.id))