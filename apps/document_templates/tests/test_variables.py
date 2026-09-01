from django.test import SimpleTestCase

from apps.document_templates.variables import (
    has_invalid_placeholders,
    validate_placeholders,
)


class PlaceholderValidatorTests(SimpleTestCase):
    def test_valid_placeholder_is_recognized(self):
        valid, invalid = validate_placeholders("{{ company.name }}")
        self.assertIn("{{ company.name }}", valid)
        self.assertEqual(invalid, [])

    def test_multiple_valid_namespaces(self):
        text = "{{ company.name }} {{ client.name }} {{ document.number }}"
        valid, invalid = validate_placeholders(text)
        self.assertEqual(len(valid), 3)
        self.assertEqual(invalid, [])

    def test_unknown_variable_is_flagged(self):
        valid, invalid = validate_placeholders("{{ unknown.field }}")
        self.assertEqual(valid, [])
        self.assertEqual(len(invalid), 1)
        self.assertIn("unknown.field", invalid[0])

    def test_unknown_field_in_known_namespace_is_flagged(self):
        valid, invalid = validate_placeholders("{{ client.foo }}")
        self.assertEqual(valid, [])
        self.assertEqual(len(invalid), 1)

    def test_malformed_placeholder_is_flagged(self):
        for malformed in (
            "{{ company .name }}",
            "{{}}",
            "{{ company }}",
            "{{ company.name. }}",
        ):
            _valid, invalid = validate_placeholders(malformed)
            self.assertTrue(invalid, f"expected {malformed!r} to be flagged")

    def test_unclosed_placeholder_is_not_a_placeholder(self):
        # An unclosed `{{ ...` is not a complete placeholder, so the validator
        # does not treat it as a (malformed) variable at all.
        valid, invalid = validate_placeholders("a {{ company.name. and more text")
        self.assertEqual(valid, [])
        self.assertEqual(invalid, [])

    def test_python_code_expression_is_not_accepted(self):
        for expr in (
            "{{ company.name.__class__ }}",
            "{{ 1 + 1 }}",
            "{{ __import__('os') }}",
            "{{ client['name'] }}",
            "{{ client.name.upper() }}",
        ):
            _valid, invalid = validate_placeholders(expr)
            self.assertTrue(
                invalid, f"expected expression {expr!r} not to be accepted"
            )

    def test_has_invalid_placeholders(self):
        self.assertTrue(has_invalid_placeholders("{{ bogus.key }}"))
        self.assertFalse(has_invalid_placeholders("{{ company.name }}"))

    def test_whitespace_normalized(self):
        valid, invalid = validate_placeholders("{{   company.voen   }}")
        self.assertIn("{{ company.voen }}", valid)
        self.assertEqual(invalid, [])

    def test_case_insensitive_key(self):
        valid, invalid = validate_placeholders("{{ Company.Name }}")
        self.assertIn("{{ company.name }}", valid)
        self.assertEqual(invalid, [])

    def test_document_type_variable_is_valid(self):
        valid, _invalid = validate_placeholders("{{ document.type }}")
        self.assertIn("{{ document.type }}", valid)
