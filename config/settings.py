"""
Django settings for the GRM CRM project.

Settings are configured via environment variables (loaded from ``.env``
when present) so configuration stays separate from the business code.
"""

import os
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")


def env(name, default=None):
    """Read an environment variable, returning ``default`` when unset."""
    return os.environ.get(name, default)


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    "django-insecure-change-me-in-production",
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env("DJANGO_DEBUG", "True").lower() in {"true", "1", "yes"}

ALLOWED_HOSTS = [
    host.strip()
    for host in env("DJANGO_ALLOWED_HOSTS", "").split(",")
    if host.strip()
]

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

# LibreOffice binary used to convert generated DOCX files to PDF
# (document generation Step 4.5). Leave empty to auto-discover via PATH and
# common install locations; pin it explicitly when needed.
LIBREOFFICE_PATH = env("LIBREOFFICE_PATH", default="")
# Maximum seconds a single DOCX -> PDF conversion may take before failing.
PDF_CONVERSION_TIMEOUT = int(env("PDF_CONVERSION_TIMEOUT", 120))

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