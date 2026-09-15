"""
Serializers for System Admin global user management.

Read serializers expose only administratively useful, non-secret user data
(identity, company, lifecycle, roles). The update serializer restricts the
editable surface to ``first_name`` / ``last_name`` / ``email`` — company,
password hash, MFA secret, lifecycle flags, and soft-delete internals are not
writable here.
"""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.authentication.models import Role, Scope, User
from apps.companies.models import Company
from apps.system_admin.user_management import assignable_roles_for_user

#: The administratively editable User fields (PATCH).
USER_INPUT_FIELDS = ["first_name", "last_name", "email"]


class AdminUserRoleSerializer(serializers.ModelSerializer):
    """Read-only representation of a role assigned to (or assignable to) a user."""

    class Meta:
        model = Role
        fields = ["id", "name", "scope"]
        read_only_fields = fields


class AdminUserSerializer(serializers.ModelSerializer):
    """Read-only representation of an ordinary tenant user."""

    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(
        source="company.display_name", read_only=True
    )
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "company_id",
            "company_name",
            "deleted_at",
            "created_at",
            "updated_at",
            "roles",
        ]
        read_only_fields = fields

    def get_roles(self, obj):
        return [
            {"id": assignment.role.id, "name": assignment.role.name}
            for assignment in obj.role_assignments.all()
        ]


class AdminUserDetailSerializer(AdminUserSerializer):
    """
    Detail adds the user's company's assignable tenant roles so the Admin UI can
    offer a role picker. It lists existing roles only — it does not manage them.
    """

    company_roles = serializers.SerializerMethodField()

    class Meta(AdminUserSerializer.Meta):
        fields = AdminUserSerializer.Meta.fields + ["company_roles"]
        read_only_fields = fields

    def get_company_roles(self, obj):
        return [
            {"id": role.id, "name": role.name}
            for role in assignable_roles_for_user(obj)
        ]


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    """Partial update of the administratively editable user fields."""

    class Meta:
        model = User
        fields = USER_INPUT_FIELDS

    def validate_email(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Email is required.")
        # Email is unique per company for non-deleted users, not globally.
        queryset = User.objects.filter(
            company_id=self.instance.company_id,
            email__iexact=value,
            deleted_at__isnull=True,
        )
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError(
                "A user with this email already exists in this company."
            )
        return value


class AdminUserCompanyChoiceSerializer(serializers.ModelSerializer):
    """Safe company and tenant-role choices for new-user creation."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = ["id", "legal_name", "display_name", "roles"]
        read_only_fields = fields

    def get_roles(self, obj):
        return list(
            Role.objects.filter(company=obj, scope=Scope.TENANT)
            .order_by("name", "id")
            .values("id", "name")
        )


class AdminUserCreateSerializer(serializers.Serializer):
    """Input for creating an ordinary tenant user."""

    company_id = serializers.PrimaryKeyRelatedField(
        source="company",
        queryset=Company.objects.filter(
            is_platform=False, deleted_at__isnull=True
        ),
    )
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list
    )

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate(self, attrs):
        company = attrs["company"]
        email = attrs["email"].strip()
        if User.objects.filter(
            company=company, email__iexact=email, deleted_at__isnull=True
        ).exists():
            raise serializers.ValidationError(
                {"email": "A user with this email already exists in this company."}
            )
        attrs["email"] = email
        return attrs


class AdminUserRoleAssignSerializer(serializers.Serializer):
    """Body for assigning a tenant role to a user."""

    role_id = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), source="role"
    )
