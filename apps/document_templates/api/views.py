from django.db import IntegrityError
from django.utils import timezone

from django.http import FileResponse

from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.api.permissions import IsCompanyMember, permission_required
from apps.authentication.tenant import get_tenant_object_or_404, tenant_queryset
from apps.document_templates.api.serializers import (
    DocumentTemplateFileSerializer,
    DocumentTemplateSerializer,
)
from apps.document_templates.models import DocumentTemplate


class MethodPermissionAPIView(APIView):
    """
    Base view that requires a company member and, per HTTP method, a specific
    RBAC permission code through the existing permission_required(...) factory.
    """

    permission_classes = [IsCompanyMember]
    method_permissions = {}

    def get_permissions(self):
        permissions = super().get_permissions()
        code = self.method_permissions.get(self.request.method)
        if code:
            permissions.append(permission_required(code)())
        return permissions

    def handle_exception(self, exc):
        if isinstance(exc, IntegrityError):
            # The DB is the final integrity layer; surface constraint
            # conflicts as client errors rather than 500s.
            return Response(
                {
                    "detail": (
                        "The submitted data conflicts with existing document "
                        "template records."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().handle_exception(exc)


def template_object_or_404(request, pk):
    """Tenant-scoped, non-soft-deleted template lookup (Rule D)."""
    return get_tenant_object_or_404(
        DocumentTemplate, request.user.company, pk=pk, deleted_at__isnull=True
    )


class DocumentTemplateListCreateView(MethodPermissionAPIView):
    method_permissions = {
        "GET": "document_templates.read",
        "POST": "document_templates.create",
    }

    def get(self, request):
        queryset = tenant_queryset(DocumentTemplate, request.user.company).filter(
            deleted_at__isnull=True
        )
        document_type = request.query_params.get("document_type")
        if document_type:
            queryset = queryset.filter(document_type_id=document_type)
        serializer = DocumentTemplateSerializer(queryset, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = DocumentTemplateSerializer(
            data=request.data,
            context={"request": request, "company": request.user.company},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(company=request.user.company)
        return Response(
            DocumentTemplateSerializer(
                serializer.instance,
                context={"request": request, "company": request.user.company},
            ).data,
            status=status.HTTP_201_CREATED,
        )


class DocumentTemplateDetailView(MethodPermissionAPIView):
    method_permissions = {
        "GET": "document_templates.read",
        "PATCH": "document_templates.update",
        "DELETE": "document_templates.delete",
    }

    def get(self, request, pk):
        template = template_object_or_404(request, pk)
        return Response(DocumentTemplateSerializer(template).data)

    def patch(self, request, pk):
        template = template_object_or_404(request, pk)
        serializer = DocumentTemplateSerializer(
            template,
            data=request.data,
            partial=True,
            context={"request": request, "company": request.user.company},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(DocumentTemplateSerializer(serializer.instance).data)

    def delete(self, request, pk):
        template = template_object_or_404(request, pk)
        template.deleted_at = timezone.now()
        template.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentTemplateFileView(MethodPermissionAPIView):
    """
    Manage the single current .docx file of a template (versioning is a
    later step, so each template holds exactly one file and uploading
    replaces it).

      GET    -> download the template file
      POST   -> upload / replace the template file
      DELETE -> remove the template file (not the template row)

    All operations are tenant-scoped and require the RBAC permission matching
    the method. A template file path is never exposed to clients; retrieval
    streams the bytes back.
    """

    parser_classes = [MultiPartParser, FormParser]
    method_permissions = {
        "GET": "document_templates.read",
        "POST": "document_templates.update",
        "DELETE": "document_templates.update",
    }

    def get(self, request, pk):
        template = template_object_or_404(request, pk)
        if not template.file:
            return Response(
                {"detail": "This template has no file uploaded yet."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return FileResponse(
            template.file.open("rb"),
            as_attachment=True,
            filename="template.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument."
                "wordprocessingml.document"
            ),
        )

    def post(self, request, pk):
        template = template_object_or_404(request, pk)
        serializer = DocumentTemplateFileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if template.file:
            # Close any open handle first so Windows can release the lock
            # before the underlying file is removed / overwritten.
            template.file.close()
            template.file.delete(save=False)
        template.file = serializer.validated_data["file"]
        template.save(update_fields=["file", "updated_at"])
        return Response(
            {
                "id": template.id,
                "file": template.file.url if template.file else None,
                "file_name": template.file.name if template.file else None,
            },
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request, pk):
        template = template_object_or_404(request, pk)
        if not template.file:
            return Response(
                {"detail": "This template has no file uploaded yet."},
                status=status.HTTP_404_NOT_FOUND,
            )
        # Close any open handle first so Windows releases the file lock.
        template.file.close()
        template.file.delete(save=False)
        template.file = None
        template.save(update_fields=["file", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
