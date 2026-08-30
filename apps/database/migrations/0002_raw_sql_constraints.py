"""
Consolidated tenant-integrity migration.

Everything here was deliberately deferred from models.py because Django's
ORM cannot express it natively:
  - composite foreign keys (a FK against two columns together)
  - triggers of any kind

This migration must run AFTER every table it references already exists.
Update the `dependencies` list below to point at your actual initial
migrations for each app before running this — and verify the actual
Django-generated table/column names match what this file assumes
(clients, client_legal_entities, client_individuals, document_templates,
template_versions, generated_documents, generated_document_versions,
document_line_items, audit_logs, roles, user_roles, users) before applying
against real data.

btree_gist is intentionally NOT created here — it belongs in
reference_data's own initial migration, immediately before the VatRate
ExclusionConstraint that needs it (see reference_data_migration_fix_notes.py).
Creating it here was a real ordering bug in the previous draft: this
migration depends on reference_data, so if reference_data's migration
already needs the extension to create its constraint, this migration is
too late to provide it.

Sections, in order:
  1. UNIQUE(id, company_id) supporting keys — composite-FK targets
  2. Composite FKs proving copied company_id values actually match
  3. company_id immutability — copied-company_id tables, PLUS users, roles,
     AND the three root tenant-owned tables (clients, document_templates,
     generated_documents). The rule this section enforces, in full: once
     any entity belongs to a company, it never changes companies — no
     exceptions, root or dependent.
  4. Client subtype exclusivity — both directions
  5. RBAC: user_roles company-match trigger
  6. Version/line-item immutability (INSERT-only)
  7. audit_logs immutability

NOTE ON CLIENT TYPE CONVERSION: converting a client between legal_entity
and individual is deliberately NOT made "smart" by the triggers below.
The only supported workflow, done in one transaction, is:
  DELETE the old subtype row -> UPDATE clients.client_type -> INSERT the
  new subtype row. Trying to make the triggers auto-convert would add
  complexity for a rare operation; this is a documented procedure instead.

  Concurrency note: this migration does NOT add a trigger to guard against
  two concurrent transactions racing this same conversion — that's an
  application/service-layer concern, not a schema one. The service
  performing a conversion should `SELECT ... FROM clients WHERE id = :id
  FOR UPDATE` first, then do the delete/update/insert inside that same
  locked transaction, so a second concurrent conversion attempt blocks
  until the first commits rather than interleaving with it.

NOTE ON ROOT company_id IMMUTABILITY (clients, document_templates,
generated_documents): before this fix, a childless row (e.g. a brand-new
client with no addresses/contacts/bank-accounts yet) could have its
company_id changed with nothing to stop it, since the composite FKs only
protect rows that already have tenant-owned children. A row WITH children
was always safe — the composite FK from the child would already reject
the parent's company_id changing out from under it — but "safe only once
it has dependents" isn't the guarantee we want. The rule is now
unconditional: once an entity belongs to a company, it never changes
companies, whether or not it has dependents yet.

NOTE ON ROLE SCOPE: because roles.company_id is immutable, a role can
never transition between global (NULL) and company-specific, in either
direction. This is intentional, not a limitation to work around — a
role's scope is meant to be stable for its lifetime. If you want a
company-specific variant of a global role, create a new Role row; don't
mutate an existing one's scope.

NOTE ON audit_logs.user_id: it is nullable by design. A NULL here means
a system-generated or background-job audit event with no attributable
human user — not a data-quality gap.

NOTE ON DB ROLE PERMISSIONS (deployment concern, not expressed in this
migration): the triggers in sections 3 and 6 are a second line of
defense, not the only one. The application's runtime database role should
itself be restricted so it can INSERT new versions/line items but cannot
UPDATE or DELETE them at all — that way an application bug can't even
attempt the forbidden operation; the trigger only needs to catch what
role-level grants somehow missed. Configure this at deployment time
alongside the trigger, not instead of it.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0001_initial"),
        ("authentication", "0001_initial"),
        ("reference_data", "0001_initial"),
        ("clients", "0001_initial"),
        ("document_templates", "0001_initial"),
        ("company_document_counters", "0001_initial"),
        ("generated_documents", "0001_initial"),
        ("audit_logs", "0001_initial"),
    ]

    operations = [
        # ------------------------------------------------------------------
        # 1. Supporting UNIQUE(id, company_id) keys — every table that is
        #    the TARGET of a composite FK from a table further down the
        #    tenant chain needs this. (Single-column PKs already cover
        #    plain single-column FK targets, so `companies` itself doesn't
        #    need one here.)
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE clients
                  ADD CONSTRAINT uq_clients_id_company UNIQUE (id, company_id);
                ALTER TABLE users
                  ADD CONSTRAINT uq_users_id_company UNIQUE (id, company_id);
                ALTER TABLE document_templates
                  ADD CONSTRAINT uq_document_templates_id_company UNIQUE (id, company_id);
                ALTER TABLE template_versions
                  ADD CONSTRAINT uq_template_versions_id_company UNIQUE (id, company_id);
                ALTER TABLE generated_documents
                  ADD CONSTRAINT uq_generated_documents_id_company UNIQUE (id, company_id);
                ALTER TABLE generated_document_versions
                  ADD CONSTRAINT uq_generated_document_versions_id_company UNIQUE (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE generated_document_versions DROP CONSTRAINT uq_generated_document_versions_id_company;
                ALTER TABLE generated_documents DROP CONSTRAINT uq_generated_documents_id_company;
                ALTER TABLE template_versions DROP CONSTRAINT uq_template_versions_id_company;
                ALTER TABLE document_templates DROP CONSTRAINT uq_document_templates_id_company;
                ALTER TABLE users DROP CONSTRAINT uq_users_id_company;
                ALTER TABLE clients DROP CONSTRAINT uq_clients_id_company;
            """,
        ),
        # ------------------------------------------------------------------
        # 2. Composite FKs — client subtype tables
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE client_legal_entities
                  ADD CONSTRAINT fk_legalentity_client_same_company
                  FOREIGN KEY (client_id, company_id) REFERENCES clients (id, company_id);
                ALTER TABLE client_individuals
                  ADD CONSTRAINT fk_individual_client_same_company
                  FOREIGN KEY (client_id, company_id) REFERENCES clients (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE client_individuals DROP CONSTRAINT fk_individual_client_same_company;
                ALTER TABLE client_legal_entities DROP CONSTRAINT fk_legalentity_client_same_company;
            """,
        ),
        # ------------------------------------------------------------------
        # Composite FKs — template_versions
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE template_versions
                  ADD CONSTRAINT fk_templversion_template_same_company
                  FOREIGN KEY (template_id, company_id) REFERENCES document_templates (id, company_id);
                ALTER TABLE template_versions
                  ADD CONSTRAINT fk_templversion_creator_same_company
                  FOREIGN KEY (created_by_user_id, company_id) REFERENCES users (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE template_versions DROP CONSTRAINT fk_templversion_creator_same_company;
                ALTER TABLE template_versions DROP CONSTRAINT fk_templversion_template_same_company;
            """,
        ),
        # ------------------------------------------------------------------
        # Composite FKs — generated_documents
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE generated_documents
                  ADD CONSTRAINT fk_gendoc_client_same_company
                  FOREIGN KEY (client_id, company_id) REFERENCES clients (id, company_id);
                ALTER TABLE generated_documents
                  ADD CONSTRAINT fk_gendoc_template_same_company
                  FOREIGN KEY (template_id, company_id) REFERENCES document_templates (id, company_id);
                ALTER TABLE generated_documents
                  ADD CONSTRAINT fk_gendoc_creator_same_company
                  FOREIGN KEY (created_by_user_id, company_id) REFERENCES users (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE generated_documents DROP CONSTRAINT fk_gendoc_creator_same_company;
                ALTER TABLE generated_documents DROP CONSTRAINT fk_gendoc_template_same_company;
                ALTER TABLE generated_documents DROP CONSTRAINT fk_gendoc_client_same_company;
            """,
        ),
        # ------------------------------------------------------------------
        # Composite FKs — generated_document_versions (the gap the v3
        # review round specifically closed)
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE generated_document_versions
                  ADD CONSTRAINT fk_gdv_document_same_company
                  FOREIGN KEY (generated_document_id, company_id) REFERENCES generated_documents (id, company_id);
                ALTER TABLE generated_document_versions
                  ADD CONSTRAINT fk_gdv_templversion_same_company
                  FOREIGN KEY (template_version_id, company_id) REFERENCES template_versions (id, company_id);
                ALTER TABLE generated_document_versions
                  ADD CONSTRAINT fk_gdv_generator_same_company
                  FOREIGN KEY (generated_by_user_id, company_id) REFERENCES users (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE generated_document_versions DROP CONSTRAINT fk_gdv_generator_same_company;
                ALTER TABLE generated_document_versions DROP CONSTRAINT fk_gdv_templversion_same_company;
                ALTER TABLE generated_document_versions DROP CONSTRAINT fk_gdv_document_same_company;
            """,
        ),
        # ------------------------------------------------------------------
        # Composite FK — document_line_items
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE document_line_items
                  ADD CONSTRAINT fk_lineitem_version_same_company
                  FOREIGN KEY (generated_document_version_id, company_id)
                  REFERENCES generated_document_versions (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE document_line_items DROP CONSTRAINT fk_lineitem_version_same_company;
            """,
        ),
        # ------------------------------------------------------------------
        # Composite FK — audit_logs
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                ALTER TABLE audit_logs
                  ADD CONSTRAINT fk_audit_user_same_company
                  FOREIGN KEY (user_id, company_id) REFERENCES users (id, company_id);
            """,
            reverse_sql="""
                ALTER TABLE audit_logs DROP CONSTRAINT fk_audit_user_same_company;
            """,
        ),
        # ------------------------------------------------------------------
        # 3. company_id immutability. Three groups:
        #      (a) tables with a COPIED company_id (as before)
        #      (b) users.company_id and roles.company_id — NOT copies, but
        #          made immutable to close a real hole: the user_roles
        #          trigger in section 5 only fires when a user_roles row
        #          itself is inserted/updated. If a user's or a role's
        #          company_id could change AFTER an assignment already
        #          exists, that assignment would silently go stale — e.g.
        #          User A (company 1) reassigned to company 2 while still
        #          holding Role X (company 1) would leave a cross-company
        #          assignment the trigger never re-checks. Making both
        #          columns immutable is simpler than adding a second
        #          trigger to re-validate every existing assignment.
        #      (c) clients.company_id, document_templates.company_id,
        #          generated_documents.company_id — the three ROOT
        #          tenant-owned tables. Composite FKs from dependents
        #          already prevented a company_id change on a row that
        #          HAS dependents; this closes the gap for a childless
        #          row, making "an entity never changes companies"
        #          unconditional rather than dependent-count-dependent.
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                CREATE OR REPLACE FUNCTION prevent_company_id_change()
                RETURNS trigger AS $$
                BEGIN
                  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
                    RAISE EXCEPTION 'company_id is immutable on %', TG_TABLE_NAME;
                  END IF;
                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON client_legal_entities
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON client_individuals
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON client_addresses
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON client_contacts
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON client_bank_accounts
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON template_versions
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON generated_document_versions
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON document_line_items
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();

                -- (b) not copies, but locked down to keep the RBAC
                -- guarantee in section 5 true for the lifetime of a row,
                -- not just at the moment an assignment is made.
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON users
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON roles
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();

                -- (c) the three root tenant-owned tables. Composite FKs
                -- from dependents already blocked a company_id change on
                -- a row THAT HAS dependents; this closes the remaining
                -- gap for a childless row (e.g. a brand-new client with
                -- no addresses/contacts yet), making the rule
                -- unconditional rather than "safe only once it has
                -- children."
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON clients
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON document_templates
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
                CREATE TRIGGER trg_company_id_immutable BEFORE UPDATE ON generated_documents
                  FOR EACH ROW EXECUTE FUNCTION prevent_company_id_change();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON generated_documents;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON document_templates;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON clients;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON roles;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON users;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON document_line_items;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON generated_document_versions;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON template_versions;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON client_bank_accounts;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON client_contacts;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON client_addresses;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON client_individuals;
                DROP TRIGGER IF EXISTS trg_company_id_immutable ON client_legal_entities;
                DROP FUNCTION IF EXISTS prevent_company_id_change();
            """,
        ),
        # ------------------------------------------------------------------
        # 4a. Client subtype exclusivity — direction 1: a subtype row must
        #     match its client's client_type at insert/update.
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                CREATE OR REPLACE FUNCTION enforce_client_subtype()
                RETURNS trigger AS $$
                DECLARE
                  v_type varchar;
                BEGIN
                  SELECT client_type INTO v_type FROM clients WHERE id = NEW.client_id;

                  IF TG_TABLE_NAME = 'client_legal_entities' AND v_type <> 'legal_entity' THEN
                    RAISE EXCEPTION 'client % is not a legal_entity', NEW.client_id;
                  END IF;

                  IF TG_TABLE_NAME = 'client_individuals' AND v_type <> 'individual' THEN
                    RAISE EXCEPTION 'client % is not an individual', NEW.client_id;
                  END IF;

                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_check_legal_entity_type
                  BEFORE INSERT OR UPDATE ON client_legal_entities
                  FOR EACH ROW EXECUTE FUNCTION enforce_client_subtype();
                CREATE TRIGGER trg_check_individual_type
                  BEFORE INSERT OR UPDATE ON client_individuals
                  FOR EACH ROW EXECUTE FUNCTION enforce_client_subtype();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS trg_check_individual_type ON client_individuals;
                DROP TRIGGER IF EXISTS trg_check_legal_entity_type ON client_legal_entities;
                DROP FUNCTION IF EXISTS enforce_client_subtype();
            """,
        ),
        # ------------------------------------------------------------------
        # 4b. Client subtype exclusivity — direction 2: block changing
        #     clients.client_type while the OLD type's subtype row still
        #     exists (the gap the v3 review round closed).
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                CREATE OR REPLACE FUNCTION prevent_invalid_client_type_change()
                RETURNS trigger AS $$
                BEGIN
                  IF TG_OP = 'UPDATE' AND NEW.client_type IS DISTINCT FROM OLD.client_type THEN
                    IF OLD.client_type = 'individual'
                       AND EXISTS (SELECT 1 FROM client_individuals WHERE client_id = OLD.id) THEN
                      RAISE EXCEPTION
                        'cannot change client_type: client % still has a client_individuals row', OLD.id;
                    END IF;

                    IF OLD.client_type = 'legal_entity'
                       AND EXISTS (SELECT 1 FROM client_legal_entities WHERE client_id = OLD.id) THEN
                      RAISE EXCEPTION
                        'cannot change client_type: client % still has a client_legal_entities row', OLD.id;
                    END IF;
                  END IF;

                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_client_type_change_guard
                  BEFORE UPDATE OF client_type ON clients
                  FOR EACH ROW EXECUTE FUNCTION prevent_invalid_client_type_change();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS trg_client_type_change_guard ON clients;
                DROP FUNCTION IF EXISTS prevent_invalid_client_type_change();
            """,
        ),
        # ------------------------------------------------------------------
        # 5. RBAC — a user_roles assignment's role must be global
        #    (company_id NULL) or match the user's own company.
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                CREATE OR REPLACE FUNCTION enforce_user_role_company_match()
                RETURNS trigger AS $$
                DECLARE
                  v_user_company bigint;
                  v_role_company bigint;
                BEGIN
                  SELECT company_id INTO v_user_company FROM users WHERE id = NEW.user_id;
                  SELECT company_id INTO v_role_company FROM roles WHERE id = NEW.role_id;

                  IF v_role_company IS NOT NULL AND v_role_company <> v_user_company THEN
                    RAISE EXCEPTION
                      'role % (company %) cannot be assigned to user % (company %)',
                      NEW.role_id, v_role_company, NEW.user_id, v_user_company;
                  END IF;

                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_user_role_company_match
                  BEFORE INSERT OR UPDATE ON user_roles
                  FOR EACH ROW EXECUTE FUNCTION enforce_user_role_company_match();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS trg_user_role_company_match ON user_roles;
                DROP FUNCTION IF EXISTS enforce_user_role_company_match();
            """,
        ),
        # ------------------------------------------------------------------
        # 6. Immutability — generated_document_versions and
        #    document_line_items are INSERT-only once created.
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                CREATE OR REPLACE FUNCTION forbid_mutation()
                RETURNS trigger AS $$
                BEGIN
                  RAISE EXCEPTION '% rows are immutable once created', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_gdv_immutable
                  BEFORE UPDATE OR DELETE ON generated_document_versions
                  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
                CREATE TRIGGER trg_line_items_immutable
                  BEFORE UPDATE OR DELETE ON document_line_items
                  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS trg_line_items_immutable ON document_line_items;
                DROP TRIGGER IF EXISTS trg_gdv_immutable ON generated_document_versions;
                DROP FUNCTION IF EXISTS forbid_mutation();
            """,
        ),
        # ------------------------------------------------------------------
        # 7. audit_logs — block UPDATE/DELETE as a second line of defense
        #    independent of DB role grants (reuses forbid_mutation() above).
        # ------------------------------------------------------------------
        migrations.RunSQL(
            sql="""
                CREATE TRIGGER trg_audit_logs_immutable
                  BEFORE UPDATE OR DELETE ON audit_logs
                  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
            """,
        ),
    ]