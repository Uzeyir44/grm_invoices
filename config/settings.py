"""
Django settings for the GRM CRM project.

Settings are configured via environment variables (loaded from ``.env`` when
present, and only outside production) so configuration stays separate from
the business code.

Operating mode
--------------
``DJANGO_ENV`` selects the operating mode:

* ``development`` (default) — the local mode. ``DEBUG`` may be enabled and, as
  a convenience, ``.env`` is consulted when present.
* ``production`` — fails closed on insecure or missing configuration: it
  requires a strong ``DJANGO_SECRET_KEY`` from the real process environment,
  requires ``DEBUG`` to be False, requires explicit ``DJANGO_ALLOWED_HOSTS``
  (never ``"*"``), and enables the HTTPS/browser security settings below.
  ``.env`` is deliberately NOT read in production; every value must come from
  the deployment environment.
"""

import os
from datetime import timedelta
from pathlib import Path

import environ

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DJANGO_ENV = os.environ.get("DJANGO_ENV", "development").lower()
IS_PRODUCTION = DJANGO_ENV == "production"

env = environ.Env()
if not IS_PRODUCTION:
    # ``.env`` is a local-development convenience. It is deliberately not read
    # in production so an accidental file can never feed production secrets.
    environ.Env.read_env(BASE_DIR / ".env")


def env(name, default=None):
    """Read an environment variable, returning ``default`` when unset."""
    return os.environ.get(name, default)


# ---------------------------------------------------------------------------
# Security-critical configuration (SECRET_KEY, DEBUG, ALLOWED_HOSTS).
#
# In production Django refuses to start when any of these is missing,
# insecure, or debug-like. Development keeps its pre-existing permissive
# behavior.
# ---------------------------------------------------------------------------

if IS_PRODUCTION:
    secret_key = env("DJANGO_SECRET_KEY")
    if not secret_key:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY is required when DJANGO_ENV=production."
        )
    if secret_key.startswith("django-insecure-") or len(secret_key) < 50:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be a strong, unique secret of at least "
            "50 characters and must not start with 'django-insecure-' when "
            "DJANGO_ENV=production. Generate one with "
            "'python -c \"from django.core.management.utils import "
            "get_random_secret_key; print(get_random_secret_key())\"'."
        )
    SECRET_KEY = secret_key

    if env("DJANGO_DEBUG", "False").lower() in {"true", "1", "yes"}:
        raise ImproperlyConfigured(
            "DJANGO_DEBUG must not be enabled when DJANGO_ENV=production. "
            "Production fails closed: set DJANGO_DEBUG=False (or unset it)."
        )
    DEBUG = False
else:
    # Local-development key. This path is unreachable in production, which
    # never falls back to a default secret and rejects the 'django-insecure-'
    # prefix above.
    SECRET_KEY = env(
        "DJANGO_SECRET_KEY",
        "django-insecure-local-development-key",
    )
    DEBUG = env("DJANGO_DEBUG", "True").lower() in {"true", "1", "yes"}

ALLOWED_HOSTS = [
    host.strip()
    for host in env("DJANGO_ALLOWED_HOSTS", "").split(",")
    if host.strip()
]

if IS_PRODUCTION and not ALLOWED_HOSTS:
    raise ImproperlyConfigured(
        "DJANGO_ALLOWED_HOSTS must list the production host(s) when "
        "DJANGO_ENV=production."
    )
if IS_PRODUCTION and "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured(
        "ALLOWED_HOSTS must not be '*' when DJANGO_ENV=production."
    )


def env_bool(name, default=False):
    value = str(env(name, str(default))).strip().lower()
    if value not in {"true", "false", "1", "0", "yes", "no"}:
        raise ImproperlyConfigured(f"{name} must be a boolean value.")
    return value in {"true", "1", "yes"}


