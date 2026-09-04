"""
Focused API-throttling tests for the authentication endpoints (login and
token refresh).

Proves the real endpoint boundary: requests above the configured rate return
HTTP 429 before authentication work runs, and throttled responses never reveal
whether an account/company exists.
"""

from unittest import mock

from django.core.cache import cache
from django.urls import reverse

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.tests.test_authentication import (
    AuthenticationAPITestCase,
    PASSWORD,
)


class AuthenticationThrottlingTests(AuthenticationAPITestCase):
    """
    The cache is reset per test, so each test measures only its own requests
    against the production-configured rates (auth_login=10/min, auth_refresh
    =20/min), or against the small rates patched for explicit boundary checks.
    """

    def setUp(self):
        super().setUp()
        cache.clear()

    def post_login(self):
        return self.client.post(
            reverse("auth-token-obtain"),
            {
                "company_id": self.company_a.id,
                "email": "alice@example.com",
                "password": PASSWORD,
            },
            format="json",
        )

    def test_login_requests_within_rate_succeed(self):
        for _ in range(5):
            response = self.post_login()
            self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_login_exceeding_rate_returns_429(self):
        for _ in range(10):
            response = self.post_login()
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        throttled = self.post_login()
        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )
        self.assertIn("detail", throttled.json())

    def test_throttled_login_does_not_run_authentication_work(self):
        calls = []

        def fake_authenticate(*args, **kwargs):
            calls.append(True)
            return None  # generic authentication failure (401)

        with mock.patch(
            "apps.authentication.backends.CompanyEmailBackend.authenticate",
            side_effect=fake_authenticate,
        ):
            with mock.patch.object(
                SimpleRateThrottle,
                "THROTTLE_RATES",
                {"auth_login": "3/min"},
            ):
                for _ in range(3):
                    response = self.post_login()
                    self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
                throttled = self.post_login()

        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )
        # Authentication ran for the allowed requests but never for the
        # throttled one.
        self.assertEqual(len(calls), 3)

    def test_throttled_response_does_not_reveal_account_existence(self):
        for _ in range(10):
            self.post_login()
        throttled = self.client.post(
            reverse("auth-token-obtain"),
            {
                "company_id": self.company_a.id,
                "email": "ghost@example.com",
                "password": "wrong-password",
            },
            format="json",
        )
        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )
        body = str(throttled.json()).lower()
        self.assertNotIn("ghost", body)
        self.assertNotIn("@example.com", body)
        self.assertIn("detail", throttled.json())


class TokenRefreshThrottlingTests(AuthenticationAPITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.refresh_payload = {"refresh": str(RefreshToken.for_user(self.alice_a))}

    def refresh_url(self):
        return reverse("auth-token-refresh")

    def test_refresh_requests_within_rate_succeed(self):
        for _ in range(5):
            response = self.client.post(
                self.refresh_url(), self.refresh_payload, format="json"
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn("access", response.json())

    def test_refresh_exceeding_rate_returns_429(self):
        with mock.patch.object(
            SimpleRateThrottle,
            "THROTTLE_RATES",
            {"auth_refresh": "3/min"},
        ):
            for _ in range(3):
                response = self.client.post(
                    self.refresh_url(), self.refresh_payload, format="json"
                )
                self.assertEqual(response.status_code, status.HTTP_200_OK)
            throttled = self.client.post(
                self.refresh_url(), self.refresh_payload, format="json"
            )
        self.assertEqual(
            throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS
        )

    def test_valid_refresh_behavior_is_unchanged(self):
        pair = self.login_pair()
        response = self.client.post(
            self.refresh_url(), {"refresh": pair["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.json())