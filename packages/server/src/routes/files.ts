/** Files inside workspace folders: directory listings, file contents, open in editor. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openInEditorBodySchema } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { listDirectory } from '../fs/dir';
import { openInEditor } from '../fs/editor';
import { readWorkspaceFile } from '../fs/file';
import { resolveInFolder } from '../fs/paths';
import { parseWith } from '../http/validate';

type IdParams = { Params: { id: string } };

const locationQuery = z.object({
  folder: z.string().default(''),
  path: z.string().default(''),
});

export function registerFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<IdParams>('/api/workspaces/:id/dir', async (request) => {
    const workspace = ctx.workspaces.get(request.params.id);
    const query = parseWith(locationQuery, request.query, 'query');
    return listDirectory(workspace, query.folder || undefined, query.path, ctx.ignoreRules);
  });

  app.get<IdParams>('/api/workspaces/:id/file', async (request) => {
    const workspace = ctx.workspaces.get(request.params.id);
    const query = parseWith(locationQuery, request.query, 'query');
    return readWorkspaceFile(workspace, query.folder || undefined, query.path);
  });

  app.post<IdParams>('/api/workspaces/:id/open', async (request) => {
    const workspace = ctx.workspaces.get(request.params.id);
    const body = parseWith(openInEditorBodySchema, request.body);
    const target = await resolveInFolder(workspace, body.folder, body.path);
    const line = target.stats.isFile() ? body.line : undefined;
    const command = await openInEditor(target.abs, line, ctx.stores.settings.get().editorCommand);
    return { ok: true as const, command };
  });
}