# Django admin is internal/emergency tooling only. It is disabled by default in
# production because the product administration surface is /api/admin/*.
DJANGO_ADMIN_ENABLED = env_bool("DJANGO_ADMIN_ENABLED", default=not IS_PRODUCTION)

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in env("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]
if IS_PRODUCTION and any(
    not origin.startswith("https://") for origin in CSRF_TRUSTED_ORIGINS
):
    raise ImproperlyConfigured(
        "DJANGO_CSRF_TRUSTED_ORIGINS must contain complete HTTPS origins in production."
    )

if IS_PRODUCTION:
    jwt_signing_key = env("JWT_SIGNING_KEY", SECRET_KEY)
    if len(jwt_signing_key) < 50 or jwt_signing_key.startswith("django-insecure-"):
        raise ImproperlyConfigured(
            "JWT_SIGNING_KEY must be a strong production secret of at least "
            "50 characters, or be omitted to use DJANGO_SECRET_KEY."
        )

# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    # Business applications will be registered here in apps.* when added.
    "apps.companies",
    "apps.authentication",
    "apps.reference_data",
    "apps.clients",
    "apps.document_templates",
    "apps.company_document_counters",
    "apps.generated_documents",
    "apps.audit_logs",
    "apps.database",
    "apps.system_admin",
]

# The project uses its own company-aware User model (apps.authentication.User).
# Setting AUTH_USER_MODEL is required so every auth lookup (request.user,
# get_user_model(), the JWT layer) references this model and never the stock
# django.contrib.auth.User.
AUTH_USER_MODEL = "authentication.User"

# Email is unique per company, not globally, so the stock ModelBackend is
# deliberately NOT used. See apps/authentication/backends.py.
AUTHENTICATION_BACKENDS = [
    "apps.authentication.backends.CompanyEmailBackend",
]

MIDDLEWARE = [
    # Application-level request-resource guard: rejects oversized request
    # bodies (Content-Length > MAX_REQUEST_BODY_SIZE) before any processing.
    "config.middleware.RequestBodySizeLimitMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME"),
        "USER": env("DB_USER"),
        "PASSWORD": env("DB_PASSWORD"),
        "HOST": env("DB_HOST"),
        "PORT": env("DB_PORT"),
    }
}

# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        )
    },
]

# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Maximum allowed size (bytes) for an uploaded document template file.
# Templates are .docx only; the limit is checked at the API layer.
MAX_TEMPLATE_FILE_SIZE = int(env("MAX_TEMPLATE_FILE_SIZE", 5 * 1024 * 1024))

# Maximum number of line items accepted in a single generated-document create
# request. Enforced at the API layer (before any document generation runs);
# oversized requests are rejected with 400, never truncated.
MAX_DOCUMENT_LINE_ITEMS = int(env("MAX_DOCUMENT_LINE_ITEMS", 500))

# Maximum HTTP request body size (bytes). Requests advertising a larger
# Content-Length are rejected with 413 (RequestBodySizeLimitMiddleware) before
# any serializer/view processing. This is an application-level guard; a
# reverse proxy / web server may additionally enforce its own body cap.
MAX_REQUEST_BODY_SIZE = int(env("MAX_REQUEST_BODY_SIZE", 10 * 1024 * 1024))

# LibreOffice binary used to convert generated DOCX files to PDF
# (document generation Step 4.5). Leave empty to auto-discover via PATH and
# common install locations; pin it explicitly when needed.
LIBREOFFICE_PATH = env("LIBREOFFICE_PATH", default="")
# Maximum seconds a single DOCX -> PDF conversion may take before failing.
PDF_CONVERSION_TIMEOUT = int(env("PDF_CONVERSION_TIMEOUT", 120))

