/** Client-side file saving (blobs, data URLs, text). */

/** Click a temporary <a download> element. */
export function triggerDownload(href: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  // Give the browser time to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Decode a data: URL (base64 or percent-encoded) into a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Not a data URL.');
  const meta = dataUrl.slice(5, comma);
  const data = dataUrl.slice(comma + 1);
  const mime = meta.split(';')[0] || 'application/octet-stream';
  if (/;base64$/i.test(meta)) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

/** Save a data URL (e.g. a rendered PNG/SVG) as a file. */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  try {
    saveBlob(dataUrlToBlob(dataUrl), fileName);
  } catch {
    triggerDownload(dataUrl, fileName);
  }
}

export function downloadText(text: string, fileName: string, mime = 'text/plain'): void {
  saveBlob(new Blob([text], { type: `${mime};charset=utf-8` }), fileName);
}
