from django.db import models

from companies.models import Company
from authentication.models import User


class AuditLog(models.Model):
    """
    Append-only audit trail. Deliberately has no `updated_at`/`deleted_at`
    — audit rows are immutable by design, not soft-deletable business data.

    NOT MODELED HERE (deferred raw-SQL migration):
      - Composite FK (user_id, company_id) -> users(id, company_id), so a
        Company-A audit log can never be attributed to a Company-B user.
      - A BEFORE UPDATE OR DELETE trigger that raises an exception, as a
        second line of defense independent of role grants (architecture
        v1 §8).
      - Database-level GRANT/REVOKE so the application's normal runtime
        role has INSERT/SELECT only on this table — no UPDATE/DELETE.
        This is an infrastructure/ops concern, not something Django
        migrations typically express, but it belongs in the same
        deployment checklist as the trigger above.

    `on_delete=PROTECT` on `company`: audit history must outlive normal
    company lifecycle events — a company is deactivated via
    `deleted_at`/`status`, never physically deleted, so this should never
    actually fire in practice, but it's the correct safety net if it ever
    would.
    """

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey(
        Company,
        on_delete=models.PROTECT,
        related_name="audit_logs",
        db_column="company_id",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,  # deleting a user must never delete their audit trail
        null=True,
        blank=True,
        related_name="audit_logs",
        db_column="user_id",
    )

    action = models.CharField(max_length=100, help_text="e.g. client.created, user.role_changed")
    entity_type = models.CharField(max_length=100, help_text="e.g. client, generated_document")
    entity_id = models.BigIntegerField()

    previous_values = models.JSONField(null=True, blank=True)
    new_values = models.JSONField(null=True, blank=True)

    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)

    request_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="Optional correlation ID tying multiple audit rows to one "
        "operation (architecture v4 §0 item 13). Not required for v1.",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_logs"
        indexes = [
            models.Index(fields=["company", "-created_at"], name="ix_audit_company_created"),
            models.Index(
                fields=["company", "entity_type", "entity_id"], name="ix_audit_company_entity"
            ),
            models.Index(fields=["user"], name="ix_audit_user"),
            models.Index(fields=["request_id"], name="ix_audit_request_id"),
        ]

    def __str__(self):
        return f"{self.action} on {self.entity_type}:{self.entity_id}"