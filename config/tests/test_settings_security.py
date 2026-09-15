"""
Focused tests for the security-sensitive Django configuration.

The settings module derives its values from the process environment at import
time, so production/development behavior is exercised in isolated subprocesses
that control the environment explicitly. This keeps the assertions independent
of the developer's local ``.env``.
"""

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

from django.test import SimpleTestCase

REPO_ROOT = Path(__file__).resolve().parents[2]

# These prefixes are controlled by settings.py/.env and are stripped from the
# inherited environment so every probe starts from a known state.
_ENV_PREFIXES = ("DJANGO_", "JWT_")

_STRONG_SECRET = "r" * 50

_PROBE = textwrap.dedent(
    """
    import json
    import os
    import sys

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.conf import settings

        settings.DEBUG  # force lazy settings initialization inside the try
    except Exception as exc:  # django.core.exceptions.ImproperlyConfigured
        payload = {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}
        print(json.dumps(payload))
        sys.exit(0)

    print(
        json.dumps(
            {
                "ok": True,
                "DJANGO_ENV": getattr(settings, "DJANGO_ENV", None),
                "DEBUG": settings.DEBUG,
                "SECRET_KEY": settings.SECRET_KEY,
                "ALLOWED_HOSTS": list(settings.ALLOWED_HOSTS),
                "SECURE_SSL_REDIRECT": getattr(settings, "SECURE_SSL_REDIRECT", None),
                "SESSION_COOKIE_SECURE": settings.SESSION_COOKIE_SECURE,
                "CSRF_COOKIE_SECURE": settings.CSRF_COOKIE_SECURE,
                "SECURE_HSTS_SECONDS": settings.SECURE_HSTS_SECONDS,
                "SECURE_HSTS_INCLUDE_SUBDOMAINS": (
                    settings.SECURE_HSTS_INCLUDE_SUBDOMAINS
                ),
                "SECURE_HSTS_PRELOAD": settings.SECURE_HSTS_PRELOAD,
                "SECURE_CONTENT_TYPE_NOSNIFF": settings.SECURE_CONTENT_TYPE_NOSNIFF,
                "X_FRAME_OPTIONS": settings.X_FRAME_OPTIONS,
                "SECURE_REFERRER_POLICY": settings.SECURE_REFERRER_POLICY,
                "SECURE_PROXY_SSL_HEADER": getattr(
                    settings, "SECURE_PROXY_SSL_HEADER", None
                ),
                "DJANGO_ADMIN_ENABLED": settings.DJANGO_ADMIN_ENABLED,
                "CSRF_TRUSTED_ORIGINS": list(settings.CSRF_TRUSTED_ORIGINS),
            }
        )
    )
    """
)


def _probe(overrides=None):
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(_ENV_PREFIXES)
    }
    env.update(overrides or {})
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise AssertionError(
            "Settings probe failed:\nstdout=%r\nstderr=%r"
            % (result.stdout, result.stderr)
        )
    return json.loads(result.stdout.strip().splitlines()[-1])


def _prod(debug="False", secret=_STRONG_SECRET, hosts="app.example.com", proxy=None):
    """Build a production-mode environment; pass None to leave a key unset."""
    overrides = {"DJANGO_ENV": "production"}
    if debug is not None:
        overrides["DJANGO_DEBUG"] = debug
    if secret is not None:
        overrides["DJANGO_SECRET_KEY"] = secret
    if hosts is not None:
        overrides["DJANGO_ALLOWED_HOSTS"] = hosts
    if proxy is not None:
        overrides["DJANGO_TRUST_PROXY_SSL_HEADER"] = proxy
    return overrides


