"""
URL configuration for the GRM CRM project.

Business application URLs will be included here (e.g.
``path("clients/", include("apps.clients.urls"))``) as domains are added.
"""

from django.contrib import admin
from django.conf import settings
from django.urls import include, path

urlpatterns = [
    path("api/", include("config.api_urls")),
]

if settings.DJANGO_ADMIN_ENABLED:
    urlpatterns.insert(0, path("admin/", admin.site.urls))
