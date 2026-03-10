import type { ToolHandler } from './types.js';
import { success } from './types.js';

export const definitions = [
  {
    name: 'search_vault',
    description: 'Search notes by content, filename, or frontmatter with BM25 ranking',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', default: 5 },
        searchContent: { type: 'boolean', default: true },
        searchFrontmatter: { type: 'boolean', default: false },
        caseSensitive: { type: 'boolean', default: false },
        useRegex: { type: 'boolean', default: false },
        pathFilter: { type: 'string', description: 'Glob pattern to filter paths' },
        offset: { type: 'number', default: 0 },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_notes',
    description: 'Query notes by frontmatter fields using dataview-style syntax',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Dataview query' },
        limit: { type: 'number', default: 20 },
        sortBy: { type: 'string', description: 'Frontmatter field to sort by' },
        sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      },
      required: ['query'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async search_vault(args, ctx) {
    const { query, limit, searchContent, searchFrontmatter, caseSensitive, useRegex, pathFilter, offset } = args as any;
    await ctx.cacheService.waitForBuild();
    const results = await ctx.searchService.search({
      query, limit, searchContent, searchFrontmatter, caseSensitive, useRegex, pathFilter, offset,
    });
    return success({ results, total: results.length });
  },

  async query_notes(args, ctx) {
    const { query, limit, sortBy, sortOrder } = args as any;
    await ctx.cacheService.waitForBuild();
    const results = ctx.dataviewService.query(query, { limit, sortBy, sortOrder });
    return success({ results, total: results.length });
  },
};
