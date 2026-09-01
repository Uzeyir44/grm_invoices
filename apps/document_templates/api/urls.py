from django.urls import path

from apps.document_templates.api.views import (
    DocumentTemplateDetailView,
    DocumentTemplateListCreateView,
)

urlpatterns = [
    path("", DocumentTemplateListCreateView.as_view(), name="document-template-list-create"),
    path("<int:pk>/", DocumentTemplateDetailView.as_view(), name="document-template-detail"),
]
