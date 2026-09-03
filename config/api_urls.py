from django.urls import include, path
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok"}, status=status.HTTP_200_OK)


urlpatterns = [
    path("health/", health, name="api-health"),
    path("authentication/", include("apps.authentication.api.urls")),
    path("clients/", include("apps.clients.api.urls")),
    path("document-templates/", include("apps.document_templates.api.urls")),
    path("generated-documents/", include("apps.generated_documents.api.urls")),
    path("audit-logs/", include("apps.audit_logs.api.urls")),
    path("reference-data/", include("apps.reference_data.api.urls")),
]