# System Admin backups (Phase 9).
#
# Application-triggered PostgreSQL dumps require a pg_dump binary. The
# executable path is server configuration, never client input: leave
# PG_DUMP_PATH empty to auto-discover via PATH (shutil.which), or pin an
# explicit path (e.g. the PostgreSQL bin directory on the host). The backup
# capability is reported honestly — when no binary can be resolved, database
# backups are reported as unavailable instead of pretending to run.
PG_DUMP_PATH = env("PG_DUMP_PATH", default="")
# Directory that stores backup artifacts. It is deliberately OUTSIDE MEDIA_ROOT
# so backups are never reachable through any media/static/public URL. It must
# never be mounted at a web-served path.
BACKUP_ROOT = Path(env("BACKUP_ROOT", default=str(BASE_DIR / "backup_storage")))
# Maximum seconds a single backup creation may take before it is marked failed.
BACKUP_CREATION_TIMEOUT = int(env("BACKUP_CREATION_TIMEOUT", 300))

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Django REST Framework
# https://www.django-rest-framework.org/api-guide/settings/

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.authentication.api.authentication.CompanyJWTAuthentication",
    ],
    # Fail closed: new API views require an authenticated user by default.
    # Public endpoints (health, token endpoints) opt out explicitly.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Abuse protection (opt-in per view): ScopedRateThrottle only throttles
    # views that set `throttle_scope`; ordinary read/list endpoints are never
    # rate-limited. Authenticated scopes key on the authenticated user id,
    # and unauthenticated scopes (login/refresh) key on the client IP, so one
    # tenant can never exhaust another tenant's bucket. Rates are
    # configuration-driven (see .env.example).
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "auth_login": env("DRF_THROTTLE_AUTH_LOGIN", "10/min"),
        "auth_refresh": env("DRF_THROTTLE_TOKEN_REFRESH", "20/min"),
        "admin_login": env("DRF_THROTTLE_ADMIN_LOGIN", "5/min"),
        "admin_refresh": env("DRF_THROTTLE_ADMIN_REFRESH", "10/min"),
        "document_creation": env("DRF_THROTTLE_DOCUMENT_CREATION", "60/hour"),
        "document_generation": env("DRF_THROTTLE_DOCUMENT_GENERATION", "30/hour"),
        "pdf_generation": env("DRF_THROTTLE_PDF_GENERATION", "30/hour"),
    },
}

# Django REST Framework SimpleJWT configuration.
# The signing key comes from the environment (JWT_SIGNING_KEY) and, when
# unset, falls back to DJANGO_SECRET_KEY so secrets stay out of source code.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    "UPDATE_LAST_LOGIN": False,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env("JWT_SIGNING_KEY", SECRET_KEY),
    "VERIFYING_KEY": None,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_TYPE_CLAIM": "token_type",
    "JTI_CLAIM": "jti",
    # Enforced at token issue and refresh: the user and their company must
    # both be currently active (trial/active companies allowed).
    "USER_AUTHENTICATION_RULE": "apps.authentication.backends.active_user_rule",
    "TOKEN_OBTAIN_SERIALIZER": (
        "apps.authentication.api.serializers.CompanyTokenObtainPairSerializer"
    ),
}

# ---------------------------------------------------------------------------
# HTTPS / browser security settings (enabled only in production).
#
# These assume the application is served over HTTPS to the client. If TLS is
# terminated at a reverse proxy / load balancer in front of Django, set
# DJANGO_TRUST_PROXY_SSL_HEADER=True so Django trusts the proxy's
# "X-Forwarded-Proto" header instead of an unverified client-supplied value.
# Never enable that on a host where clients talk to Django directly (a client
# could spoof the header and bypass the HTTPS redirect).
#
# Deployment assumption: production is only reachable over HTTPS, either
# directly or behind a TLS-terminating reverse proxy / load balancer.
# ---------------------------------------------------------------------------
if IS_PRODUCTION:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    SECURE_REFERRER_POLICY = "same-origin"
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_SECURE = True
    # HSTS for one year; also a prerequisite for HSTS preload submission.
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    if env("DJANGO_TRUST_PROXY_SSL_HEADER", "False").lower() in {
        "true",
        "1",
        "yes",
    }:
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
