from io import BytesIO
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal

from django.test import SimpleTestCase

from docx import Document

from apps.document_templates.variables import VARIABLES
from apps.generated_documents.services.placeholder_engine import (
    MissingRequiredValueError,
    UnknownPlaceholderError,
    render_document,
    format_value,
)

NAMESPACES = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
DOCX_NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
)


def _required_catalog_keys():
    """Minimal keys every context needs so required variables validate."""
    return {
        "document.number": "INV-001",
        "document.date": "2026-09-01",
        "document.type": "Invoice",
        "client.name": "ABC Consulting",
    }


def build_context(**overrides):
    context = {
        "company": {
            "name": "GRM Group",
            "legal_name": "GRM Group LLC",
            "voen": "AZ1234567",
            "registration_number": "RN-001",
        },
        "client": {
            "name": "ABC Consulting",
            "voen": "1234567890",
            "email": "abc@example.com",
            "phone": None,
        },
        "document": {
            "number": "INV-001",
            "date": "2026-09-01",
            "type": "Invoice",
        },
    }
    for namespace, fields in overrides.items():
        context[namespace].update(fields)
    return context


def render_to_text(context, **kwargs):
    """Render a docx fixture and return the extracted body text."""
    return extract_text(render_bytes(context, **kwargs))


def render_bytes(context, paragraphs=None, table_cell=None, split_at=None):
    """Build a docx with given paragraphs/cell and render it, returning bytes."""
    source = build_docx(paragraphs=paragraphs, table_cell=table_cell, split_at=split_at)
    out = BytesIO()
    render_document(BytesIO(source), out, context)
    return out.getvalue()


def build_docx(paragraphs=None, table_cell=None, split_at=None):
    """
    Build a real python-docx fixture.

    ``paragraphs``: list of strings to add to the body.
    ``table_cell``: list of strings; the first goes in a table cell, the rest
                    as paragraphs in the same cell.
    ``split_at``: if given, the first body paragraph's placeholder is split
                  across runs (injecting a second run boundary).
    """
    document = Document()
    if paragraphs is None:
        paragraphs = []
    for index, text in enumerate(paragraphs):
        paragraph = document.add_paragraph(text)
        if split_at and index == 0 and split_at in text:
            # Rebuild this paragraph with the placeholder split across runs.
            paragraph.clear()
            for offset in (text.index("{{"), text.index("}}") + 2):
                paragraph.add_run(text[:offset])
                paragraph.add_run(text[offset:])
    if table_cell is not None:
        table = document.add_table(rows=1, cols=1)
        cell = table.cell(0, 0)
        first, *rest = table_cell
        cell.paragraphs[0].text = first
        for text in rest:
            cell.add_paragraph(text)
    out = BytesIO()
    document.save(out)
    out.seek(0)
    return out.getvalue()


def extract_text(docx_bytes):
    """Extract the plain body text of a rendered docx (for assertions)."""
    with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
        xml = zf.read("word/document.xml")
    from lxml import etree
    root = etree.fromstring(xml)
    return "".join(
        (t.text or "") for t in root.iter("{%s}t" % NAMESPACES["w"])
    )


class SourcePreservationTests(SimpleTestCase):
    def _make_docx_bytes(self):
        out = BytesIO()
        Document().save(out)
        out.seek(0)
        return out.getvalue()

    def test_template_source_bytes_are_unchanged(self):
        source = self._make_docx_bytes()
        rendered = render_bytes(build_context(), paragraphs=["{{ company.name }}"])
        self.assertEqual(self._make_docx_bytes(), source)
        self.assertNotEqual(source, rendered)


class BasicReplacementTests(SimpleTestCase):
    def test_single_basic_placeholder_is_replaced(self):
        text = render_to_text(
            build_context(), paragraphs=["Client: {{ client.name }}"]
        )
        self.assertIn("Client: ABC Consulting", text)
        self.assertNotIn("{{ client.name }}", text)

    def test_multiple_namespaces(self):
        text = render_to_text(
            build_context(),
            paragraphs=[
                "{{ company.name }}",
                "{{ client.name }}",
                "{{ document.number }}",
            ],
        )
        self.assertIn("GRM Group", text)
        self.assertIn("ABC Consulting", text)
        self.assertIn("INV-001", text)

    def test_multiple_placeholders_in_one_paragraph(self):
        text = render_to_text(
            build_context(),
            paragraphs=[
                "{{ document.number }} on {{ document.date }} for {{ client.name }}"
            ],
        )
        self.assertIn("INV-001 on 2026-09-01 for ABC Consulting", text)


class WhitespaceTests(SimpleTestCase):
    def test_whitespace_variations_resolve(self):
        text = render_to_text(
            build_context(),
            paragraphs=[
                "{{client.name}}",
                "{{ client.name }}",
                "{{   client.name   }}",
            ],
        )
        self.assertEqual(text.count("ABC Consulting"), 3)
        self.assertNotIn("client.name", text)


