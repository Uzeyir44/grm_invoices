"""
PDF generation for generated documents (Step 4.5 of document generation).

Given an already-successfully-generated :class:`GeneratedDocumentVersion` that
holds a rendered DOCX (``storage_path_docx``), this service converts that DOCX
to PDF, persists the PDF through Django's configured default storage, and
records the returned path on the version's existing ``storage_path_pdf`` field.

The service is deliberately independent of HTTP/DRF: no request objects, no
views. It reuses the already-generated DOCX and does **not** re-render the
template, touch the placeholder engine, process line items, create a new
:class:`GeneratedDocumentVersion`, or modify the stored DOCX (Step 4.4 is
untouched).

Conversion runtime
------------------
DOCX -> PDF is delegated to LibreOffice (``soffice``) running headless. This
keeps the pipeline free of a heavyweight PDF library and uses the standard
"office document conversion" runtime. LibreOffice is a *system* dependency,
not a pip package:

* Ubuntu/Debian: ``sudo apt-get install libreoffice-writer``
* macOS: ``brew install --cask libreoffice``
* Windows: install from https://www.libreoffice.org/download/

The binary is located via ``shutil.which`` plus common install locations. It
can be pinned with the ``LIBREOFFICE_PATH`` setting / environment variable.
If no runtime is found (or the conversion fails), a clear
:class:`PdfConversionUnavailableError` is raised — the implementation never
silently produces a fake PDF.

Failure behavior
----------------
Converting a PDF is an **additional** operation on top of a successful DOCX
generation. If conversion fails, the exception propagates, ``storage_path_pdf``
is left unchanged (never populated), no half-written PDF is left in storage,
and the already-successful DOCX version stays intact.

Idempotency / storage path
--------------------------
The PDF storage path is derived deterministically from the recorded DOCX path
(``storage_path_docx`` with the ``.docx`` suffix changed to ``.pdf``), so it
lives in the same per-company/per-document/per-version directory used by Step
4.4. Regenerating the PDF for the same version replaces the file at that same
deterministic path (delete-then-save, mirroring Step 4.4's orphan handling)
instead of creating uncontrolled duplicate files.
"""

import os
import shutil
import subprocess
import tempfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

_PDF_HEADER = b"%PDF"
_DEFAULT_TIMEOUT = 120


class PdfGenerationError(Exception):
    """Base error for the DOCX -> PDF generation service."""


class PdfConversionUnavailableError(PdfGenerationError):
    """The DOCX -> PDF conversion runtime (LibreOffice) is unavailable or failed."""


def _find_soffice():
    """
    Locate a LibreOffice ``soffice`` executable.

    Resolution order: the ``LIBREOFFICE_PATH`` setting, ``shutil.which``, then
    a handful of common install locations. Returns ``None`` when unavailable.
    """
    configured = getattr(settings, "LIBREOFFICE_PATH", None)
    if configured:
        return configured
    found = shutil.which("soffice")
    if found:
        return found
    candidates = (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/opt/libreoffice/program/soffice",
    )
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return None


def _profile_url(path):
    """
    Convert an absolute directory path into a LibreOffice
    ``-env:UserInstallation=file:///...`` URL (a unique per-call profile avoids
    profile-lock conflicts between concurrent headless instances).
    """
    return "file:///" + path.replace("\\", "/").lstrip("/")


