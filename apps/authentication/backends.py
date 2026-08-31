from django.contrib.auth.backends import BaseBackend

from apps.authentication.models import User
from apps.companies.models import Company

# Companies in these statuses may authenticate. TRIAL is a legitimate tenant
# state; SUSPENDED/CANCELLED must never produce a working session.
AUTHENTICATABLE_COMPANY_STATUSES = frozenset(
    {Company.Status.TRIAL, Company.Status.ACTIVE}
)


def active_user_rule(user):
    """
    Returns True only when ``user`` may authenticate against the system right
    now: the account is not a soft-deleted/inactive user and the owning
    company is not soft-deleted and not in a non-authenticatable status.

    Used both by the login backend and by the JWT layers (token issue,
    refresh, and every authenticated request via CompanyJWTAuthentication).
    """
    if user is None:
        return False
    if not user.is_active:
        return False
    if user.deleted_at is not None:
        return False

    company = user.company
    if company is None:
        return False
    if company.deleted_at is not None:
        return False
    return company.status in AUTHENTICATABLE_COMPANY_STATUSES


class CompanyEmailBackend(BaseBackend):
    """
    Authenticates a user by (company, email) + password.

    Email is unique per company, not globally, so the company identifier is a
    login-time lookup *scope only*: it is used to find the single matching
    user row and is never treated as trusted authorization anywhere else
    (authorization derives from request.user after authentication).

    Django's stock ModelBackend is intentionally not used — it assumes a
    globally unique username and would break tenant isolation.
    """

    def authenticate(self, request, company_id=None, email=None, password=None):
        if company_id is None or not email or password is None:
            return None

        try:
            user = User.objects.get(company_id=company_id, email__iexact=email)
        except (User.DoesNotExist, User.MultipleObjectsReturned):
            return None

        if not user.check_password(password):
            return None

        if not active_user_rule(user):
            return None

        return user

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None