class MissingValueTests(SimpleTestCase):
    def test_missing_optional_value_resolves_to_empty(self):
        ctx = build_context()
        ctx["client"]["phone"] = None
        text = render_to_text(ctx, paragraphs=["phone={{ client.phone }}"])
        self.assertEqual(text.strip(), "phone=")

    def test_missing_required_value_raises(self):
        ctx = build_context(document={"number": None})
        with self.assertRaises(MissingRequiredValueError):
            render_bytes(ctx, paragraphs=["{{ document.number }}"])

    def test_all_required_value_errors_reported_at_once(self):
        ctx = build_context()
        ctx["client"]["name"] = None
        ctx["document"] = {"number": None, "date": None, "type": None}
        with self.assertRaises(MissingRequiredValueError) as manager:
            render_bytes(ctx, paragraphs=["{{ client.name }}", "{{ document.date }}"])
        message = str(manager.exception)
        self.assertIn("client.name", message)
        self.assertIn("document.date", message)


class UnknownVariableTests(SimpleTestCase):
    def test_unknown_variable_raises(self):
        with self.assertRaises(UnknownPlaceholderError):
            render_bytes(
                build_context(),
                paragraphs=["{{ some_random_variable }}"],
            )

    def test_unknown_field_in_known_namespace_raises(self):
        with self.assertRaises(UnknownPlaceholderError):
            render_bytes(
                build_context(), paragraphs=["{{ client.unknown_field }}"]
            )

    def test_expression_is_rejected(self):
        with self.assertRaises(UnknownPlaceholderError):
            render_bytes(
                build_context(), paragraphs=["{{ company.name.__class__ }}"]
            )

    def test_all_unknown_placeholders_reported_at_once(self):
        with self.assertRaises(UnknownPlaceholderError) as manager:
            render_bytes(
                build_context(),
                paragraphs=["{{ bogus.one }}", "{{ client.unknown_field }}"],
            )
        message = str(manager.exception)
        self.assertIn("bogus.one", message)
        self.assertIn("client.unknown_field", message)

    def test_error_precedes_any_output(self):
        source = build_docx(paragraphs=["{{ good_thing }}"])
        with self.assertRaises(UnknownPlaceholderError):
            render_document(
                BytesIO(source), BytesIO(), build_context(company={"name": "X"})
            )


class TableCellTests(SimpleTestCase):
    def test_placeholder_inside_table_cell_is_replaced(self):
        out = BytesIO()
        render_document(
            BytesIO(build_docx(table_cell=["VOEN: {{ client.voen }}"])),
            out,
            build_context(),
        )
        text = extract_text(out.getvalue())
        self.assertIn("VOEN: 1234567890", text)
        self.assertNotIn("client.voen", text)

    def test_multiple_paragraphs_in_one_cell_are_replaced(self):
        out = BytesIO()
        render_document(
            BytesIO(
                build_docx(
                    table_cell=[
                        "{{ company.name }}",
                        "{{ client.email }}",
                    ]
                )
            ),
            out,
            build_context(),
        )
        text = extract_text(out.getvalue())
        self.assertIn("GRM Group", text)
        self.assertIn("abc@example.com", text)


class SplitRunTests(SimpleTestCase):
    def test_placeholder_split_across_runs_is_replaced(self):
        ctx = build_context()
        text = render_to_text(
            ctx,
            paragraphs=["{{ client.name }}"],
            split_at="{{ client.name }}",
        )
        self.assertIn("ABC Consulting", text)
        self.assertNotIn("{{ client.name", text)

    def test_split_run_text_before_and_after_placeholder_preserved(self):
        document = Document()
        paragraph = document.add_paragraph()
        paragraph.add_run("Name: ")
        paragraph.add_run("{{ client.")
        paragraph.add_run("name }}")
        paragraph.add_run("!")
        out = BytesIO()
        document.save(out)
        out.seek(0)

        rendered = BytesIO()
        render_document(BytesIO(out.getvalue()), rendered, build_context())
        text = extract_text(rendered.getvalue())
        self.assertIn("Name: ABC Consulting!", text)


class FormatValueTests(SimpleTestCase):
    def test_none_to_empty_string(self):
        self.assertEqual(format_value(None), "")

    def test_date_and_datetime_iso(self):
        self.assertEqual(format_value(date(2026, 9, 1)), "2026-09-01")
        self.assertEqual(
            format_value(datetime(2026, 9, 1, 12, 30, tzinfo=timezone.utc)),
            "2026-09-01",
        )

    def test_decimal_without_trailing_zeros(self):
        self.assertEqual(format_value(Decimal("123.4500")), "123.45")
        self.assertEqual(format_value(Decimal("10")), "10")

    def test_integer_and_string(self):
        self.assertEqual(format_value(1234), "1234")
        self.assertEqual(format_value("GRM"), "GRM")


class CatalogAlignmentTests(SimpleTestCase):
    def test_every_catalog_variable_is_namespaced(self):
        for variable in VARIABLES:
            namespace, _, field = variable.key.partition(".")
            self.assertTrue(namespace and field)
            self.assertIn(namespace, {"company", "client", "document"})
