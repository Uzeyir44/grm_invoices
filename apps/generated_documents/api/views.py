"""
Step 4.6 — Generation API & secure download endpoints for generated documents.

Thin adapter views around the existing Step 4.4 (DOCX generation) and Step 4.5
(PDF generation) services. No business logic lives here:

    HTTP request
        -> existing JWT authentication
        -> tenant isolation (existing helpers; cross-tenant == 404)
        -> RBAC (existing permission factory)
        -> existing generation services / Django default storage
        -> HTTP response

Downloads read files through ``default_storage`` and stream them back with an
attachment response; storage paths are never exposed to clients.
"""

import re

from django.core.files.storage import default_storage
from django.db import IntegrityError
from django.http import FileResponse

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.api.permissions import IsCompanyMember, permission_required
from apps.authentication.tenant import get_tenant_object_or_404, tenant_queryset
from apps.audit_logs.services import request_metadata
from apps.clients.models import Client
from apps.generated_documents.api.serializers import (
    GeneratedDocumentCreateSerializer,
    GeneratedDocumentGenerateSerializer,
    GeneratedDocumentSerializer,
    GeneratedDocumentVersionSerializer,
)
from apps.generated_documents.models import GeneratedDocument, GeneratedDocumentVersion
from apps.generated_documents.services.context import GenerationContextError
from apps.generated_documents.services.document_creation import (
    DocumentCreationError,
    create_generated_document,
)
from apps.generated_documents.services.generator import (
    GenerationError,
    generate_document,
)
from apps.generated_documents.services.pdf_generator import (
    PdfConversionUnavailableError,
    PdfGenerationError,
    generate_pdf,
)
from apps.generated_documents.services.placeholder_engine import (
    PlaceholderEngineError,
)
from apps.reference_data.models import Currency

DOCX_MIME = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
PDF_MIME = "application/pdf"


class MethodPermissionAPIView(APIView):
    """
    Base view: requires an active company member and, per HTTP method, a
    specific RBAC permission code via the existing ``permission_required``
    factory (same pattern as the other feature APIs).
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
            # The DB is the final integrity layer; surface a constraint
            # conflict as a controlled client error, not a 500.
            return Response(
                {
                    "detail": (
                        "The request conflicted with existing "
                        "generated-document records."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().handle_exception(exc)


def document_object_or_404(request, pk):
    """Tenant-scoped, non-soft-deleted generated-document lookup (Rule D)."""
    return get_tenant_object_or_404(
        GeneratedDocument, request.user.company, pk=pk, deleted_at__isnull=True
    )


def version_object_or_404(request, version_id):
    """Tenant-scoped generated-document-version lookup (Rule D)."""
    return get_tenant_object_or_404(
        GeneratedDocumentVersion, request.user.company, pk=version_id
    )


def _safe_download_stem(value):
    """Reduce arbitrary text to a safe filename stem (no slashes, no dot-dirs)."""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "")
    return stem.strip("._")[:80]


def download_filename(version, extension):
    """
    Sanitized, deterministic download filename from existing document
    metadata (document number + version number). Never the storage path, never
    raw user input.
    """
    number = _safe_download_stem(version.generated_document.document_number)
    if not number:
        number = f"document_{version.generated_document_id}"
    return f"{number}-v{version.version_number}.{extension}"


def _stream_version_file(version, storage_path, extension, content_type):
    """Stream a version's stored file as an attachment (404 when absent)."""
    if not storage_path:
        return Response(
            {"detail": "The requested file does not exist."},
            status=status.HTTP_404_NOT_FOUND,
        )
    try:
        file_handle = default_storage.open(storage_path, "rb")
    except FileNotFoundError:
        return Response(
            {"detail": "The requested file does not exist."},
            status=status.HTTP_404_NOT_FOUND,
        )
    return FileResponse(
        file_handle,
        as_attachment=True,
        filename=download_filename(version, extension),
        content_type=content_type,
    )


