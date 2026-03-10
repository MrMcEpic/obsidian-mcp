import type { ToolHandler } from './types.js';
import { success } from './types.js';
import { generateObsidianUri } from '../uri.js';

export const definitions = [
  {
    name: 'get_backlinks',
    description: 'Get all notes that link TO a given note',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'get_outgoing_links',
    description: 'Get all notes that a given note links TO',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'find_orphan_notes',
    description: 'Find notes with no incoming or outgoing links',
    inputSchema: { type: 'object', properties: {} },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async get_backlinks(args, ctx) {
    const { path } = args as { path: string };
    await ctx.cacheService.waitForBuild();
    const backlinks = ctx.graphService.getBacklinks(path);
    return success({
      path,
      backlinks: backlinks.map(p => ({ path: p, obsidianUri: generateObsidianUri(ctx.vaultPath, p) })),
      count: backlinks.length,
    });
  },

  async get_outgoing_links(args, ctx) {
    const { path } = args as { path: string };
    await ctx.cacheService.waitForBuild();
    const links = ctx.graphService.getOutgoingLinks(path);
    return success({
      path,
      outgoingLinks: links.map(p => ({ path: p, obsidianUri: generateObsidianUri(ctx.vaultPath, p) })),
      count: links.length,
    });
  },

  async find_orphan_notes(_args, ctx) {
    await ctx.cacheService.waitForBuild();
    const orphans = ctx.graphService.findOrphanNotes();
    return success({
      orphans: orphans.map(p => ({ path: p, obsidianUri: generateObsidianUri(ctx.vaultPath, p) })),
      count: orphans.length,
    });
  },
};
