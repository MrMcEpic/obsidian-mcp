import type { ToolHandler } from './types.js';
import { success } from './types.js';

export const definitions = [
  {
    name: 'get_frontmatter',
    description: 'Get the YAML frontmatter of a note',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'update_frontmatter',
    description: 'Update frontmatter fields (merge or replace)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        frontmatter: { type: 'object', description: 'Key-value pairs to set' },
        merge: { type: 'boolean', default: true },
      },
      required: ['path', 'frontmatter'],
    },
  },
  {
    name: 'manage_tags',
    description: 'Add, remove, or list tags in a note',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        operation: { type: 'string', enum: ['add', 'remove', 'list'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['path', 'operation'],
    },
  },
  {
    name: 'get_notes_info',
    description: 'Get metadata for one or more notes',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['paths'],
    },
  },
  {
    name: 'list_all_tags',
    description: 'Scan the entire vault for all tags (frontmatter and inline #hashtags), returning deduplicated list sorted by frequency',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async get_frontmatter(args, ctx) {
    const { path } = args as { path: string };
    const note = await ctx.vaultAccess.readNote(path);
    return success({ path, frontmatter: note.frontmatter });
  },

  async update_frontmatter(args, ctx) {
    const { path, frontmatter, merge = true } = args as any;
    if (merge) {
      const existing = await ctx.vaultAccess.readNote(path);
      const merged = { ...existing.frontmatter, ...frontmatter };
      for (const [key, value] of Object.entries(frontmatter)) {
        if (value === null) delete merged[key];
      }
      await ctx.filesystem.updateFrontmatter({ path, frontmatter: merged, merge: false });
    } else {
      await ctx.filesystem.updateFrontmatter({ path, frontmatter, merge });
    }
    const note = await ctx.vaultAccess.readNote(path);
    await ctx.cacheService.updateEntry(path, note.originalContent);
    return success({ path, message: 'Frontmatter updated', frontmatter: note.frontmatter });
  },

  async manage_tags(args, ctx) {
    const { path, operation, tags } = args as any;
    const result = await ctx.filesystem.manageTags({ path, operation, tags });
    if (operation !== 'list') {
      const note = await ctx.vaultAccess.readNote(path);
      await ctx.cacheService.updateEntry(path, note.originalContent);
    }
    return success(result);
  },

  async get_notes_info(args, ctx) {
    const { paths } = args as { paths: string[] };
    const info = await ctx.filesystem.getNotesInfo(paths);
    return success(info);
  },

  async list_all_tags(_args, ctx) {
    const tags = await ctx.filesystem.listAllTags();
    return success({ totalTags: tags.length, tags });
  },
};
