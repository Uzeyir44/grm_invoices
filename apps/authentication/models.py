from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.db.models import Q


class UserManager(BaseUserManager):
    """
    NOTE: email is unique per-company, not globally — see the module-level
    docstring below. Callers must supply company explicitly; there is no
    global "find this email anywhere" lookup by design.
    """

    def create_user(self, company, email, password=None, **extra_fields):
        if not company:
            raise ValueError("Users must belong to a company.")
        if not email:
            raise ValueError("Users must have an email address.")

        email = self.normalize_email(email)
        user = self.model(company=company, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """
    An employee who logs into the system. Belongs to exactly one company.

    IMPORTANT: `email` is UNIQUE PER COMPANY, not globally unique. Django's
    default ModelBackend assumes USERNAME_FIELD identifies exactly one user
    system-wide — that assumption does NOT hold here. Authentication must
    resolve `company` first (subdomain, company picker, etc.) and then look
    up (company, email) together via a custom auth backend. Do not wire this
    model into the stock ModelBackend without that backend in place.
    """

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(
        "companies.Company",
        on_delete=models.PROTECT,
        related_name="users",
        db_column="company_id",
    )
    email = models.EmailField()
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)

    is_active = models.BooleanField(default=True)
    mfa_enabled = models.BooleanField(default=False)
    mfa_secret_encrypted = models.BinaryField(
        null=True,
        blank=True,
        help_text="Encrypted at the application layer before storage.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        db_table = "users"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "email"],
                condition=Q(deleted_at__isnull=True),
                name="uq_users_company_email_active",
            ),
        ]
        indexes = [
            models.Index(
                fields=["company", "is_active"],
                name="ix_users_company_active",
            ),
        ]

    def __str__(self):
        return f"{self.email} ({self.company_id})"


class Role(models.Model):
    """
    RBAC role. company NULL = system-wide default role template
    (e.g. "Admin", "Employee") available to every tenant.
    company set = a role defined by/for that specific tenant.

    No `is_system_default` flag — deliberately removed in architecture v2 §5.1
    as redundant with `company IS NULL`. Don't reintroduce it.
    """

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(
        "companies.Company",
        on_delete=models.PROTECT,
        related_name="roles",
        db_column="company_id",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    permissions = models.ManyToManyField(
        "Permission",
        through="RolePermission",
        related_name="roles",
    )

    class Meta:
        db_table = "roles"
        constraints = [
            models.UniqueConstraint(
                fields=["name"],
                condition=Q(company__isnull=True),
                name="uq_roles_name_global",
            ),
            models.UniqueConstraint(
                fields=["company", "name"],
                condition=Q(company__isnull=False),
                name="uq_roles_company_name",
            ),
        ]

    def __str__(self):
        scope = "global" if self.company_id is None else f"company={self.company_id}"
        return f"{self.name} ({scope})"


class Permission(models.Model):
    """
    Fixed catalog of grantable actions. Defined by the application, not by
    tenants — deliberately has no company column.
    """

    id = models.BigAutoField(primary_key=True)
    code = models.CharField(
        max_length=100,
        unique=True,
        help_text="e.g. clients.delete",
    )
    description = models.CharField(max_length=255)

    class Meta:
        db_table = "permissions"

    def __str__(self):
        return self.code


class RolePermission(models.Model):
    """
    Junction: role <-> permission. Pure junction row, CASCADE both ways.
    """

    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        db_column="role_id",
    )
    permission = models.ForeignKey(
        Permission,
        on_delete=models.CASCADE,
        db_column="permission_id",
    )

    class Meta:
        db_table = "role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["role", "permission"],
                name="uq_role_permissions_pair",
            ),
        ]


class UserRole(models.Model):
    """
    Junction: user <-> role.

    NOT YET ENFORCED HERE: "a user may only be assigned a role whose
    company is NULL or matches the user's own company." Plain FKs can't
    express that (it compares two related rows), so per architecture
    v2/v3 this becomes a BEFORE INSERT/UPDATE trigger added as raw SQL
    in a migration — deliberately deferred, not forgotten.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="role_assignments",
        db_column="user_id",
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.PROTECT,
        related_name="user_assignments",
        db_column="role_id",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_roles"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "role"],
                name="uq_user_roles_pair",
            ),
        ]