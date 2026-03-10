import type { ToolHandler } from './types.js';
import { success, error } from './types.js';

export const definitions = [
  {
    name: 'get_active_note',
    description: 'Get the currently active note in Obsidian (requires REST API)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_periodic_note',
    description: 'Get a periodic note from Obsidian (requires REST API)',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] },
      },
      required: ['period'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async get_active_note(_args, ctx) {
    try {
      const note = await ctx.vaultAccess.getActiveNote();
      return success({ frontmatter: note.frontmatter, content: note.content });
    } catch (e) {
      return error(`REST API required: ${e instanceof Error ? e.message : 'Obsidian must be running with Local REST API plugin'}`);
    }
  },

  async get_periodic_note(args, ctx) {
    const { period } = args as { period: string };
    try {
      const note = await ctx.vaultAccess.getPeriodicNote(period);
      return success({ period, frontmatter: note.frontmatter, content: note.content });
    } catch (e) {
      return error(`REST API required: ${e instanceof Error ? e.message : 'Obsidian must be running with Local REST API plugin'}`);
    }
  },
};
