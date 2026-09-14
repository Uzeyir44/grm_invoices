"""
Serializers for System Admin RBAC role & permission management.

Scopes are always exposed explicitly. ``scope``, ``company``, and every
lifecycle field are read-only when returned; the create/update serializers
never accept ``scope`` (the backend always creates tenant roles) or a company
change.
"""

from rest_framework import serializers

from apps.authentication.models import Permission, Role, Scope
from apps.companies.models import Company
from apps.system_admin.role_management import tenant_permissions_queryset


class AdminPermissionSerializer(serializers.ModelSerializer):
    """Read-only representation of a permission catalog entry."""

    class Meta:
        model = Permission
        fields = ["id", "code", "description", "scope"]
        read_only_fields = fields


class AdminRoleListSerializer(serializers.ModelSerializer):
    """Read-only role summary for the global role list."""

    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.SerializerMethodField()
    permission_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "company_id",
            "company_name",
            "scope",
            "permission_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_company_name(self, obj):
        return obj.company.display_name if obj.company_id else None


class AdminRoleDetailSerializer(serializers.ModelSerializer):
    """
    Role identity, scope, company, and permissions.

    ``available_permissions`` lists the company's assignable tenant permissions
    (empty for protected system roles) so the Admin UI can offer a picker.
    """

    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.SerializerMethodField()
    permissions = AdminPermissionSerializer(many=True, read_only=True)
    available_permissions = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "company_id",
            "company_name",
            "scope",
            "created_at",
            "permissions",
            "available_permissions",
        ]
        read_only_fields = fields

    def get_company_name(self, obj):
        return obj.company.display_name if obj.company_id else None

    def get_available_permissions(self, obj):
        if obj.scope != Scope.TENANT:
            return []
        assigned_ids = set(obj.permissions.values_list("id", flat=True))
        remaining = tenant_permissions_queryset().exclude(id__in=assigned_ids)
        return AdminPermissionSerializer(remaining, many=True).data


class AdminRoleCreateSerializer(serializers.Serializer):
    """Create a tenant role for a specific company."""

    company_id = serializers.PrimaryKeyRelatedField(
        queryset=Company.objects.all(), source="company"
    )
    name = serializers.CharField(max_length=100)

    def validate_company(self, company):
        if company.deleted_at is not None:
            raise serializers.ValidationError("The selected company is not active.")
        if company.is_platform:
            raise serializers.ValidationError(
                "Tenant roles cannot be created for the platform company."
            )
        return company

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("A role name is required.")
        return value


class AdminRoleUpdateSerializer(serializers.Serializer):
    """Update a tenant role's name (scope and company are immutable)."""

    name = serializers.CharField(max_length=100)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("A role name is required.")
        return value


class AdminRolePermissionAssignSerializer(serializers.Serializer):
    """Body for assigning a permission to a role."""

    permission_id = serializers.PrimaryKeyRelatedField(
        queryset=Permission.objects.all(), source="permission"
    )


class AdminPermissionQuerySerializer(serializers.Serializer):
    """Validated query parameters for the permission catalog."""

    scope = serializers.ChoiceField(choices=Scope.choices, required=False)


class AdminRoleQuerySerializer(serializers.Serializer):
    """Validated query parameters for the role list."""

    scope = serializers.ChoiceField(choices=Scope.choices, required=False)
    company_id = serializers.IntegerField(required=False)
