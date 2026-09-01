from django.urls import path

from apps.document_templates.api.views import (
    DocumentTemplateDetailView,
    DocumentTemplateFileView,
    DocumentTemplateListCreateView,
    DocumentTemplateVersionActivateView,
    DocumentTemplateVersionDetailView,
    DocumentTemplateVersionListCreateView,
)

urlpatterns = [
    path("", DocumentTemplateListCreateView.as_view(), name="document-template-list-create"),
    path("<int:pk>/", DocumentTemplateDetailView.as_view(), name="document-template-detail"),
    path("<int:pk>/file/", DocumentTemplateFileView.as_view(), name="document-template-file"),
    path(
        "<int:pk>/versions/",
        DocumentTemplateVersionListCreateView.as_view(),
        name="document-template-version-list-create",
    ),
    path(
        "<int:pk>/versions/<int:version_id>/",
        DocumentTemplateVersionDetailView.as_view(),
        name="document-template-version-detail",
    ),
    path(
        "<int:pk>/versions/<int:version_id>/activate/",
        DocumentTemplateVersionActivateView.as_view(),
        name="document-template-version-activate",
    ),
]
