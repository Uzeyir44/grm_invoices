from django.db import IntegrityError
from django.utils import timezone

from django.http import FileResponse

from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.api.permissions import IsCompanyMember, permission_required
from apps.authentication.tenant import get_tenant_object_or_404, tenant_queryset
from apps.audit_logs.services import (
    create_audit_log,
    diff_snapshots,
    request_metadata,
)
from apps.document_templates.api.serializers import (
    DocumentTemplateFileSerializer,
    DocumentTemplateSerializer,
    TemplateVersionSerializer,
)
from apps.document_templates.docx_text import extract_docx_text
from apps.document_templates.models import DocumentTemplate, TemplateVersion
from apps.document_templates.services import versioning
from apps.document_templates.variables import validate_placeholders


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


def _template_snapshot(template):
    """Small business snapshot of a template for audit events."""
    return {
        "name": template.name,
        "document_type_id": template.document_type_id,
        "is_active": template.is_active,
    }


def _template_version_snapshot(version):
    """Small business snapshot of a template version for audit events."""
    return {
        "template_id": version.template_id,
        "version_number": version.version_number,
        "is_active": version.is_active,
    }


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
        template = serializer.instance
        meta = request_metadata(request)
        create_audit_log(
            company=template.company,
            user=request.user,
            action="create",
            entity_type="document_template",
            entity_id=template.id,
            previous_values=None,
            new_values=_template_snapshot(template),
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
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
        before = _template_snapshot(template)
        serializer = DocumentTemplateSerializer(
            template,
            data=request.data,
            partial=True,
            context={"request": request, "company": request.user.company},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        after = _template_snapshot(serializer.instance)
        previous, new = diff_snapshots(before, after)
        if previous or new:
            meta = request_metadata(request)
            create_audit_log(
                company=template.company,
                user=request.user,
                action="update",
                entity_type="document_template",
                entity_id=template.id,
                previous_values=previous,
                new_values=new,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
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


def version_object_or_404(request, template, version_id):
    """
    Tenant-scoped version lookup that also enforces the version belongs to
    the given (already tenant-verified) template — Rule D + Rule E.
    """
    return get_tenant_object_or_404(
        TemplateVersion,
        request.user.company,
        pk=version_id,
        template_id=template.id,
    )


class DocumentTemplateVersionListCreateView(MethodPermissionAPIView):
    """
      GET  -> list this template's versions (tenant-scoped)
      POST -> create a new immutable version snapshot from the template's
              current file; validates placeholders in the actual docx text.
    """

    method_permissions = {
        "GET": "document_templates.read",
        "POST": "document_templates.version_create",
    }

    def get(self, request, pk):
        template = template_object_or_404(request, pk)
        versions = tenant_queryset(TemplateVersion, request.user.company).filter(
            template_id=template.id
        ).order_by("version_number")
        return Response(TemplateVersionSerializer(versions, many=True).data)

    def post(self, request, pk):
        template = template_object_or_404(request, pk)
        if not template.file:
            return Response(
                {"detail": "This template has no file to snapshot."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Inspect the actual document text and reject unknown/malformed
        # placeholders before a version is recorded.
        template.file.open("rb")
        try:
            text = extract_docx_text(template.file)
        except ValueError as exc:
            template.file.close()
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        template.file.close()
        _valid, invalid = validate_placeholders(text)
        if invalid:
            return Response(
                {
                    "detail": (
                        "The template contains invalid or unknown placeholders."
                    ),
                    "invalid_placeholders": invalid,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        template.file.open("rb")
        try:
            version = versioning.create_version(
                template, template.file, created_by=request.user
            )
        finally:
            # Caller opened the handle; close it so Windows can release the
            # file lock (the next file replacement deletes the previous file).
            template.file.close()
        meta = request_metadata(request)
        create_audit_log(
            company=template.company,
            user=request.user,
            action="version_create",
            entity_type="document_template_version",
            entity_id=version.id,
            previous_values=None,
            new_values=_template_version_snapshot(version),
            ip_address=meta["ip_address"],
            user_agent=meta["user_agent"],
        )
        return Response(
            TemplateVersionSerializer(version).data, status=status.HTTP_201_CREATED
        )


class DocumentTemplateVersionDetailView(MethodPermissionAPIView):
    """
      GET -> retrieve a specific version. Versions are immutable history, so
      there is deliberately no update or delete handler.
    """

    method_permissions = {
        "GET": "document_templates.read",
    }

    def get(self, request, pk, version_id):
        template = template_object_or_404(request, pk)
        version = version_object_or_404(request, template, version_id)
        return Response(TemplateVersionSerializer(version).data)


class DocumentTemplateVersionActivateView(MethodPermissionAPIView):
    """
    POST .../versions/<version_id>/activate/ — make this version the
    template's single active version. Company-scoped and RBAC-protected.
    """

    method_permissions = {"POST": "document_templates.version_activate"}

    def post(self, request, pk, version_id):
        template = template_object_or_404(request, pk)
        version = version_object_or_404(request, template, version_id)
        before = _template_version_snapshot(version)
        versioning.activate_version(template, version)
        after = _template_version_snapshot(version)
        previous, new = diff_snapshots(before, after)
        if previous or new:
            meta = request_metadata(request)
            create_audit_log(
                company=template.company,
                user=request.user,
                action="version_activate",
                entity_type="document_template_version",
                entity_id=version.id,
                previous_values=previous,
                new_values=new,
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        return Response(TemplateVersionSerializer(version).data)
