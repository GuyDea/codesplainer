/** File download responses (exports). */
import type { FastifyReply } from 'fastify';
import type { Download } from '../services/exchange';

/** ASCII-only, quote-free file name for Content-Disposition. */
export function safeFileName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '');
  return clean || 'download';
}

export function sendDownload(reply: FastifyReply, download: Download): FastifyReply {
  return reply
    .header('content-type', download.contentType)
    .header('content-disposition', `attachment; filename="${safeFileName(download.filename)}"`)
    .header('cache-control', 'no-store')
    .send(download.body);
}
