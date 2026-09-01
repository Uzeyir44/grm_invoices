from django.urls import path

from apps.document_templates.api.views import (
    DocumentTemplateDetailView,
    DocumentTemplateFileView,
    DocumentTemplateListCreateView,
)

urlpatterns = [
    path("", DocumentTemplateListCreateView.as_view(), name="document-template-list-create"),
    path("<int:pk>/", DocumentTemplateDetailView.as_view(), name="document-template-detail"),
    path("<int:pk>/file/", DocumentTemplateFileView.as_view(), name="document-template-file"),
]
