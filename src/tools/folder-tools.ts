import type { ToolHandler } from './types.js';
import { success, error } from './types.js';

export const definitions = [
  {
    name: 'list_directory',
    description: 'List files and folders in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '', description: 'Directory path relative to vault root' },
      },
    },
  },
  {
    name: 'manage_folder',
    description: 'Create, rename, move, or delete a folder',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path' },
        operation: { type: 'string', enum: ['create', 'rename', 'move', 'delete'] },
        newPath: { type: 'string', description: 'New path (required for rename/move)' },
      },
      required: ['path', 'operation'],
    },
  },
  {
    name: 'get_vault_stats',
    description: 'Get vault statistics (note count, folder count, total size, recently modified)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_vault_structure',
    description: 'Get recursive directory tree of the vault',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '' },
        maxDepth: { type: 'number', default: 3, description: 'Max recursion depth' },
      },
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async list_directory(args, ctx) {
    const { path = '' } = args as { path?: string };
    const listing = await ctx.vaultAccess.listDirectory(path);
    return success(listing);
  },

  async manage_folder(args, ctx) {
    const { path, operation, newPath } = args as any;
    const result = await ctx.filesystem.manageFolder({ path, operation, newPath });
    return result.success ? success(result) : error(result.message);
  },

  async get_vault_stats(_args, ctx) {
    const stats = await ctx.filesystem.getVaultStats();
    return success(stats);
  },

  async get_vault_structure(args, ctx) {
    const { path = '', maxDepth = 3 } = args as { path?: string; maxDepth?: number };
    const tree = await ctx.filesystem.getVaultStructure(path, maxDepth);
    return success(tree);
  },
};