def convert_docx_bytes_to_pdf(docx_bytes, *, soffice_path=None, timeout=None):
    """
    Convert raw DOCX bytes to raw PDF bytes using LibreOffice headless.

    Args:
        docx_bytes: the complete .docx package bytes.
        soffice_path: explicit path to a ``soffice`` binary; defaults to
            :func:`_find_soffice`.
        timeout: max seconds for the conversion; defaults to
            ``PDF_CONVERSION_TIMEOUT`` (120).

    Returns the PDF bytes.

    Raises:
        PdfConversionUnavailableError: no LibreOffice runtime can be found or
            the conversion does not produce a PDF.
        PdfGenerationError: the conversion times out.
    """
    soffice = soffice_path or _find_soffice()
    if not soffice:
        raise PdfConversionUnavailableError(
            "LibreOffice ('soffice') is required for DOCX -> PDF conversion "
            "but could not be found. Install LibreOffice or pin the binary "
            "via the LIBREOFFICE_PATH setting."
        )
    if timeout is None:
        timeout = int(getattr(settings, "PDF_CONVERSION_TIMEOUT", _DEFAULT_TIMEOUT))

    with tempfile.TemporaryDirectory() as workdir:
        input_dir = os.path.join(workdir, "in")
        output_dir = os.path.join(workdir, "out")
        profile_dir = os.path.join(workdir, "profile")
        os.makedirs(input_dir)
        os.makedirs(output_dir)

        input_path = os.path.join(input_dir, "document.docx")
        with open(input_path, "wb") as fh:
            fh.write(docx_bytes)

        command = [
            soffice,
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--nodefault",
            "-env:UserInstallation=" + _profile_url(profile_dir),
            "--convert-to",
            "pdf",
            "--outdir",
            output_dir,
            input_path,
        ]
        try:
            result = subprocess.run(command, capture_output=True, timeout=timeout)
        except FileNotFoundError as exc:
            raise PdfConversionUnavailableError(
                f"The configured LibreOffice binary '{soffice}' could not be "
                "executed."
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise PdfGenerationError(
                f"DOCX -> PDF conversion timed out after {timeout}s."
            ) from exc

        output_path = os.path.join(output_dir, "document.pdf")
        if result.returncode != 0 or not os.path.exists(output_path):
            details = (result.stderr or result.stdout or b"").decode(
                "utf-8", errors="replace"
            ).strip()
            raise PdfConversionUnavailableError(
                "LibreOffice conversion failed (return code "
                f"{result.returncode}). {details}"
            )

        with open(output_path, "rb") as fh:
            return fh.read()


def _is_pdf_bytes(data):
    """Cheap structural check: a PDF opens with the ``%PDF`` header."""
    return isinstance(data, bytes) and data.startswith(_PDF_HEADER)


def _read_stored_docx(path):
    """Read the DOCX recorded on a version from Django storage."""
    try:
        with default_storage.open(path, "rb") as fh:
            return fh.read()
    except FileNotFoundError as exc:
        raise PdfGenerationError(
            f"The stored DOCX at '{path}' could not be read."
        ) from exc


def _pdf_storage_path(version):
    """
    Deterministic PDF path for ``version``: the recorded DOCX path with the
    ``.docx`` suffix replaced by ``.pdf`` (same per-company/per-document/per-
    version directory as Step 4.4).
    """
    docx_path = version.storage_path_docx
    if not docx_path:
        raise PdfGenerationError(
            "The GeneratedDocumentVersion has no stored DOCX "
            "(storage_path_docx is empty) to convert."
        )
    if docx_path.lower().endswith(".docx"):
        return docx_path[: -len(".docx")] + ".pdf"
    return docx_path + ".pdf"


def generate_pdf(version, *, converter=None):
    """
    Convert ``version``'s stored DOCX to PDF, persist it, and record it.

    Args:
        version: an existing :class:`GeneratedDocumentVersion` that already has
            a successfully generated DOCX (``storage_path_docx`` set).
        converter: optional callable ``f(docx_bytes) -> pdf_bytes`` used for
            the actual conversion; defaults to LibreOffice headless. Injectable
            for tests.

    Returns:
        The same ``version`` instance with ``storage_path_pdf`` updated and
        persisted.

    Raises:
        PdfConversionUnavailableError / PdfGenerationError: conversion failed.
            ``storage_path_pdf`` is left unchanged, no PDF is left in storage,
            and the stored DOCX is not modified.
    """
    if version is None:
        raise PdfGenerationError("A GeneratedDocumentVersion is required.")
    if not version.storage_path_docx:
        raise PdfGenerationError(
            "The GeneratedDocumentVersion has no stored DOCX to convert."
        )

    if converter is None:

        def _libreoffice_converter(docx_bytes):
            return convert_docx_bytes_to_pdf(docx_bytes)

        converter = _libreoffice_converter

    docx_bytes = _read_stored_docx(version.storage_path_docx)
    pdf_bytes = converter(docx_bytes)
    if not _is_pdf_bytes(pdf_bytes):
        raise PdfGenerationError(
            "DOCX -> PDF conversion produced invalid PDF output."
        )

    pdf_path = _pdf_storage_path(version)
    # Deterministic replacement (mirrors Step 4.4's orphan handling): the path
    # is derived from this version's DOCX, so it can only belong here. A stale
    # file from a previous failed attempt or an earlier regeneration is removed
    # before storing so the recorded path is stable.
    default_storage.delete(pdf_path)
    try:
        stored_name = default_storage.save(pdf_path, ContentFile(pdf_bytes))
    except Exception:
        default_storage.delete(pdf_path)
        raise

    version.storage_path_pdf = stored_name
    version.save(update_fields=["storage_path_pdf"])
    return version