from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken


class SystemAdminJWTAuthentication(JWTAuthentication):
    """
    JWT authentication for the ``/api/admin/*`` boundary.

    It intentionally does **not** call ``active_user_rule()``: that rule is
    gated on the owning company's status, and platform administration must
    remain possible regardless of tenant status. It still enforces that the
    privileged account itself is active and not soft-deleted.

    This class establishes only *who* the principal is. The explicit platform
    token claim and the reserved system role are enforced by
    :class:`apps.system_admin.permissions.IsSystemAdmin`.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if user is None or not user.is_active or user.deleted_at is not None:
            raise InvalidToken("No active account for this token.")
        return user
