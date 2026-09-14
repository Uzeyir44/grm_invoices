"""
Scoped-RBAC database enforcement (System Admin Phase 1).

Two invariants that Django's ORM cannot express over a junction table, added as
raw SQL in the same style as ``0002_raw_sql_constraints.py``:

1. ``trg_role_permission_scope_match`` — a role may only hold permissions of
   its own scope (``roles.scope = permissions.scope``). This is what makes the
   tenant/system split structural rather than a naming convention: a tenant
   role can never be given a ``system.*`` permission, and vice versa.

2. ``trg_system_role_platform_only`` — a system-scoped role may only be
   assigned to a user whose company is the reserved platform company. This
   prevents a tenant user from ever receiving System Admin privileges through
   ordinary role assignment.

The application layer (``apps/authentication/rbac.py``) filters by scope as the
primary guard; these triggers are the authoritative database backstop.
"""

from django.db import migrations

FORWARD_SQL = """
CREATE OR REPLACE FUNCTION enforce_role_permission_scope_match()
RETURNS trigger AS $$
DECLARE
  v_role_scope varchar;
  v_permission_scope varchar;
BEGIN
  SELECT scope INTO v_role_scope FROM roles WHERE id = NEW.role_id;
  SELECT scope INTO v_permission_scope FROM permissions WHERE id = NEW.permission_id;

  IF v_role_scope IS DISTINCT FROM v_permission_scope THEN
    RAISE EXCEPTION
      'role scope % cannot hold permission scope % (role_id=%, permission_id=%)',
      v_role_scope, v_permission_scope, NEW.role_id, NEW.permission_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_role_permission_scope_match ON role_permissions;
CREATE TRIGGER trg_role_permission_scope_match
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_scope_match();

CREATE OR REPLACE FUNCTION enforce_system_role_platform_only()
RETURNS trigger AS $$
DECLARE
  v_role_scope varchar;
  v_is_platform boolean;
BEGIN
  SELECT scope INTO v_role_scope FROM roles WHERE id = NEW.role_id;

  IF v_role_scope = 'system' THEN
    SELECT c.is_platform INTO v_is_platform
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE u.id = NEW.user_id;

    IF v_is_platform IS NOT TRUE THEN
      RAISE EXCEPTION
        'system role % can only be assigned to a platform-company user (user_id=%)',
        NEW.role_id, NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_system_role_platform_only ON user_roles;
CREATE TRIGGER trg_system_role_platform_only
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_system_role_platform_only();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS trg_system_role_platform_only ON user_roles;
DROP FUNCTION IF EXISTS enforce_system_role_platform_only();

DROP TRIGGER IF EXISTS trg_role_permission_scope_match ON role_permissions;
DROP FUNCTION IF EXISTS enforce_role_permission_scope_match();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("database", "0003_allow_generated_pdf_path_update"),
        ("authentication", "0008_permission_scope_role_scope_and_more"),
        ("companies", "0002_company_is_platform_and_more"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
