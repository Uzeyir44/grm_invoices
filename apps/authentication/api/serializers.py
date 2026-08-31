from django.contrib.auth import authenticate
from rest_framework import exceptions, serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings

from apps.authentication.models import User


class CompanyTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Issues a JWT access/refresh pair for a (company, email) + password login.

    ``company_id`` is a login-time lookup key used to locate the user row
    (email is unique per company, not globally). It is never echoed back as
    an authorization decision — the authenticated user and their company are
    authoritative once ``request.user`` is set.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["company_id"] = serializers.IntegerField(write_only=True)

    def validate(self, attrs):
        authenticate_kwargs = {
            self.username_field: attrs[self.username_field],
            "password": attrs["password"],
            "company_id": attrs["company_id"],
        }
        try:
            authenticate_kwargs["request"] = self.context["request"]
        except KeyError:
            pass

        self.user = authenticate(**authenticate_kwargs)

        if not api_settings.USER_AUTHENTICATION_RULE(self.user):
            raise exceptions.AuthenticationFailed(
                self.error_messages["no_active_account"],
                "no_active_account",
            )

        data = {}
        refresh = self.get_token(self.user)
        data["refresh"] = str(refresh)
        data["access"] = str(refresh.access_token)
        return data

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["company_id"] = user.company_id
        return token


class MeSerializer(serializers.ModelSerializer):
    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.display_name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "mfa_enabled",
            "company_id",
            "company_name",
        ]