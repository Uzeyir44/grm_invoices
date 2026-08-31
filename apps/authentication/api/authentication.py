from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken

from apps.authentication.backends import active_user_rule


class CompanyJWTAuthentication(JWTAuthentication):
    """
    JWT authentication that also re-validates, on every authenticated request,
    that the token's user is still active and still belongs to an
    authenticatable company. This is what turns off access for a user whose
    account was deactivated — or whose company was suspended — after their
    token was issued.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not active_user_rule(user):
            raise InvalidToken("No active account for this token.")
        return user