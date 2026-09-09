from io import BytesIO
import zipfile
from decimal import Decimal

from django.test import SimpleTestCase

from docx import Document

from apps.generated_documents.services.context import build_line_items_context
from apps.generated_documents.services.placeholder_engine import (
    MissingRequiredValueError,
    UnknownPlaceholderError,
    render_document,
)

NAMESPACES = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def base_context(**overrides):
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
        "items": [
            {
                "line_number": 1,
                "description": "Consulting",
                "quantity": Decimal("2"),
                "unit": "h",
                "unit_price": Decimal("100.00"),
                "discount_percent": Decimal("0"),
                "vat_rate_percent": Decimal("18"),
                "subtotal": Decimal("200.00"),
                "vat_amount": Decimal("36.00"),
                "total": Decimal("236.00"),
            },
            {
                "line_number": 2,
                "description": "Development",
                "quantity": Decimal("5"),
                "unit": "h",
                "unit_price": Decimal("80.00"),
                "discount_percent": Decimal("0"),
                "vat_rate_percent": Decimal("18"),
                "subtotal": Decimal("400.00"),
                "vat_amount": Decimal("72.00"),
                "total": Decimal("472.00"),
            },
        ],
    }
    for key, value in overrides.items():
        context[key] = value
    return context


def three_item_context():
    context = base_context()
    context["items"] = [
        {
            "description": f"Item {i}",
            "quantity": Decimal(str(i)),
            "unit": "pc",
            "unit_price": Decimal("10.00"),
            "discount_percent": Decimal("0"),
            "vat_rate_percent": Decimal("18"),
            "subtotal": Decimal("0"),
            "vat_amount": Decimal("0"),
            "total": Decimal(f"{i}0.00"),
        }
        for i in range(1, 4)
    ]
    return context


def build_docx(body_paragraphs=None, table_rows=None):
    """
    Build a docx fixture (in-memory) suitable for line-item tests.

    ``body_paragraphs``: list of strings to add to the body (before the
    optional table).
    ``table_rows``: list of rows; each row is a list of cell strings. A
    prototype row uses ``{{#each items}}`` as its first cell and
    ``{{/each}}`` as its last cell.
    """
    document = Document()
    for text in (body_paragraphs or []):
        document.add_paragraph(text)
    if table_rows:
        table = document.add_table(rows=0, cols=len(table_rows[0]))
        for row in table_rows:
            cells = table.add_row().cells
            for index, value in enumerate(row):
                cells[index].paragraphs[0].text = value
    out = BytesIO()
    document.save(out)
    out.seek(0)
    return out.getvalue()


def render_text(context, **kwargs):
    source = build_docx(**kwargs)
    out = BytesIO()
    render_document(BytesIO(source), out, context)
    return extract_text(out.getvalue())


def build_table_docx(body_paragraphs=None, rows=None):
    """Build a docx with a header row, a prototype row, and a totals row."""
    return build_docx(
        body_paragraphs=body_paragraphs,
        table_rows=rows or [
            ["Item", "Qty", "Unit Price", "Total"],
            ["{{#each items}}", "{{ item.description }}", "{{ item.quantity }}", "{{/each}}"],
            ["", "Total", "", ""],
        ],
    )


def extract_text(docx_bytes):
    with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
        xml = zf.read("word/document.xml")
    from lxml import etree
    root = etree.fromstring(xml)
    texts = [
        (t.text or "") for t in root.iter("{%s}t" % NAMESPACES["w"])
    ]
    return "".join(texts)


def extract_row_matrix(docx_bytes):
    """Return list of rows, each a list of concatenated cell texts."""
    with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
        xml = zf.read("word/document.xml")
    from lxml import etree
    root = etree.fromstring(xml)
    rows = []
    for tr in root.iter("{%s}tr" % NAMESPACES["w"]):
        cells = []
        for tc in tr.iter("{%s}tc" % NAMESPACES["w"]):
            cells.append("".join(
                (t.text or "") for t in tc.iter("{%s}t" % NAMESPACES["w"])
            ))
        rows.append(cells)
    return rows


class _OrderedList(list):
    """Fake queryset-like list with a no-op order_by (sorted by line_number)."""

    def order_by(self, *args, **kwargs):
        return _OrderedList(sorted(self, key=lambda r: r.line_number))


def _fake_qs(rows):
    qs = _OrderedList()
    qs.extend(rows)
    return qs


class ContextLineItemTests(SimpleTestCase):
    def test_line_items_are_included_in_context(self):
        from types import SimpleNamespace
        version = SimpleNamespace(line_items=_fake_qs([
            SimpleNamespace(
                line_number=1, description="A", quantity=Decimal("1"),
                unit="h", unit_price=Decimal("10"),
                discount_percent=Decimal("0"), vat_rate_percent=Decimal("18"),
                subtotal=Decimal("10"), vat_amount=Decimal("1.8"), total=Decimal("11.8"),
            )
        ]))
        items = build_line_items_context(version)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["description"], "A")
        self.assertEqual(items[0]["total"], Decimal("11.8"))

    def test_line_items_ordered_by_line_number(self):
        from types import SimpleNamespace

        def row(n):
            return SimpleNamespace(
                line_number=n, description=f"D{n}", quantity=Decimal("1"),
                unit="h", unit_price=Decimal("10"),
                discount_percent=Decimal("0"), vat_rate_percent=Decimal("18"),
                subtotal=Decimal("10"), vat_amount=Decimal("1.8"), total=Decimal("11.8"),
            )

        version = SimpleNamespace(line_items=_fake_qs([row(3), row(1), row(2)]))
        items = build_line_items_context(version)
        self.assertEqual([it["line_number"] for it in items], [1, 2, 3])

    def test_no_version_yields_empty_items(self):
        self.assertEqual(build_line_items_context(None), [])


