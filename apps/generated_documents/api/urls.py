from django.urls import path

from apps.generated_documents.api.views import (
    GeneratedDocumentDetailView,
    GeneratedDocumentGenerateView,
    GeneratedDocumentListView,
    GeneratedDocumentVersionDocxDownloadView,
    GeneratedDocumentVersionGeneratePdfView,
    GeneratedDocumentVersionListView,
    GeneratedDocumentVersionPdfDownloadView,
)

urlpatterns = [
    path(
        "",
        GeneratedDocumentListView.as_view(),
        name="generated-document-list",
    ),
    path(
        "<int:pk>/",
        GeneratedDocumentDetailView.as_view(),
        name="generated-document-detail",
    ),
    path(
        "<int:pk>/generate/",
        GeneratedDocumentGenerateView.as_view(),
        name="generated-document-generate",
    ),
    path(
        "<int:pk>/versions/",
        GeneratedDocumentVersionListView.as_view(),
        name="generated-document-version-list",
    ),
    path(
        "versions/<int:version_id>/generate-pdf/",
        GeneratedDocumentVersionGeneratePdfView.as_view(),
        name="generated-document-version-generate-pdf",
    ),
    path(
        "versions/<int:version_id>/docx/",
        GeneratedDocumentVersionDocxDownloadView.as_view(),
        name="generated-document-version-docx",
    ),
    path(
        "versions/<int:version_id>/pdf/",
        GeneratedDocumentVersionPdfDownloadView.as_view(),
        name="generated-document-version-pdf",
    ),
]