class GeneratedDocumentListView(MethodPermissionAPIView):
    """
      GET  -> list the caller's company documents
      POST -> create a document (automatic numbering + initial version), then
              the existing pipeline generates DOCX/PDF from it separately.
    """

    method_permissions = {
        "GET": "generated_documents.read",
        "POST": "generated_documents.generate",
    }

    def get(self, request):
        queryset = (
            tenant_queryset(GeneratedDocument, request.user.company)
            .filter(deleted_at__isnull=True)
            .order_by("-created_at")
        )
        return Response(GeneratedDocumentSerializer(queryset, many=True).data)

    def post(self, request):
        serializer = GeneratedDocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # The client must belong to the caller's company; a cross-company or
        # missing client is indistinguishable and resolves to 404 (Rule D).
        client = get_tenant_object_or_404(
            Client,
            request.user.company,
            pk=serializer.validated_data["client_id"],
            deleted_at__isnull=True,
        )
        meta = request_metadata(request)
        try:
            document = create_generated_document(
                company=request.user.company,
                user=request.user,
                client=client,
                document_type_id=serializer.validated_data["document_type_id"],
                currency_id=serializer.validated_data.get("currency_id"),
                items=serializer.validated_data.get("items"),
                ip_address=meta["ip_address"],
                user_agent=meta["user_agent"],
            )
        except DocumentCreationError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            GeneratedDocumentSerializer(
                document,
                context={"request": request, "company": request.user.company},
            ).data,
            status=status.HTTP_201_CREATED,
        )


class GeneratedDocumentDetailView(MethodPermissionAPIView):
    method_permissions = {"GET": "generated_documents.read"}

    def get(self, request, pk):
        document = document_object_or_404(request, pk)
        return Response(GeneratedDocumentSerializer(document).data)


class GeneratedDocumentGenerateView(MethodPermissionAPIView):
    """
    POST .../generated-documents/<id>/generate/ — generate (and persist) a
    DOCX for the existing document through the Step 4.4 service. Returns the
    newly created GeneratedDocumentVersion.
    """

    method_permissions = {"POST": "generated_documents.generate"}

    def post(self, request, pk):
        document = document_object_or_404(request, pk)
        input_serializer = GeneratedDocumentGenerateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        currency_id = input_serializer.validated_data.get("currency_id")
        currency = None
        if currency_id is not None:
            currency = Currency.objects.filter(pk=currency_id).first()
            if currency is None:
                return Response(
                    {"detail": "Unknown currency."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        try:
            version = generate_document(
                document, currency=currency, generated_by=request.user
            )
        except GenerationError:
            return Response(
                {
                    "detail": (
                        "Document generation failed. Check the document, "
                        "client, and template version data."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except GenerationContextError:
            return Response(
                {
                    "detail": (
                        "Document generation failed because required data is "
                        "missing."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except PlaceholderEngineError:
            return Response(
                {
                    "detail": (
                        "Document generation failed because the template "
                        "contains invalid placeholders."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            GeneratedDocumentVersionSerializer(version).data,
            status=status.HTTP_201_CREATED,
        )


class GeneratedDocumentVersionListView(MethodPermissionAPIView):
    """GET .../generated-documents/<id>/versions/ — list a document's versions."""

    method_permissions = {"GET": "generated_documents.read"}

    def get(self, request, pk):
        document = document_object_or_404(request, pk)
        versions = (
            tenant_queryset(GeneratedDocumentVersion, request.user.company)
            .filter(generated_document_id=document.id)
            .order_by("version_number")
        )
        return Response(GeneratedDocumentVersionSerializer(versions, many=True).data)


class GeneratedDocumentVersionGeneratePdfView(MethodPermissionAPIView):
    """
    POST .../generated-documents/versions/<id>/generate-pdf/ — convert an
    already-generated version's DOCX to PDF through the Step 4.5 service.
    """

    method_permissions = {"POST": "generated_documents.generate"}

    def post(self, request, version_id):
        version = version_object_or_404(request, version_id)
        try:
            result = generate_pdf(version, generated_by=request.user)
        except PdfConversionUnavailableError:
            return Response(
                {"detail": "PDF conversion is currently unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except PdfGenerationError:
            return Response(
                {"detail": "PDF generation failed for this version."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(GeneratedDocumentVersionSerializer(result).data)


class GeneratedDocumentVersionDocxDownloadView(MethodPermissionAPIView):
    """GET .../generated-documents/versions/<id>/docx/ — download the DOCX."""

    method_permissions = {"GET": "generated_documents.read"}

    def get(self, request, version_id):
        version = version_object_or_404(request, version_id)
        return _stream_version_file(
            version, version.storage_path_docx, "docx", DOCX_MIME
        )


class GeneratedDocumentVersionPdfDownloadView(MethodPermissionAPIView):
    """GET .../generated-documents/versions/<id>/pdf/ — download the PDF."""

    method_permissions = {"GET": "generated_documents.read"}

    def get(self, request, version_id):
        version = version_object_or_404(request, version_id)
        return _stream_version_file(
            version, version.storage_path_pdf, "pdf", PDF_MIME
        )