class TableRowReplicationTests(SimpleTestCase):
    def test_two_items_produce_two_rows(self):
        context = base_context()
        context["items"] = context["items"][:2]
        source = build_table_docx()
        out = BytesIO()
        render_document(BytesIO(source), out, context)
        rows = extract_row_matrix(out.getvalue())
        # header row + 2 item rows + totals row
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0][0], "Item")
        self.assertIn("Consulting", rows[1][1])
        self.assertIn("Development", rows[2][1])
        self.assertEqual(rows[3][0], "")

    def test_several_items_produce_exact_count(self):
        context = three_item_context()
        source = build_table_docx()
        out = BytesIO()
        render_document(BytesIO(source), out, context)
        item_rows = extract_row_matrix(out.getvalue())
        # header + 3 item + totals = 5, but marker cells emptied
        descriptions = [r[1] for r in item_rows]
        self.assertIn("Item 1", descriptions)
        self.assertIn("Item 2", descriptions)
        self.assertIn("Item 3", descriptions)
        self.assertEqual(len(item_rows), 5)

    def test_each_row_gets_correct_item_data(self):
        context = base_context()
        source = build_table_docx()
        out = BytesIO()
        render_document(BytesIO(source), out, context)
        rows = extract_row_matrix(out.getvalue())
        self.assertIn("Consulting", rows[1][1])
        self.assertEqual(rows[1][2], "2")
        self.assertIn("Development", rows[2][1])
        self.assertEqual(rows[2][2], "5")

    def test_empty_collection_leaves_no_prototype_row(self):
        context = base_context()
        context["items"] = []
        source = build_table_docx()
        out = BytesIO()
        render_document(BytesIO(source), out, context)
        rows = extract_row_matrix(out.getvalue())
        self.assertEqual(len(rows), 2)  # header + totals
        for row in rows:
            for cell in row:
                self.assertNotIn("{{", cell)
                self.assertNotIn("item.description", cell)

    def test_markers_are_stripped_from_rows(self):
        context = base_context()
        source = build_table_docx()
        out = BytesIO()
        render_document(BytesIO(source), out, context)
        rows = extract_row_matrix(out.getvalue())
        for row in rows:
            for cell in row:
                self.assertNotIn("{{#each", cell)
                self.assertNotIn("{{/each}}", cell)
                self.assertNotIn("item.", cell)


class TableFormattingTests(SimpleTestCase):
    def _count_bold_runs_in_items(self, docx_bytes):
        """Count runs with <w:b/> inside the document body."""
        with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
            xml = zf.read("word/document.xml")
        from lxml import etree
        root = etree.fromstring(xml)
        b = "{%s}rPr/{%s}b" % (NAMESPACES["w"], NAMESPACES["w"])
        return len([r for r in root.iter("{%s}r" % NAMESPACES["w"])
                    if r.find(b) is not None])

    def test_cloned_rows_preserve_prototype_bold_formatting(self):
        document = Document()
        table = document.add_table(rows=0, cols=3)
        header = table.add_row().cells
        header[0].paragraphs[0].text = "Item"
        header[1].paragraphs[0].text = "Qty"
        header[2].paragraphs[0].text = "Total"

        proto = table.add_row().cells
        proto[0].paragraphs[0].text = "{{#each items}}"
        run = proto[1].paragraphs[0].add_run("{{ item.description }}")
        run.bold = True  # formatting preserved on the clone
        proto[2].paragraphs[0].text = "{{/each}}"

        source = BytesIO()
        document.save(source)
        source.seek(0)

        context = base_context()  # 2 items
        out = BytesIO()
        render_document(BytesIO(source.getvalue()), out, context)
        data = out.getvalue()
        text = extract_text(data)

        self.assertIn("Consulting", text)
        self.assertIn("Development", text)
        self.assertNotIn("{{", text)
        # Prototype bold run should keep appearing in BOTH cloned rows.
        self.assertEqual(self._count_bold_runs_in_items(data), 2)


