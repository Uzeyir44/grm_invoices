import type { GeneratedDocumentVersion } from '../../types/generatedDocument'

/**
 * Select the document version the file actions should target: the newest
 * version that has a stored DOCX. The same selection drives the Documents list
 * and the detail page so View / Download DOCX / Download PDF always use the
 * same version. A PDF is only used when the selected version reports
 * `storage.pdf` (files live on the version, not on the document row).
 */
export function selectLatestDownloadableVersion(
  versions: GeneratedDocumentVersion[] | null,
): GeneratedDocumentVersion | null {
  if (versions === null || versions.length === 0) return null
  return [...versions].reverse().find((version) => version.storage.docx) ?? null
}