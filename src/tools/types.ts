import type { VaultAccess } from '../services/vault-access.js';
import type { FileSystemService } from '../services/filesystem.js';
import type { SearchService } from '../services/search.js';
import type { CacheService } from '../services/cache.js';
import type { GraphService } from '../services/graph.js';
import type { TemplateService } from '../services/template.js';
import type { DataviewService } from '../services/dataview.js';
import type { PathFilter } from '../pathfilter.js';

export interface ToolContext {
  vaultAccess: VaultAccess;
  filesystem: FileSystemService;
  searchService: SearchService;
  cacheService: CacheService;
  graphService: GraphService;
  templateService: TemplateService;
  dataviewService: DataviewService;
  pathFilter: PathFilter;
  vaultPath: string;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface ToolModule {
  definitions: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  handlers: Record<string, ToolHandler>;
}

export function success(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function error(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
