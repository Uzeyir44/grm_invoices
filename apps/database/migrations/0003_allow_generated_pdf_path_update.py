"""
Allow GeneratedDocumentVersion.storage_path_pdf to be attached post-hoc.

Step 4.5 (PDF generation) records the generated PDF on the *same* version row
by updating the existing ``storage_path_pdf`` field
(``apps/generated_documents/services/pdf_generator.py``). The section-6
immutability trigger (``forbid_mutation()``, ``trg_gdv_immutable``) currently
rejects ANY UPDATE to ``generated_document_versions``, which would make that
recording impossible.

This migration narrows the rule for ``generated_document_versions`` only:

* an UPDATE is allowed iff the ONLY changed column is ``storage_path_pdf``
  (attaching the PDF produced for the already-generated DOCX), and
* DELETE is still forbidden; ``document_line_items`` is untouched
  (``trg_line_items_immutable`` / ``forbid_mutation()`` remain as before).

So the INSERT-only invariant for version *content* (rendered input snapshot,
version number, template version, currency, rates, DOCX path, timestamps) is
preserved; only the "additional PDF artifact pointer" becomes settable. This
matches the model's intent for ``storage_path_pdf`` (an optional, genuinely
incidental pointer) and the architecture-rule that a genuine schema amendment
is expressed through an explicit migration.
"""

from django.db import migrations

FORWARD_SQL = """
CREATE OR REPLACE FUNCTION allow_gdv_pdf_path_update()
RETURNS trigger AS $$
DECLARE
  changed_except_pdf boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are immutable once created', TG_TABLE_NAME;
  END IF;

  changed_except_pdf := (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.generated_document_id IS DISTINCT FROM OLD.generated_document_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
    OR NEW.currency_id IS DISTINCT FROM OLD.currency_id
    OR NEW.exchange_rate_used IS DISTINCT FROM OLD.exchange_rate_used
    OR NEW.vat_rate_used_percent IS DISTINCT FROM OLD.vat_rate_used_percent
    OR NEW.generation_snapshot IS DISTINCT FROM OLD.generation_snapshot
    OR NEW.generation_metadata IS DISTINCT FROM OLD.generation_metadata
    OR NEW.storage_path_docx IS DISTINCT FROM OLD.storage_path_docx
    OR NEW.generated_by_user_id IS DISTINCT FROM OLD.generated_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  );

  IF changed_except_pdf THEN
    RAISE EXCEPTION
      'generated_document_versions rows are immutable except for attaching '
      'the generated PDF path (storage_path_pdf)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gdv_immutable ON generated_document_versions;
CREATE TRIGGER trg_gdv_immutable
  BEFORE UPDATE OR DELETE ON generated_document_versions
  FOR EACH ROW EXECUTE FUNCTION allow_gdv_pdf_path_update();
"""

REVERSE_SQL = """
CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable once created', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gdv_immutable ON generated_document_versions;
CREATE TRIGGER trg_gdv_immutable
  BEFORE UPDATE OR DELETE ON generated_document_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("database", "0002_raw_sql_constraints"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]