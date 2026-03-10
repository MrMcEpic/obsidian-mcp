import * as noteTools from './note-tools.js';
import * as searchTools from './search-tools.js';
import * as frontmatterTools from './frontmatter-tools.js';
import * as folderTools from './folder-tools.js';
import * as graphTools from './graph-tools.js';
import * as backlinkTools from './backlink-tools.js';
import * as templateTools from './template-tools.js';
import * as attachmentTools from './attachment-tools.js';
import * as restApiTools from './rest-api-tools.js';
import type { ToolHandler, ToolModule } from './types.js';

const modules: ToolModule[] = [
  noteTools, searchTools, frontmatterTools, folderTools,
  graphTools, backlinkTools, templateTools, attachmentTools, restApiTools,
];

export const allToolDefinitions = modules.flatMap(m => m.definitions);

export const allToolHandlers: Record<string, ToolHandler> = {};
for (const mod of modules) {
  for (const [name, handler] of Object.entries(mod.handlers)) {
    allToolHandlers[name] = handler;
  }
}
