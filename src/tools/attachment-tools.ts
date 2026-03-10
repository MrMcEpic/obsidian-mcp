import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'path';
import type { ToolHandler } from './types.js';
import { success } from './types.js';

export const definitions = [
  {
    name: 'list_attachments',
    description: 'List non-markdown attachments',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['vault', 'note'], default: 'vault' },
        path: { type: 'string', description: 'Folder or note path' },
        extensions: { type: 'array', items: { type: 'string' }, description: 'Filter by extension' },
      },
    },
  },
  {
    name: 'get_attachment_info',
    description: 'Get metadata and referencing notes for an attachment',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async list_attachments(args, ctx) {
    const { mode = 'vault', path: pathArg = '', extensions } = args as any;

    if (mode === 'note') {
      await ctx.cacheService.waitForBuild();
      const note = await ctx.vaultAccess.readNote(pathArg);
      const content = note.originalContent;
      const linkRegex = /!?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]|!\[.*?\]\(([^)]+)\)/g;
      const attachments: string[] = [];
      let m;
      while ((m = linkRegex.exec(content)) !== null) {
        const linkedPath = m[1] || m[2];
        if (linkedPath && !linkedPath.endsWith('.md')) {
          const ext = extname(linkedPath);
          if (!extensions || extensions.includes(ext)) {
            attachments.push(linkedPath);
          }
        }
      }
      return success({ note: pathArg, attachments, count: attachments.length });
    }

    const searchDir = pathArg ? join(ctx.vaultPath, pathArg) : ctx.vaultPath;
    // Validate path is within vault
    const normalizedDir = searchDir.replace(/\\/g, '/');
    const normalizedVault = ctx.vaultPath.replace(/\\/g, '/');
    if (!normalizedDir.startsWith(normalizedVault + '/') && normalizedDir !== normalizedVault) {
      return { content: [{ type: 'text', text: `Path traversal not allowed: ${pathArg}` }], isError: true };
    }
    const attachments = await findAttachments(searchDir, ctx.vaultPath, extensions);
    return success({ attachments, count: attachments.length });
  },

  async get_attachment_info(args, ctx) {
    const { path: filePath } = args as { path: string };
    // Validate path is within vault
    const fullPath = join(ctx.vaultPath, filePath);
    const normalizedFull = fullPath.replace(/\\/g, '/');
    const normalizedVault = ctx.vaultPath.replace(/\\/g, '/');
    if (!normalizedFull.startsWith(normalizedVault + '/')) {
      return { content: [{ type: 'text', text: `Path traversal not allowed: ${filePath}` }], isError: true };
    }
    const fileStat = await stat(fullPath);

    await ctx.cacheService.waitForBuild();
    const referencingNotes: string[] = [];
    const fileName = filePath.split('/').pop() || '';

    for (const [notePath, entry] of ctx.cacheService.getAllEntries()) {
      if (entry.content.includes(fileName)) {
        referencingNotes.push(notePath);
      }
    }

    return success({
      path: filePath,
      size: fileStat.size,
      modified: fileStat.mtime.getTime(),
      extension: extname(filePath),
      referencedBy: referencingNotes,
    });
  },
};

async function findAttachments(
  dirPath: string,
  vaultPath: string,
  extensions?: string[],
): Promise<Array<{ path: string; size: number; extension: string }>> {
  const results: Array<{ path: string; size: number; extension: string }> = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        results.push(...await findAttachments(fullPath, vaultPath, extensions));
      } else if (entry.isFile() && !entry.name.endsWith('.md')) {
        const ext = extname(entry.name);
        if (extensions && !extensions.includes(ext)) continue;
        const fileStat = await stat(fullPath);
        results.push({
          path: relative(vaultPath, fullPath).replace(/\\/g, '/'),
          size: fileStat.size,
          extension: ext,
        });
      }
    }
  } catch { /* skip unreadable dirs */ }

  return results;
}