class ProductionSettingsTests(SimpleTestCase):
    def test_production_requires_secret_key(self):
        payload = _probe(_prod(secret=None))
        self.assertFalse(payload["ok"])
        self.assertIn("DJANGO_SECRET_KEY", payload["error"])

    def test_production_rejects_insecure_secret_key(self):
        for weak in (
            "django-insecure-change-me-in-production",
            "django-insecure-local-development-key",
            "short-secret",
            "",
        ):
            with self.subTest(secret=weak):
                payload = _probe(_prod(secret=weak))
                self.assertFalse(payload["ok"])
                self.assertIn("DJANGO_SECRET_KEY", payload["error"])

    def test_production_missing_debug_defaults_to_false(self):
        payload = _probe(_prod(debug=None))
        self.assertTrue(payload["ok"])
        self.assertIs(payload["DEBUG"], False)

    def test_production_rejects_debug_enabled(self):
        payload = _probe(_prod(debug="True"))
        self.assertFalse(payload["ok"])
        self.assertIn("DJANGO_DEBUG", payload["error"])

    def test_production_requires_allowed_hosts(self):
        payload = _probe(_prod(hosts=None))
        self.assertFalse(payload["ok"])
        self.assertIn("DJANGO_ALLOWED_HOSTS", payload["error"])

    def test_production_rejects_wildcard_allowed_hosts(self):
        for hosts in ("*", "app.example.com,*"):
            with self.subTest(hosts=hosts):
                payload = _probe(_prod(hosts=hosts))
                self.assertFalse(payload["ok"])
                self.assertIn("ALLOWED_HOSTS", payload["error"])

    def test_production_enables_https_security_settings(self):
        payload = _probe(_prod())
        self.assertTrue(payload["ok"])
        self.assertIs(payload["DEBUG"], False)
        self.assertEqual(payload["ALLOWED_HOSTS"], ["app.example.com"])
        self.assertIs(payload["SECURE_SSL_REDIRECT"], True)
        self.assertIs(payload["SESSION_COOKIE_SECURE"], True)
        self.assertIs(payload["CSRF_COOKIE_SECURE"], True)
        self.assertEqual(payload["SECURE_HSTS_SECONDS"], 31536000)
        self.assertIs(payload["SECURE_HSTS_INCLUDE_SUBDOMAINS"], True)
        self.assertIs(payload["SECURE_HSTS_PRELOAD"], True)
        self.assertIs(payload["SECURE_CONTENT_TYPE_NOSNIFF"], True)
        self.assertEqual(payload["X_FRAME_OPTIONS"], "DENY")
        self.assertEqual(payload["SECURE_REFERRER_POLICY"], "same-origin")
        # Trusting a proxy-supplied header is an explicit opt-in, never default.
        self.assertIsNone(payload["SECURE_PROXY_SSL_HEADER"])

    def test_production_proxy_ssl_header_is_opt_in(self):
        payload = _probe(_prod(proxy="True"))
        self.assertTrue(payload["ok"])
        self.assertEqual(
            payload["SECURE_PROXY_SSL_HEADER"],
            ["HTTP_X_FORWARDED_PROTO", "https"],
        )

    def test_production_disables_django_admin_by_default(self):
        payload = _probe(_prod())
        self.assertFalse(payload["DJANGO_ADMIN_ENABLED"])

    def test_production_allows_explicit_admin_enablement_and_csrf_origins(self):
        payload = _probe(
            {
                **_prod(),
                "DJANGO_ADMIN_ENABLED": "True",
                "DJANGO_CSRF_TRUSTED_ORIGINS": "https://frontend.example",
            }
        )
        self.assertTrue(payload["DJANGO_ADMIN_ENABLED"])
        self.assertEqual(payload["CSRF_TRUSTED_ORIGINS"], ["https://frontend.example"])

    def test_production_rejects_malformed_csrf_origin(self):
        payload = _probe(
            {**_prod(), "DJANGO_CSRF_TRUSTED_ORIGINS": "frontend.example"}
        )
        self.assertFalse(payload["ok"])
        self.assertIn("DJANGO_CSRF_TRUSTED_ORIGINS", payload["error"])

    def test_production_rejects_http_csrf_origin(self):
        payload = _probe(
            {**_prod(), "DJANGO_CSRF_TRUSTED_ORIGINS": "http://frontend.example"}
        )
        self.assertFalse(payload["ok"])
        self.assertIn("HTTPS", payload["error"])


class DevelopmentSettingsTests(SimpleTestCase):
    def test_development_keeps_permissive_behavior(self):
        payload = _probe(
            {
                "DJANGO_ENV": "development",
                "DJANGO_DEBUG": "True",
                "DJANGO_SECRET_KEY": "any-local-dev-secret",
                "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1",
            }
        )
        self.assertTrue(payload["ok"])
        self.assertIs(payload["DEBUG"], True)
        self.assertEqual(payload["ALLOWED_HOSTS"], ["localhost", "127.0.0.1"])
        # Development never forces HTTPS-only behavior.
        self.assertIs(payload["SECURE_SSL_REDIRECT"], False)
        self.assertIsNone(payload["SECURE_PROXY_SSL_HEADER"])

    def test_development_does_not_fail_closed(self):
        payload = _probe({"DJANGO_ENV": "development", "DJANGO_DEBUG": "True"})
        self.assertTrue(payload["ok"])
        self.assertIs(payload["DEBUG"], True)
