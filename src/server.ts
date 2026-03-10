#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { FileSystemService } from "./services/filesystem.js";
import { RestApiService } from "./services/rest-api.js";
import { VaultAccess } from "./services/vault-access.js";
import { SearchService } from "./services/search.js";
import { CacheService } from "./services/cache.js";
import { GraphService } from "./services/graph.js";
import { TemplateService } from "./services/template.js";
import { DataviewService } from "./services/dataview.js";
import { FrontmatterHandler } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { allToolDefinitions, allToolHandlers } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";
import { resolve } from "path";

const config = loadConfig();
const vaultPath = resolve(config.vaultPath);

// Initialize services
const pathFilter = new PathFilter();
const frontmatterHandler = new FrontmatterHandler();
const filesystem = new FileSystemService(vaultPath, pathFilter, frontmatterHandler);
const restApi = config.apiKey
  ? new RestApiService({ baseUrl: `http://127.0.0.1:${config.apiPort}`, apiKey: config.apiKey, timeout: 5000 })
  : null;
const vaultAccess = new VaultAccess(filesystem, restApi);
const searchService = new SearchService(vaultPath, pathFilter);
const cacheService = new CacheService(vaultPath, config.cacheInterval);
const graphService = new GraphService(cacheService);
const templateService = new TemplateService();
const dataviewService = new DataviewService(cacheService);

// Start cache build in background
cacheService.startBuild();

// Build service context for tool handlers
const context: ToolContext = {
  vaultAccess, filesystem, searchService, cacheService,
  graphService, templateService, dataviewService, pathFilter, vaultPath,
};

const server = new Server({ name: "obsidian-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allToolDefinitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = allToolHandlers[name];
  if (!handler) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true } as any;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await handler(args || {}, context) as any;
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` }],
      isError: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
