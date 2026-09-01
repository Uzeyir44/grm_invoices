"""
Minimal .docx text extraction for placeholder validation.

A .docx is a ZIP package; the visible body text lives in
``word/document.xml`` under ``<w:t>`` elements (with the WordprocessingML
namespace). We parse only the text runs with the standard library, so no
large dependency (python-docx / lxml) needs to be introduced just to
validate placeholders.

This is deliberately NOT a general-purpose docx renderer — it only needs the
plain text to run the placeholder validator.
"""

import re
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def extract_docx_text(fileobj):
    """
    Return the plain text of a .docx file-like object.

    Raises ValueError if the file is not a valid docx zip or has no
    word/document.xml member.
    """
    try:
        with ZipFile(fileobj) as zf:
            names = set(zf.namelist())
            # Document body may be in the root document.xml or a
            # rels-indirected location; the common case is the root member.
            member = next(
                (n for n in ("word/document.xml",) if n in names), None
            )
            if member is None:
                raise ValueError("No word/document.xml in the submitted docx.")
            raw = zf.read(member)
    except BadZipFile as exc:
        raise ValueError("The uploaded file is not a valid .docx (Word) file.") from exc

    root = ET.fromstring(raw)
    return "".join(
        (t.text or "")
        for t in root.iter(W_NS + "t")
        if t.text
    )
