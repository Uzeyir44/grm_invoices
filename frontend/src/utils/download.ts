/**
 * Trigger the browser's download for a binary `Blob` and clean up its URL.
 *
 * The temporary object URL is created, used for the download, and revoked
 * immediately so no Blob URLs leak.
 */
export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}