class ParagraphSectionTests(SimpleTestCase):
    def test_paragraphs_repeated_per_item(self):
        context = base_context()
        context["items"] = context["items"][:2]
        text = render_text(
            context,
            body_paragraphs=[
                "Invoice",
                "{{#each items}}",
                "{{ item.description }} - {{ item.quantity }}",
                "{{/each}}",
                "End",
            ],
        )
        self.assertIn("Consulting - 2", text)
        self.assertIn("Development - 5", text)
        self.assertEqual(text.count("Consulting"), 1)
        self.assertEqual(text.count("Development"), 1)
        self.assertIn("Invoice", text)
        self.assertIn("End", text)
        self.assertNotIn("item.description", text)

    def test_empty_paragraph_section_leaves_no_content(self):
        context = base_context()
        context["items"] = []
        text = render_text(
            context,
            body_paragraphs=[
                "Start",
                "{{#each items}}",
                "{{ item.description }}",
                "{{/each}}",
                "End",
            ],
        )
        self.assertIn("Start", text)
        self.assertIn("End", text)
        self.assertNotIn("item.description", text)


class SimplePlaceholdersStillWorkTests(SimpleTestCase):
    def test_company_client_document_placeholders_with_items(self):
        source = build_docx(
            body_paragraphs=[
                "{{ company.name }}",
                "{{ client.name }}",
                "{{ document.number }}",
            ]
        )
        out = BytesIO()
        render_document(BytesIO(source), out, base_context(items=[]))
        text = extract_text(out.getvalue())
        self.assertIn("GRM Group", text)
        self.assertIn("ABC Consulting", text)
        self.assertIn("INV-001", text)


class ValidationTests(SimpleTestCase):
    def test_unknown_repeating_collection_raises(self):
        context = base_context()
        source = build_docx(
            body_paragraphs=["{{#each bogus}}", "x", "{{/each}}"]
        )
        with self.assertRaises(UnknownPlaceholderError) as manager:
            render_document(BytesIO(source), BytesIO(), context)
        self.assertIn("bogus", str(manager.exception))

    def test_unbalanced_section_raises(self):
        context = base_context()
        source = build_docx(body_paragraphs=["{{#each items}}", "x"])
        with self.assertRaises(UnknownPlaceholderError):
            render_document(BytesIO(source), BytesIO(), context)

    def test_nested_section_raises(self):
        context = base_context()
        source = build_docx(
            body_paragraphs=[
                "{{#each items}}",
                "{{#each items}}",
                "x",
                "{{/each}}",
                "{{/each}}",
            ]
        )
        with self.assertRaises(UnknownPlaceholderError):
            render_document(BytesIO(source), BytesIO(), context)

    def test_item_placeholder_outside_section_raises(self):
        context = base_context()
        source = build_docx(body_paragraphs=["{{ item.description }}"])
        with self.assertRaises(UnknownPlaceholderError):
            render_document(BytesIO(source), BytesIO(), context)

    def test_expression_in_each_is_rejected(self):
        context = base_context()
        source = build_docx(
            body_paragraphs=[
                "{{#each some_python_expression()}}",
                "x",
                "{{/each}}",
            ]
        )
        with self.assertRaises(UnknownPlaceholderError):
            render_document(BytesIO(source), BytesIO(), context)


class SecurityTests(SimpleTestCase):
    def test_expression_placeholder_is_not_executed(self):
        context = base_context()
        source = build_docx(
            body_paragraphs=["{{ item.description.__class__ }}"]
        )
        with self.assertRaises(UnknownPlaceholderError):
            render_document(BytesIO(source), BytesIO(), context)

    def test_unknown_simple_variable_in_cell_rejected(self):
        context = base_context()
        source = build_docx(table_rows=[["{{ item.bogus_field }}"]])
        with self.assertRaises(UnknownPlaceholderError):
            render_document(BytesIO(source), BytesIO(), context)


class VersionGateToRenderAlignmentTests(SimpleTestCase):
    """
    Guard the end-to-end loop contract: the snapshot-time gate used by
    ``POST .../versions/`` (docx text extraction + validate_placeholders) and
    the render engine must agree that a repeating line-item section is valid.
    """

    def test_loop_template_passes_snapshot_validation_and_renders(self):
        from apps.document_templates.docx_text import extract_docx_text
        from apps.document_templates.variables import validate_placeholders

        source = build_docx(
            body_paragraphs=[
                "Items:",
                "{{#each items}}",
                "{{ item.description }} - {{ item.quantity }}",
                "{{/each}}",
                "End",
            ]
        )

        # 1) Version-creation gate on the extracted plain text.
        text = extract_docx_text(BytesIO(source))
        valid, invalid = validate_placeholders(text)
        self.assertEqual(invalid, [])
        self.assertIn("{{ item.description }}", valid)

        # 2) The same template renders correctly through the engine.
        out = BytesIO()
        render_document(BytesIO(source), out, base_context())
        rendered = extract_text(out.getvalue())
        self.assertIn("Items:", rendered)
        self.assertIn("Consulting - 2", rendered)
        self.assertIn("Development - 5", rendered)
        self.assertIn("End", rendered)
        self.assertNotIn("{{", rendered)

    def test_unknown_collection_fails_snapshot_validation(self):
        from apps.document_templates.docx_text import extract_docx_text
        from apps.document_templates.variables import validate_placeholders

        source = build_docx(
            body_paragraphs=["{{#each bogus}}", "x", "{{/each}}"]
        )
        text = extract_docx_text(BytesIO(source))
        _valid, invalid = validate_placeholders(text)
        self.assertIn("{{#each bogus}}", invalid)
