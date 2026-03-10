# Obsidian MCP — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the definitive Obsidian MCP server — 27 tools with dual-mode vault access, caching, graph analysis, auto-backlinking, templates, dataview queries, and attachments, packaged as `.mcpb` for Claude Desktop.

**Architecture:** Fork of bitbonsai/mcp-obsidian with modular services. `vault-access.ts` orchestrates REST API → filesystem fallback. In-memory cache with link index powers search, graph, and dataview tools. Single-file esbuild bundle packaged as `.mcpb`.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, gray-matter, axios, esbuild, vitest

**Spec:** `docs/superpowers/specs/2026-03-10-obsidian-mcp-design.md`

---

## File Structure

### Files to Create

```
src/
  server.ts                         # Entry point (moved from root, rewritten)
  config.ts                         # Environment variable loading & validation
  services/
    filesystem.ts                   # Existing FileSystemService (moved from src/)
    rest-api.ts                     # Obsidian Local REST API client
    vault-access.ts                 # Dual-mode orchestrator (REST → filesystem)
    search.ts                       # Search engine (moved from src/, extended)
    cache.ts                        # In-memory vault cache + link index
    graph.ts                        # Backlink/outgoing link/orphan analysis
    template.ts                     # Template variable substitution
    dataview.ts                     # Query parser + frontmatter query engine
  frontmatter.ts                    # Existing (stays in place)
  pathfilter.ts                     # Existing (stays in place)
  types.ts                          # Existing (extended with new types)
  uri.ts                            # Existing (stays in place)
  tools/
    note-tools.ts                   # read_note, read_multiple_notes, write_note, patch_note, insert_at, delete_note, move_note, move_file
    search-tools.ts                 # search_vault, query_notes
    frontmatter-tools.ts            # get_frontmatter, update_frontmatter, manage_tags, get_notes_info
    folder-tools.ts                 # list_directory, manage_folder, get_vault_stats, get_vault_structure
    graph-tools.ts                  # get_backlinks, get_outgoing_links, find_orphan_notes
    backlink-tools.ts               # auto_backlink
    template-tools.ts               # create_from_template
    attachment-tools.ts             # list_attachments, get_attachment_info
    rest-api-tools.ts               # get_active_note, get_periodic_note
    index.ts                        # Aggregates all tool definitions + handlers
scripts/
  build-mcpb.js                     # Build pipeline: tsc → esbuild → zip
test-vault/                         # Fixture vault for integration tests
  notes/
    hello.md
    project-alpha.md
    daily/2026-03-10.md
    templates/default.md
  attachments/
    image.png
```

### Files to Modify

```
manifest.json                       # Rewrite for MCPB format with user_config
package.json                        # Add esbuild, axios, build scripts
tsconfig.json                       # Update paths for new structure
```

### Files to Delete

```
server.ts                           # Moved to src/server.ts
src/filesystem.ts                   # Moved to src/services/filesystem.ts
src/search.ts                       # Moved to src/services/search.ts
```

### Files Unchanged

```
src/frontmatter.ts                  # Keep as-is
src/frontmatter.test.ts             # Keep as-is
src/pathfilter.ts                   # Keep as-is
src/pathfilter.test.ts              # Keep as-is
src/uri.ts                          # Keep as-is
src/uri.test.ts                     # Keep as-is
src/types.ts                        # Extended (not replaced)
```

---

## Chunk 1: Project Restructure & Build Infrastructure

### Task 1: Restructure project directories

**Files:**
- Move: `src/filesystem.ts` → `src/services/filesystem.ts`
- Move: `src/search.ts` → `src/services/search.ts`
- Move: `server.ts` → `src/server.ts`
- Move: `src/filesystem.test.ts` → `src/services/filesystem.test.ts`
- Move: `src/search.test.ts` → `src/services/search.test.ts`
- Move: `src/integration.test.ts` → `src/services/integration.test.ts`
- Create: `src/config.ts`

- [ ] **Step 1: Create the services directory**

```bash
mkdir -p src/services src/tools
```

- [ ] **Step 2: Move filesystem service**

```bash
git mv src/filesystem.ts src/services/filesystem.ts
git mv src/filesystem.test.ts src/services/filesystem.test.ts
```

- [ ] **Step 3: Move search service**

```bash
git mv src/search.ts src/services/search.ts
git mv src/search.test.ts src/services/search.test.ts
```

- [ ] **Step 4: Move integration test**

```bash
git mv src/integration.test.ts src/services/integration.test.ts
```

- [ ] **Step 5: Move server entry point**

```bash
git mv server.ts src/server.ts
```

- [ ] **Step 6: Update import paths in moved files**

In `src/services/filesystem.ts`, update imports:
```typescript
import { FrontmatterHandler } from '../frontmatter.js';
import { PathFilter } from '../pathfilter.js';
import { generateObsidianUri } from '../uri.js';
import type { ParsedNote, DirectoryListing, ... } from '../types.js';
```

In `src/services/search.ts`, update imports:
```typescript
import type { PathFilter } from '../pathfilter.js';
import type { RankCandidate, SearchParams, SearchResult } from '../types.js';
import { generateObsidianUri } from '../uri.js';
```

In `src/server.ts`, update imports:
```typescript
import { FileSystemService } from "./services/filesystem.js";
import { FrontmatterHandler, parseFrontmatter } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { SearchService } from "./services/search.js";
```

Update test files similarly to use `../frontmatter.js`, `../pathfilter.js`, `../types.js`.

- [ ] **Step 7: Create config.ts**

```typescript
// src/config.ts
export interface AppConfig {
  vaultPath: string;
  apiKey?: string;
  apiPort: number;
  cacheInterval: number; // minutes, 0 = disabled
}

export function loadConfig(): AppConfig {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH || process.argv.slice(2).join(' ').trim() || process.cwd();
  const apiKey = process.env.OBSIDIAN_API_KEY || undefined;
  const apiPort = parseInt(process.env.OBSIDIAN_API_PORT || '27123', 10);
  const cacheInterval = parseInt(process.env.OBSIDIAN_CACHE_INTERVAL || '10', 10);

  if (!vaultPath) {
    throw new Error('OBSIDIAN_VAULT_PATH environment variable or vault path argument is required');
  }

  return { vaultPath, apiKey, apiPort, cacheInterval };
}
```

- [ ] **Step 8: Update tsconfig.json for new structure**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["es2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "allowJs": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "node_modules", "dist", "test-vault"]
}
```

Note: Removed `verbatimModuleSyntax` because it conflicts with `esModuleInterop` needed for CJS bundling. All other strict flags from the original tsconfig are preserved.

- [ ] **Step 9: Run tests to verify nothing broke**

```bash
npx vitest run
```

Expected: All existing tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: restructure project into services/ directory"
```

---

### Task 2: Add build dependencies and MCPB build script

**Files:**
- Modify: `package.json`
- Create: `scripts/build-mcpb.js`

- [ ] **Step 1: Install build dependencies**

```bash
npm install --save axios
npm install --save-dev esbuild archiver @types/archiver
```

- [ ] **Step 2: Update package.json scripts**

Add to `scripts` in `package.json`:
```json
{
  "scripts": {
    "start": "tsx src/server.ts",
    "build": "tsc",
    "bundle": "node scripts/build-mcpb.js",
    "build:mcpb": "npm run build && npm run bundle",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Also update `main` and `bin`:
```json
{
  "main": "dist/server.js",
  "bin": {
    "obsidian-mcp": "dist/server.js"
  }
}
```

- [ ] **Step 3: Create build-mcpb.js script**

```javascript
// scripts/build-mcpb.js
import { build } from 'esbuild';
import { createWriteStream, readFileSync, writeFileSync, mkdirSync } from 'fs';
import archiver from 'archiver';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const mcpbDir = join(distDir, 'mcpb');

async function buildMcpb() {
  // 1. Bundle with esbuild
  mkdirSync(join(mcpbDir, 'server'), { recursive: true });

  await build({
    entryPoints: [join(distDir, 'server.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(mcpbDir, 'server', 'mcp-bridge.cjs'),
    external: [],  // bundle everything
    minify: false,
    sourcemap: false,
  });

  // 2. Copy manifest.json
  const manifest = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(mcpbDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 3. Generate tools.json from the bundled server
  // (Will be implemented when tools are defined — placeholder for now)
  writeFileSync(join(mcpbDir, 'server', 'tools.json'), '[]');

  // 4. Create .mcpb zip
  const output = createWriteStream(join(distDir, 'obsidian-mcp.mcpb'));
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(mcpbDir, false);

  await archive.finalize();
  console.log('Built obsidian-mcp.mcpb');
}

buildMcpb().catch(console.error);
```

- [ ] **Step 4: Update manifest.json for MCPB format**

Rewrite the root `manifest.json`:
```json
{
  "manifest_version": "0.3",
  "name": "obsidian-mcp",
  "display_name": "Obsidian Knowledge Base",
  "version": "1.0.0",
  "description": "AI-driven knowledge management for Obsidian vaults. 27 tools for notes, search, frontmatter, tags, folders, graph analysis, templates, auto-backlinking, and dataview queries.",
  "author": {
    "name": "MrMcEpic"
  },
  "server": {
    "type": "node",
    "entry_point": "server/mcp-bridge.cjs",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/mcp-bridge.cjs"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "${user_config.vault_path}",
        "OBSIDIAN_API_KEY": "${user_config.api_key}",
        "OBSIDIAN_API_PORT": "${user_config.api_port}",
        "OBSIDIAN_CACHE_INTERVAL": "${user_config.cache_interval}"
      }
    }
  },
  "user_config": {
    "vault_path": {
      "type": "string",
      "title": "Vault Path",
      "description": "Path to your Obsidian vault",
      "required": true
    },
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "API key from Obsidian Local REST API plugin (optional — enables live features)",
      "required": false
    },
    "api_port": {
      "type": "string",
      "title": "API Port",
      "description": "Obsidian Local REST API port",
      "default": "27123",
      "required": false
    },
    "cache_interval": {
      "type": "string",
      "title": "Cache Refresh (minutes)",
      "description": "How often to refresh vault cache (0 to disable)",
      "default": "10",
      "required": false
    }
  },
  "tools": [],
  "compatibility": {
    "platforms": ["win32", "darwin", "linux"]
  }
}
```

(The `tools` array will be populated as tools are implemented.)

- [ ] **Step 5: Verify build pipeline works**

```bash
npm run build
```

Expected: TypeScript compiles to `dist/` without errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: add esbuild bundling and MCPB build script"
```

---

### Task 3: Create test vault fixture

**Files:**
- Create: `test-vault/notes/hello.md`
- Create: `test-vault/notes/project-alpha.md`
- Create: `test-vault/notes/daily/2026-03-10.md`
- Create: `test-vault/notes/templates/default.md`
- Create: `test-vault/notes/orphan.md`
- Create: `test-vault/notes/linked-from.md`
- Create: `test-vault/attachments/readme.txt`

- [ ] **Step 1: Create test vault notes**

`test-vault/notes/hello.md`:
```markdown
---
title: Hello World
tags: [greeting, test]
status: published
created: 2026-01-01
---

# Hello World

This is a test note. It links to [[project-alpha]] and [[daily/2026-03-10]].

Some content for searching. ^block1
```

`test-vault/notes/project-alpha.md`:
```markdown
---
title: Project Alpha
tags: [project, work]
status: draft
priority: high
author:
  name: John
---

# Project Alpha

## Overview

This project is about building something great.

## Tasks

- Task 1: Do the thing
- Task 2: Do the other thing ^task-list

## Notes

See [[hello]] for greetings.
```

`test-vault/notes/daily/2026-03-10.md`:
```markdown
---
title: Daily Note
tags: [daily]
date: 2026-03-10
---

# 2026-03-10

Today I worked on [[project-alpha]].
```

`test-vault/notes/templates/default.md`:
```markdown
---
title: "{{title}}"
created: "{{date}}"
tags: []
---

# {{title}}

Created on {{datetime}}.
```

`test-vault/notes/orphan.md`:
```markdown
---
title: Orphan Note
tags: [lonely]
---

# Orphan

This note has no links to or from other notes.
```

`test-vault/notes/linked-from.md`:
```markdown
---
title: Linked From
---

# Linked From

This note mentions project-alpha by name but not as a wikilink.
```

`test-vault/attachments/readme.txt`:
```
This is a test attachment.
```

- [ ] **Step 2: Commit**

```bash
git add test-vault/
git commit -m "test: add fixture test vault"
```

---

## Chunk 2: REST API Service & Dual-Mode Access

### Task 4: Create REST API client service

**Files:**
- Create: `src/services/rest-api.ts`
- Create: `src/services/rest-api.test.ts`
- Modify: `src/types.ts` (add REST API types)

- [ ] **Step 1: Add REST API types to types.ts**

Append to `src/types.ts`:
```typescript
// REST API types
export interface RestApiConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number; // ms
}

export interface RestApiNoteResponse {
  content: string;
  path: string;
  stat?: {
    ctime: number;
    mtime: number;
    size: number;
  };
}
```

- [ ] **Step 2: Write failing test for REST API client**

`src/services/rest-api.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RestApiService } from './rest-api.js';

// We'll mock axios
vi.mock('axios');

describe('RestApiService', () => {
  it('should construct with config', () => {
    const service = new RestApiService({
      baseUrl: 'http://127.0.0.1:27123',
      apiKey: 'test-key',
      timeout: 5000,
    });
    expect(service).toBeDefined();
  });

  it('should return isAvailable false when connection fails', async () => {
    const service = new RestApiService({
      baseUrl: 'http://127.0.0.1:99999',
      apiKey: 'test-key',
      timeout: 1000,
    });
    const available = await service.isAvailable();
    expect(available).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/services/rest-api.test.ts
```

Expected: FAIL — `RestApiService` not found.

- [ ] **Step 4: Implement REST API client**

`src/services/rest-api.ts`:
```typescript
import axios, { AxiosInstance } from 'axios';
import type { RestApiConfig, RestApiNoteResponse, ParsedNote } from '../types.js';

export class RestApiService {
  private client: AxiosInstance;
  private config: RestApiConfig;

  constructor(config: RestApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.get('/');
      return true;
    } catch {
      return false;
    }
  }

  async readNote(path: string): Promise<RestApiNoteResponse> {
    const encodedPath = encodeURIComponent(path);
    const response = await this.client.get(`/vault/${encodedPath}`, {
      headers: { 'Accept': 'application/vnd.olrapi.note+json' },
    });
    return response.data;
  }

  async writeNote(path: string, content: string): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.client.put(`/vault/${encodedPath}`, content, {
      headers: { 'Content-Type': 'text/markdown' },
    });
  }

  async appendNote(path: string, content: string): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.client.post(`/vault/${encodedPath}`, content, {
      headers: { 'Content-Type': 'text/markdown' },
    });
  }

  async deleteNote(path: string): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.client.delete(`/vault/${encodedPath}`);
  }

  async listDirectory(path: string = '/'): Promise<{ files: string[]; }> {
    const encodedPath = encodeURIComponent(path);
    const response = await this.client.get(`/vault/${encodedPath}`, {
      headers: { 'Accept': 'application/json' },
    });
    return response.data;
  }

  async getActiveNote(): Promise<RestApiNoteResponse> {
    const response = await this.client.get('/active/', {
      headers: { 'Accept': 'application/vnd.olrapi.note+json' },
    });
    return response.data;
  }

  async getPeriodicNote(period: string): Promise<RestApiNoteResponse> {
    const response = await this.client.get(`/periodic/${period}/`, {
      headers: { 'Accept': 'application/vnd.olrapi.note+json' },
    });
    return response.data;
  }

  async search(query: string): Promise<Array<{ filename: string; score: number; matches: Array<{ match: { start: number; end: number }; context: string }> }>> {
    const response = await this.client.post('/search/simple/', query, {
      headers: { 'Content-Type': 'text/plain' },
    });
    return response.data;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/services/rest-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/rest-api.ts src/services/rest-api.test.ts src/types.ts
git commit -m "feat: add REST API client service for Obsidian Local REST API"
```

---

### Task 5: Create vault-access orchestrator

**Files:**
- Create: `src/services/vault-access.ts`
- Create: `src/services/vault-access.test.ts`

- [ ] **Step 1: Write failing test**

`src/services/vault-access.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { VaultAccess } from './vault-access.js';
import { FileSystemService } from './filesystem.js';
import { RestApiService } from './rest-api.js';

describe('VaultAccess', () => {
  it('should use filesystem when no REST API configured', async () => {
    const fs = { readNote: vi.fn().mockResolvedValue({ frontmatter: {}, content: 'test', originalContent: 'test' }) } as any;
    const vault = new VaultAccess(fs, null);
    const result = await vault.readNote('test.md');
    expect(result.content).toBe('test');
    expect(fs.readNote).toHaveBeenCalledWith('test.md');
  });

  it('should fall back to filesystem when REST API fails', async () => {
    const fs = { readNote: vi.fn().mockResolvedValue({ frontmatter: {}, content: 'fs-content', originalContent: 'fs-content' }) } as any;
    const api = { readNote: vi.fn().mockRejectedValue(new Error('connection refused')), isAvailable: vi.fn().mockResolvedValue(false) } as any;
    const vault = new VaultAccess(fs, api);
    const result = await vault.readNote('test.md');
    expect(result.content).toBe('fs-content');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/vault-access.test.ts
```

Expected: FAIL — `VaultAccess` not found.

- [ ] **Step 3: Implement vault-access orchestrator**

`src/services/vault-access.ts`:
```typescript
import type { FileSystemService } from './filesystem.js';
import type { RestApiService } from './rest-api.js';
import type { ParsedNote, NoteWriteParams, PatchNoteParams, PatchNoteResult, DeleteNoteParams, DeleteResult, MoveNoteParams, MoveFileParams, MoveResult, DirectoryListing } from '../types.js';
import { FrontmatterHandler } from '../frontmatter.js';

export class VaultAccess {
  private frontmatterHandler = new FrontmatterHandler();

  constructor(
    private filesystem: FileSystemService,
    private restApi: RestApiService | null,
  ) {}

  private async tryRestApi<T>(
    restCall: () => Promise<T>,
    fsCall: () => Promise<T>,
  ): Promise<T> {
    if (!this.restApi) return fsCall();

    try {
      return await restCall();
    } catch {
      return fsCall();
    }
  }

  async readNote(path: string): Promise<ParsedNote> {
    return this.tryRestApi(
      async () => {
        const response = await this.restApi!.readNote(path);
        return this.frontmatterHandler.parse(response.content);
      },
      () => this.filesystem.readNote(path),
    );
  }

  async writeNote(params: NoteWriteParams): Promise<void> {
    return this.tryRestApi(
      async () => {
        if (params.mode === 'append') {
          // REST API append endpoint adds to end of file.
          // If frontmatter is provided, we need to read-modify-write to merge it.
          if (params.frontmatter) {
            const existing = await this.restApi!.readNote(params.path).catch(() => null);
            const parsed = existing ? this.frontmatterHandler.parse(existing.content) : { frontmatter: {}, content: '' };
            const mergedFm = { ...parsed.frontmatter, ...params.frontmatter };
            const fullContent = this.frontmatterHandler.stringify(mergedFm, parsed.content + params.content);
            await this.restApi!.writeNote(params.path, fullContent);
          } else {
            await this.restApi!.appendNote(params.path, params.content);
          }
        } else if (params.mode === 'prepend') {
          // REST API has no prepend endpoint — read, parse, prepend, write back
          const existing = await this.restApi!.readNote(params.path).catch(() => null);
          const parsed = existing ? this.frontmatterHandler.parse(existing.content) : { frontmatter: {}, content: '' };
          const mergedFm = params.frontmatter ? { ...parsed.frontmatter, ...params.frontmatter } : parsed.frontmatter;
          const fullContent = this.frontmatterHandler.stringify(mergedFm, params.content + parsed.content);
          await this.restApi!.writeNote(params.path, fullContent);
        } else {
          // overwrite (default)
          const content = params.frontmatter
            ? this.frontmatterHandler.stringify(params.frontmatter, params.content)
            : params.content;
          await this.restApi!.writeNote(params.path, content);
        }
      },
      () => this.filesystem.writeNote(params),
    );
  }

  async patchNote(params: PatchNoteParams): Promise<PatchNoteResult> {
    // Always use filesystem for patch (needs exact string matching)
    return this.filesystem.patchNote(params);
  }

  async deleteNote(params: DeleteNoteParams): Promise<DeleteResult> {
    return this.tryRestApi(
      async () => {
        if (params.path !== params.confirmPath) {
          return { success: false, path: params.path, message: "Deletion cancelled: confirmation path does not match." };
        }
        await this.restApi!.deleteNote(params.path);
        return { success: true, path: params.path, message: `Successfully deleted: ${params.path}` };
      },
      () => this.filesystem.deleteNote(params),
    );
  }

  async listDirectory(path: string = ''): Promise<DirectoryListing> {
    // Always use filesystem — more reliable for directory listing
    return this.filesystem.listDirectory(path);
  }

  async moveNote(params: MoveNoteParams): Promise<MoveResult> {
    // Always use filesystem for move operations
    return this.filesystem.moveNote(params);
  }

  async moveFile(params: MoveFileParams): Promise<MoveResult> {
    return this.filesystem.moveFile(params);
  }

  // REST-only methods
  async getActiveNote(): Promise<ParsedNote> {
    if (!this.restApi) {
      throw new Error('Obsidian must be running with Local REST API plugin enabled. Set OBSIDIAN_API_KEY to use this feature.');
    }
    const response = await this.restApi.getActiveNote();
    return this.frontmatterHandler.parse(response.content);
  }

  async getPeriodicNote(period: string): Promise<ParsedNote> {
    if (!this.restApi) {
      throw new Error('Obsidian must be running with Local REST API plugin enabled. Set OBSIDIAN_API_KEY to use this feature.');
    }
    const response = await this.restApi.getPeriodicNote(period);
    return this.frontmatterHandler.parse(response.content);
  }

  // Expose filesystem for services that need direct access
  getFilesystem(): FileSystemService {
    return this.filesystem;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/services/vault-access.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/vault-access.ts src/services/vault-access.test.ts
git commit -m "feat: add vault-access orchestrator with REST → filesystem fallback"
```

---

## Chunk 3: Cache Service & Link Index

### Task 6: Create cache service with link index

**Files:**
- Create: `src/services/cache.ts`
- Create: `src/services/cache.test.ts`
- Modify: `src/types.ts` (add cache types)

- [ ] **Step 1: Add cache types to types.ts**

Append to `src/types.ts`:
```typescript
// Cache types
export interface CachedNote {
  content: string;
  frontmatter: Record<string, any>;
  mtime: number;
  outgoingLinks: string[];  // resolved paths
}

export interface LinkIndex {
  outgoing: Map<string, string[]>;   // path → [linked paths]
  backlinks: Map<string, string[]>;  // path → [paths that link here]
}
```

- [ ] **Step 2: Write failing test**

`src/services/cache.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CacheService } from './cache.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(async () => {
    cache = new CacheService(TEST_VAULT, 0); // 0 = no auto-refresh
    await cache.build();
  });

  it('should build cache from test vault', () => {
    const entries = cache.getAllEntries();
    expect(entries.size).toBeGreaterThan(0);
  });

  it('should parse wikilinks from content', () => {
    const links = cache.getOutgoingLinks('hello.md');
    expect(links).toContain('project-alpha.md');
  });

  it('should compute backlinks', () => {
    const backlinks = cache.getBacklinks('project-alpha.md');
    expect(backlinks).toContain('hello.md');
  });

  it('should find orphan notes', () => {
    const orphans = cache.getOrphanNotes();
    expect(orphans).toContain('orphan.md');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/services/cache.test.ts
```

Expected: FAIL — `CacheService` not found.

- [ ] **Step 4: Implement cache service**

`src/services/cache.ts`:
```typescript
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'path';
import matter from 'gray-matter';
import type { CachedNote, LinkIndex } from '../types.js';

export class CacheService {
  private entries = new Map<string, CachedNote>();
  private linkIndex: LinkIndex = {
    outgoing: new Map(),
    backlinks: new Map(),
  };
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private building = false;
  private buildPromise: Promise<void> | null = null;

  constructor(
    private vaultPath: string,
    private refreshIntervalMinutes: number = 10,
  ) {
    this.vaultPath = resolve(vaultPath);
  }

  /** Start async build. Returns immediately. Await waitForBuild() when needed. */
  startBuild(): void {
    this.buildPromise = this.build();
    if (this.refreshIntervalMinutes > 0) {
      this.refreshTimer = setInterval(
        () => this.refresh(),
        this.refreshIntervalMinutes * 60 * 1000,
      );
    }
  }

  async waitForBuild(): Promise<void> {
    if (this.buildPromise) await this.buildPromise;
  }

  async build(): Promise<void> {
    this.building = true;
    try {
      const files = await this.findMarkdownFiles(this.vaultPath);
      for (const fullPath of files) {
        const relativePath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
        await this.cacheFile(relativePath, fullPath);
      }
      this.rebuildLinkIndex();
    } finally {
      this.building = false;
    }
  }

  async refresh(): Promise<void> {
    const files = await this.findMarkdownFiles(this.vaultPath);
    const currentPaths = new Set<string>();
    let changed = false;

    for (const fullPath of files) {
      const relativePath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
      currentPaths.add(relativePath);

      const fileStat = await stat(fullPath);
      const cached = this.entries.get(relativePath);

      if (!cached || cached.mtime < fileStat.mtime.getTime()) {
        await this.cacheFile(relativePath, fullPath);
        changed = true;
      }
    }

    // Remove deleted files
    for (const path of this.entries.keys()) {
      if (!currentPaths.has(path)) {
        this.entries.delete(path);
        changed = true;
      }
    }

    if (changed) this.rebuildLinkIndex();
  }

  async updateEntry(path: string, content: string): Promise<void> {
    const parsed = matter(content);
    const outgoingLinks = this.parseLinks(parsed.content, path);
    this.entries.set(path, {
      content: parsed.content,
      frontmatter: parsed.data,
      mtime: Date.now(),
      outgoingLinks,
    });
    this.rebuildLinkIndex();
  }

  removeEntry(path: string): void {
    this.entries.delete(path);
    this.rebuildLinkIndex();
  }

  getEntry(path: string): CachedNote | undefined {
    return this.entries.get(path);
  }

  getAllEntries(): Map<string, CachedNote> {
    return this.entries;
  }

  getOutgoingLinks(path: string): string[] {
    return this.linkIndex.outgoing.get(path) || [];
  }

  getBacklinks(path: string): string[] {
    return this.linkIndex.backlinks.get(path) || [];
  }

  getOrphanNotes(): string[] {
    const orphans: string[] = [];
    for (const path of this.entries.keys()) {
      const outgoing = this.linkIndex.outgoing.get(path) || [];
      const backlinks = this.linkIndex.backlinks.get(path) || [];
      if (outgoing.length === 0 && backlinks.length === 0) {
        orphans.push(path);
      }
    }
    return orphans;
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // --- Private ---

  private async cacheFile(relativePath: string, fullPath: string): Promise<void> {
    try {
      const content = await readFile(fullPath, 'utf-8');
      const fileStat = await stat(fullPath);
      const parsed = matter(content);
      const outgoingLinks = this.parseLinks(parsed.content, relativePath);

      this.entries.set(relativePath, {
        content: parsed.content,
        frontmatter: parsed.data,
        mtime: fileStat.mtime.getTime(),
        outgoingLinks,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  private parseLinks(content: string, sourcePath: string): string[] {
    const links: string[] = [];
    const seen = new Set<string>();

    // Match [[wikilinks]] (with optional alias [[target|alias]])
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const target = this.resolveLink(match[1]!, sourcePath);
      if (target && !seen.has(target)) {
        seen.add(target);
        links.push(target);
      }
    }

    // Match [text](link.md) markdown links (only .md files)
    const mdLinkRegex = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
    while ((match = mdLinkRegex.exec(content)) !== null) {
      const target = this.resolveLink(match[2]!, sourcePath);
      if (target && !seen.has(target)) {
        seen.add(target);
        links.push(target);
      }
    }

    return links;
  }

  private resolveLink(link: string, sourcePath: string): string | null {
    // Remove .md extension if present, then add it back
    const cleanLink = link.replace(/\.md$/, '');

    // Try exact path match first
    const withMd = cleanLink + '.md';
    if (this.entries.has(withMd)) return withMd;

    // Try relative to source directory
    const sourceDir = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
    const relativePath = sourceDir ? `${sourceDir}/${withMd}` : withMd;
    if (this.entries.has(relativePath)) return relativePath;

    // Try finding by filename anywhere in vault
    for (const path of this.entries.keys()) {
      const filename = path.split('/').pop()?.replace(/\.md$/, '');
      if (filename === cleanLink) return path;
    }

    return null;
  }

  private rebuildLinkIndex(): void {
    const outgoing = new Map<string, string[]>();
    const backlinks = new Map<string, string[]>();

    for (const [path, entry] of this.entries) {
      outgoing.set(path, entry.outgoingLinks);
      for (const target of entry.outgoingLinks) {
        const existing = backlinks.get(target) || [];
        if (!existing.includes(path)) {
          existing.push(path);
          backlinks.set(target, existing);
        }
      }
    }

    this.linkIndex = { outgoing, backlinks };
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.name.startsWith('.')) continue; // Skip dotfiles/dirs
        if (entry.isDirectory()) {
          files.push(...await this.findMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
    return files;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/services/cache.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/cache.ts src/services/cache.test.ts src/types.ts
git commit -m "feat: add in-memory vault cache with link index"
```

---

## Chunk 4: Graph, Template, Dataview & Auto-Backlink Services

### Task 7: Create graph service

**Files:**
- Create: `src/services/graph.ts`
- Create: `src/services/graph.test.ts`

- [ ] **Step 1: Write failing test**

`src/services/graph.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphService } from './graph.js';
import { CacheService } from './cache.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('GraphService', () => {
  let graph: GraphService;
  let cache: CacheService;

  beforeEach(async () => {
    cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    graph = new GraphService(cache);
  });

  it('should return backlinks for a note', () => {
    const backlinks = graph.getBacklinks('project-alpha.md');
    expect(backlinks).toContain('hello.md');
  });

  it('should return outgoing links for a note', () => {
    const links = graph.getOutgoingLinks('hello.md');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should find orphan notes', () => {
    const orphans = graph.findOrphanNotes();
    expect(orphans).toContain('orphan.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/graph.test.ts
```

- [ ] **Step 3: Implement graph service**

`src/services/graph.ts`:
```typescript
import type { CacheService } from './cache.js';

export interface LinkInfo {
  path: string;
  title: string;
}

export class GraphService {
  constructor(private cache: CacheService) {}

  getBacklinks(path: string): string[] {
    return this.cache.getBacklinks(path);
  }

  getOutgoingLinks(path: string): string[] {
    return this.cache.getOutgoingLinks(path);
  }

  findOrphanNotes(): string[] {
    return this.cache.getOrphanNotes();
  }
}
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npx vitest run src/services/graph.test.ts
git add src/services/graph.ts src/services/graph.test.ts
git commit -m "feat: add graph service for backlinks, outgoing links, orphans"
```

---

### Task 8: Create template service

**Files:**
- Create: `src/services/template.ts`
- Create: `src/services/template.test.ts`

- [ ] **Step 1: Write failing test**

`src/services/template.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { TemplateService } from './template.js';

describe('TemplateService', () => {
  const service = new TemplateService();

  it('should substitute built-in variables', () => {
    const template = '# {{title}}\nCreated: {{date}}';
    const result = service.render(template, 'My Note', {});
    expect(result).toContain('# My Note');
    expect(result).toMatch(/Created: \d{4}-\d{2}-\d{2}/);
  });

  it('should substitute custom variables', () => {
    const template = '# {{title}}\nAuthor: {{author}}';
    const result = service.render(template, 'Test', { author: 'Alice' });
    expect(result).toContain('Author: Alice');
  });

  it('should leave undefined variables as-is', () => {
    const template = '# {{title}}\nFoo: {{unknown}}';
    const result = service.render(template, 'Test', {});
    expect(result).toContain('Foo: {{unknown}}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/template.test.ts
```

- [ ] **Step 3: Implement template service**

`src/services/template.ts`:
```typescript
export class TemplateService {
  render(
    template: string,
    title: string,
    variables: Record<string, string>,
  ): string {
    const now = new Date();
    const builtins: Record<string, string> = {
      title,
      date: now.toISOString().split('T')[0]!,
      time: now.toTimeString().split(' ')[0]!,
      datetime: `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`,
    };

    const allVars = { ...builtins, ...variables };

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return key in allVars ? allVars[key]! : match;
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npx vitest run src/services/template.test.ts
git add src/services/template.ts src/services/template.test.ts
git commit -m "feat: add template service with variable substitution"
```

---

### Task 9: Create dataview query service

**Files:**
- Create: `src/services/dataview.ts`
- Create: `src/services/dataview.test.ts`

- [ ] **Step 1: Write failing test**

`src/services/dataview.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { DataviewService, parseQuery } from './dataview.js';
import { CacheService } from './cache.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('parseQuery', () => {
  it('should parse simple equality', () => {
    const ast = parseQuery('status = "draft"');
    expect(ast).toEqual({ field: 'status', op: '=', value: 'draft' });
  });

  it('should parse AND expressions', () => {
    const ast = parseQuery('status = "draft" AND priority = "high"');
    expect(ast.type).toBe('AND');
  });

  it('should parse contains operator', () => {
    const ast = parseQuery('tags contains "project"');
    expect(ast).toEqual({ field: 'tags', op: 'contains', value: 'project' });
  });

  it('should parse exists operator', () => {
    const ast = parseQuery('author exists');
    expect(ast).toEqual({ field: 'author', op: 'exists' });
  });

  it('should parse nested fields', () => {
    const ast = parseQuery('author.name = "John"');
    expect(ast).toEqual({ field: 'author.name', op: '=', value: 'John' });
  });

  it('should throw on invalid query', () => {
    expect(() => parseQuery('')).toThrow();
  });
});

describe('DataviewService', () => {
  let dv: DataviewService;

  beforeEach(async () => {
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    dv = new DataviewService(cache);
  });

  it('should query by status', () => {
    const results = dv.query('status = "draft"');
    expect(results.some(r => r.path.includes('project-alpha'))).toBe(true);
  });

  it('should query with AND', () => {
    const results = dv.query('status = "draft" AND priority = "high"');
    expect(results.some(r => r.path.includes('project-alpha'))).toBe(true);
  });

  it('should query nested fields', () => {
    const results = dv.query('author.name = "John"');
    expect(results.some(r => r.path.includes('project-alpha'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/dataview.test.ts
```

- [ ] **Step 3: Implement dataview service with query parser**

`src/services/dataview.ts`:
```typescript
import type { CacheService } from './cache.js';

// AST types
export type QueryNode =
  | { type: 'AND'; left: QueryNode; right: QueryNode }
  | { type: 'OR'; left: QueryNode; right: QueryNode }
  | ComparisonNode;

export interface ComparisonNode {
  field: string;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'exists' | 'notExists';
  value?: string | number | boolean;
}

export interface QueryResult {
  path: string;
  frontmatter: Record<string, any>;
}

export function parseQuery(input: string): QueryNode {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Query cannot be empty');

  return parseOr(trimmed);
}

function parseOr(input: string): QueryNode {
  const parts = splitAtKeyword(input, ' OR ');
  if (parts.length === 1) return parseAnd(parts[0]!);
  let node: QueryNode = parseAnd(parts[0]!);
  for (let i = 1; i < parts.length; i++) {
    node = { type: 'OR', left: node, right: parseAnd(parts[i]!) };
  }
  return node;
}

function parseAnd(input: string): QueryNode {
  const parts = splitAtKeyword(input, ' AND ');
  if (parts.length === 1) return parseComparison(parts[0]!.trim());
  let node: QueryNode = parseComparison(parts[0]!.trim());
  for (let i = 1; i < parts.length; i++) {
    node = { type: 'AND', left: node, right: parseComparison(parts[i]!.trim()) };
  }
  return node;
}

function splitAtKeyword(input: string, keyword: string): string[] {
  // Naive split — doesn't handle parenthesized groups yet
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  const kw = keyword;

  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') depth++;
    else if (input[i] === ')') depth--;

    if (depth === 0 && input.substring(i, i + kw.length) === kw) {
      parts.push(current);
      current = '';
      i += kw.length - 1;
    } else {
      current += input[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseComparison(input: string): QueryNode {
  const trimmed = input.trim();

  // Handle parenthesized expressions — recurse to parseOr to support AND/OR inside parens
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return parseOr(trimmed.slice(1, -1));
  }

  // exists / notExists
  const existsMatch = trimmed.match(/^([\w.]+)\s+(exists|notExists)$/);
  if (existsMatch) {
    return { field: existsMatch[1]!, op: existsMatch[2]! as 'exists' | 'notExists' };
  }

  // Comparison operators
  const opPattern = /^([\w.]+)\s+(=|!=|>=|<=|>|<|contains|startsWith|endsWith)\s+(.+)$/;
  const match = trimmed.match(opPattern);
  if (!match) throw new Error(`Invalid query expression: "${trimmed}"`);

  const field = match[1]!;
  const op = match[2]! as ComparisonNode['op'];
  let rawValue = match[3]!.trim();

  // Parse value
  let value: string | number | boolean;
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    value = rawValue.slice(1, -1);
  } else if (rawValue === 'true') {
    value = true;
  } else if (rawValue === 'false') {
    value = false;
  } else if (!isNaN(Number(rawValue))) {
    value = Number(rawValue);
  } else {
    value = rawValue; // dates, unquoted strings
  }

  return { field, op, value };
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function evaluateNode(node: QueryNode, frontmatter: Record<string, any>): boolean {
  if ('type' in node && (node.type === 'AND' || node.type === 'OR')) {
    const left = evaluateNode(node.left, frontmatter);
    const right = evaluateNode(node.right, frontmatter);
    return node.type === 'AND' ? left && right : left || right;
  }

  const comp = node as ComparisonNode;
  const fieldValue = getNestedValue(frontmatter, comp.field);

  switch (comp.op) {
    case 'exists': return fieldValue !== undefined && fieldValue !== null;
    case 'notExists': return fieldValue === undefined || fieldValue === null;
    case '=': return String(fieldValue) === String(comp.value);
    case '!=': return String(fieldValue) !== String(comp.value);
    case '>': return fieldValue > comp.value!;
    case '<': return fieldValue < comp.value!;
    case '>=': return fieldValue >= comp.value!;
    case '<=': return fieldValue <= comp.value!;
    case 'contains':
      if (Array.isArray(fieldValue)) return fieldValue.includes(comp.value);
      if (typeof fieldValue === 'string') return fieldValue.includes(String(comp.value));
      return false;
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(String(comp.value));
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(String(comp.value));
    default: return false;
  }
}

export class DataviewService {
  constructor(private cache: CacheService) {}

  query(
    queryStr: string,
    options: { limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {},
  ): QueryResult[] {
    const { limit = 20, sortBy, sortOrder = 'asc' } = options;
    const ast = parseQuery(queryStr);
    const results: QueryResult[] = [];

    for (const [path, entry] of this.cache.getAllEntries()) {
      if (evaluateNode(ast, entry.frontmatter)) {
        results.push({ path, frontmatter: entry.frontmatter });
      }
    }

    if (sortBy) {
      results.sort((a, b) => {
        const aVal = getNestedValue(a.frontmatter, sortBy);
        const bVal = getNestedValue(b.frontmatter, sortBy);
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortOrder === 'desc' ? -cmp : cmp;
      });
    }

    return results.slice(0, Math.min(limit, 100));
  }
}
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npx vitest run src/services/dataview.test.ts
git add src/services/dataview.ts src/services/dataview.test.ts
git commit -m "feat: add dataview query service with frontmatter query language"
```

---

## Chunk 5: Extend Existing Services & Tool Shared Types

### Task 10: Extend SearchService with regex, pagination, date/path filters

**Files:**
- Modify: `src/services/search.ts`
- Modify: `src/types.ts` (extend SearchParams)
- Create: `src/services/search-extended.test.ts`

- [ ] **Step 1: Extend SearchParams in types.ts**

Append to `src/types.ts`:
```typescript
// Extended search types
export interface ExtendedSearchParams extends SearchParams {
  useRegex?: boolean;
  pathFilter?: string;       // glob pattern, e.g. "daily/*.md"
  modifiedAfter?: string;    // ISO date string
  modifiedBefore?: string;   // ISO date string
  offset?: number;           // pagination offset
}
```

- [ ] **Step 2: Write failing test for extended search**

`src/services/search-extended.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SearchService } from './search.js';
import { PathFilter } from '../pathfilter.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('SearchService extended features', () => {
  let search: SearchService;

  beforeEach(() => {
    search = new SearchService(TEST_VAULT, new PathFilter());
  });

  it('should support regex search', async () => {
    const results = await search.search({
      query: 'Task \\d+',
      useRegex: true,
      limit: 10,
    });
    expect(results.some(r => r.p.includes('project-alpha'))).toBe(true);
  });

  it('should support path filtering', async () => {
    const results = await search.search({
      query: 'worked',
      pathFilter: 'daily/*',
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.p.startsWith('daily/'))).toBe(true);
  });

  it('should support pagination offset', async () => {
    const all = await search.search({ query: 'the', limit: 20 });
    const page2 = await search.search({ query: 'the', limit: 2, offset: 2 });
    if (all.length > 2) {
      expect(page2[0]?.p).toBe(all[2]?.p);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/services/search-extended.test.ts
```

Expected: FAIL — `useRegex` and other extended params not recognized.

- [ ] **Step 4: Extend SearchService to accept extended params**

In `src/services/search.ts`, update the `search` method signature to accept `ExtendedSearchParams` and add:
- Regex matching mode (when `useRegex` is true, use `new RegExp(query, caseSensitive ? '' : 'i')`)
- Path filter (when `pathFilter` is set, filter `allowedFiles` with minimatch or simple glob)
- Date filter (when `modifiedAfter`/`modifiedBefore` are set, filter by file mtime)
- Pagination offset (apply `offset` before slicing to `maxLimit`)

Key implementation detail — add to the search method, after filtering files:
```typescript
// Path filter
if (params.pathFilter) {
  const pattern = params.pathFilter;
  allowedFiles = allowedFiles.filter(f => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(f.relativePath);
    }
    return f.relativePath.startsWith(pattern);
  });
}
```

And at the end, before returning:
```typescript
// Apply pagination offset
const offset = (params as ExtendedSearchParams).offset || 0;
return scored.slice(offset, offset + maxLimit).map(s => s.result);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/services/search-extended.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/search.ts src/services/search-extended.test.ts src/types.ts
git commit -m "feat: extend SearchService with regex, path filter, date filter, pagination"
```

---

### Task 11: Add folder management methods to FileSystemService

**Files:**
- Modify: `src/services/filesystem.ts`
- Modify: `src/types.ts` (add folder types)
- Create: `src/services/filesystem-folders.test.ts`

- [ ] **Step 1: Add folder types to types.ts**

Append to `src/types.ts`:
```typescript
// Folder management types
export interface ManageFolderParams {
  path: string;
  operation: 'create' | 'rename' | 'move' | 'delete';
  newPath?: string;  // required for 'rename' and 'move'
}

export interface ManageFolderResult {
  success: boolean;
  path: string;
  message: string;
}

// Vault structure types
export interface VaultStructureNode {
  name: string;
  type: 'file' | 'directory';
  children?: VaultStructureNode[];
}
```

- [ ] **Step 2: Write failing test**

`src/services/filesystem-folders.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import { join } from 'path';
import { rm, mkdir } from 'node:fs/promises';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');
const TEMP_DIR = join(TEST_VAULT, '_test-temp');

describe('FileSystemService folder operations', () => {
  let fs: FileSystemService;

  beforeEach(async () => {
    fs = new FileSystemService(TEST_VAULT, new PathFilter(), new FrontmatterHandler());
    await mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEMP_DIR, { recursive: true, force: true });
  });

  it('should create a folder', async () => {
    const result = await fs.manageFolder({ path: '_test-temp/new-folder', operation: 'create' });
    expect(result.success).toBe(true);
  });

  it('should rename a folder', async () => {
    await fs.manageFolder({ path: '_test-temp/old-name', operation: 'create' });
    const result = await fs.manageFolder({ path: '_test-temp/old-name', operation: 'rename', newPath: '_test-temp/new-name' });
    expect(result.success).toBe(true);
  });

  it('should delete an empty folder', async () => {
    await fs.manageFolder({ path: '_test-temp/to-delete', operation: 'create' });
    const result = await fs.manageFolder({ path: '_test-temp/to-delete', operation: 'delete' });
    expect(result.success).toBe(true);
  });

  it('should get vault structure', async () => {
    const tree = await fs.getVaultStructure('', 2);
    expect(tree).toBeDefined();
    expect(tree.type).toBe('directory');
    expect(tree.children!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/services/filesystem-folders.test.ts
```

Expected: FAIL — `manageFolder` and `getVaultStructure` not defined.

- [ ] **Step 4: Add folder methods to FileSystemService**

Add these methods to `src/services/filesystem.ts`:

```typescript
async manageFolder(params: ManageFolderParams): Promise<ManageFolderResult> {
  const { path, operation, newPath } = params;
  const fullPath = this.resolvePath(path);

  switch (operation) {
    case 'create': {
      await mkdir(fullPath, { recursive: true });
      return { success: true, path, message: `Created folder: ${path}` };
    }
    case 'rename':
    case 'move': {
      if (!newPath) throw new Error('newPath is required for rename/move operation');
      const fullNewPath = this.resolvePath(newPath);
      await mkdir(dirname(fullNewPath), { recursive: true }); // ensure parent exists for move
      await rename(fullPath, fullNewPath);
      return { success: true, path: newPath, message: `${operation === 'move' ? 'Moved' : 'Renamed'} ${path} → ${newPath}` };
    }
    case 'delete': {
      await rm(fullPath, { recursive: false }); // Only delete empty dirs for safety
      return { success: true, path, message: `Deleted folder: ${path}` };
    }
    default:
      throw new Error(`Unknown folder operation: ${operation}`);
  }
}

async getVaultStructure(subPath: string = '', maxDepth: number = 3): Promise<VaultStructureNode> {
  const fullPath = subPath ? this.resolvePath(subPath) : resolve(this.vaultPath);
  return this.buildTree(fullPath, basename(fullPath), 0, maxDepth);
}

private async buildTree(dirPath: string, name: string, depth: number, maxDepth: number): Promise<VaultStructureNode> {
  if (depth >= maxDepth) {
    return { name, type: 'directory' };
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const children: VaultStructureNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = relative(this.vaultPath, join(dirPath, entry.name)).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (!this.pathFilter.isAllowedForListing(relativePath)) continue;
      children.push(await this.buildTree(join(dirPath, entry.name), entry.name, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      children.push({ name: entry.name, type: 'file' });
    }
  }

  return { name, type: 'directory', children };
}
```

Note: Add `import { rename, rm } from 'node:fs/promises';` and `import { basename, relative } from 'path';` at the top if not already imported.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/services/filesystem-folders.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/filesystem.ts src/services/filesystem-folders.test.ts src/types.ts
git commit -m "feat: add folder management and vault structure to FileSystemService"
```

---

### Task 12: Create tool handler types and shared helpers

**Files:**
- Create: `src/tools/types.ts`

- [ ] **Step 1: Create shared tool types**

`src/tools/types.ts`:
```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat: add shared tool handler types and helpers"
```

---

## Chunk 6: Tool Handler Modules (Split from original Task 10)

### Task 13: Create note tool handlers

**Files:**
- Create: `src/tools/note-tools.ts`
- Create: `src/tools/note-tools.test.ts`

- [ ] **Step 1: Write failing test**

`src/tools/note-tools.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handlers } from './note-tools.js';
import { FileSystemService } from '../services/filesystem.js';
import { VaultAccess } from '../services/vault-access.js';
import { CacheService } from '../services/cache.js';
import { GraphService } from '../services/graph.js';
import { TemplateService } from '../services/template.js';
import { DataviewService } from '../services/dataview.js';
import { SearchService } from '../services/search.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import type { ToolContext } from './types.js';
import { join } from 'path';
import { rm, mkdir, copyFile } from 'node:fs/promises';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');
const TEMP_VAULT = join(process.cwd(), 'test-vault', 'temp-notes');

describe('note-tools handlers', () => {
  let ctx: ToolContext;

  beforeEach(async () => {
    // Use temp vault for write tests
    await mkdir(TEMP_VAULT, { recursive: true });
    await copyFile(join(TEST_VAULT, 'hello.md'), join(TEMP_VAULT, 'hello.md'));

    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEMP_VAULT, pf, fh);
    const cache = new CacheService(TEMP_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEMP_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEMP_VAULT,
    };
  });

  afterEach(async () => {
    await rm(TEMP_VAULT, { recursive: true, force: true });
  });

  it('read_note returns note content', async () => {
    const result = await handlers.read_note({ path: 'hello.md' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('Hello World');
  });

  it('write_note creates a new note', async () => {
    const result = await handlers.write_note({ path: 'new.md', content: '# New' }, ctx);
    expect(result.isError).toBeFalsy();
    const readBack = await handlers.read_note({ path: 'new.md' }, ctx);
    expect(readBack.content[0]!.text).toContain('New');
  });

  it('patch_note replaces text', async () => {
    const result = await handlers.patch_note({
      path: 'hello.md',
      oldString: 'Hello World',
      newString: 'Hello Universe',
    }, ctx);
    expect(result.isError).toBeFalsy();
    const readBack = await handlers.read_note({ path: 'hello.md' }, ctx);
    expect(readBack.content[0]!.text).toContain('Hello Universe');
  });

  it('insert_at inserts after heading', async () => {
    const result = await handlers.insert_at({
      path: 'hello.md',
      content: 'Inserted line',
      target: 'Hello World',
      position: 'after',
    }, ctx);
    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/tools/note-tools.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement note-tools.ts with all handlers**

`src/tools/note-tools.ts`:
```typescript
import type { ToolContext, ToolHandler, ToolResult } from './types.js';
import { success, error } from './types.js';
import { generateObsidianUri } from '../uri.js';

export const definitions = [
  {
    name: 'read_note',
    description: 'Read the content of a note including frontmatter',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note relative to vault root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_multiple_notes',
    description: 'Read multiple notes at once',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Array of note paths' },
        includeContent: { type: 'boolean', default: true },
        includeFrontmatter: { type: 'boolean', default: true },
      },
      required: ['paths'],
    },
  },
  {
    name: 'write_note',
    description: 'Create or overwrite a note with content and optional frontmatter',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'Note content (markdown)' },
        frontmatter: { type: 'object', description: 'YAML frontmatter as key-value pairs' },
        mode: { type: 'string', enum: ['overwrite', 'append', 'prepend'], default: 'overwrite' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_note',
    description: 'Find and replace text in a note (supports regex, case-insensitive, whole-word)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        oldString: { type: 'string', description: 'Text to find (or regex pattern if useRegex=true)' },
        newString: { type: 'string', description: 'Replacement text' },
        replaceAll: { type: 'boolean', default: false },
        useRegex: { type: 'boolean', description: 'Treat oldString as regex', default: false },
        caseSensitive: { type: 'boolean', default: true },
        wholeWord: { type: 'boolean', description: 'Match whole words only', default: false },
      },
      required: ['path', 'oldString', 'newString'],
    },
  },
  {
    name: 'insert_at',
    description: 'Insert content at a specific heading or block ID position in a note',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'Content to insert' },
        target: { type: 'string', description: "Heading text (e.g. '## Tasks') or block ID (e.g. '^block1')" },
        position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'], default: 'append' },
      },
      required: ['path', 'content', 'target'],
    },
  },
  {
    name: 'delete_note',
    description: 'Delete a note (requires confirmation via confirmPath)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note to delete' },
        confirmPath: { type: 'string', description: 'Must match path exactly to confirm deletion' },
      },
      required: ['path', 'confirmPath'],
    },
  },
  {
    name: 'move_note',
    description: 'Move/rename a note (.md files only)',
    inputSchema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string' },
        newPath: { type: 'string' },
        overwrite: { type: 'boolean', default: false },
      },
      required: ['oldPath', 'newPath'],
    },
  },
  {
    name: 'move_file',
    description: 'Move/rename any file (requires double confirmation)',
    inputSchema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string' },
        newPath: { type: 'string' },
        confirmOldPath: { type: 'string' },
        confirmNewPath: { type: 'string' },
        overwrite: { type: 'boolean', default: false },
      },
      required: ['oldPath', 'newPath', 'confirmOldPath', 'confirmNewPath'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async read_note(args, ctx) {
    const { path } = args as { path: string };
    const note = await ctx.vaultAccess.readNote(path);
    return success({
      path,
      frontmatter: note.frontmatter,
      content: note.content,
      obsidianUri: generateObsidianUri(ctx.vaultPath, path),
    });
  },

  async read_multiple_notes(args, ctx) {
    const { paths, includeContent = true, includeFrontmatter = true } = args as {
      paths: string[]; includeContent?: boolean; includeFrontmatter?: boolean;
    };
    const results = await ctx.filesystem.readMultipleNotes({ paths, includeContent, includeFrontmatter });
    return success(results);
  },

  async write_note(args, ctx) {
    const { path, content, frontmatter, mode } = args as {
      path: string; content: string; frontmatter?: Record<string, unknown>; mode?: string;
    };
    await ctx.vaultAccess.writeNote({
      path,
      content,
      frontmatter: frontmatter as Record<string, any>,
      mode: (mode as 'overwrite' | 'append' | 'prepend') || 'overwrite',
    });
    // Update cache after write
    const note = await ctx.vaultAccess.readNote(path);
    await ctx.cacheService.updateEntry(path, note.originalContent);
    return success({ path, message: `Note written successfully (${mode || 'overwrite'})` });
  },

  async patch_note(args, ctx) {
    const { path, oldString, newString, replaceAll, useRegex, caseSensitive = true, wholeWord = false } = args as {
      path: string; oldString: string; newString: string;
      replaceAll?: boolean; useRegex?: boolean; caseSensitive?: boolean; wholeWord?: boolean;
    };

    if (useRegex || !caseSensitive || wholeWord) {
      // Advanced patch: read, replace with regex, write back
      const note = await ctx.vaultAccess.readNote(path);
      const flags = (caseSensitive ? '' : 'i') + (replaceAll ? 'g' : '');
      const escaped = useRegex ? oldString : oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
      const regex = new RegExp(pattern, flags);
      const original = note.originalContent;
      const patched = original.replace(regex, newString);
      if (patched === original) {
        return error(`No matches found for "${oldString}" in ${path}`);
      }
      await ctx.vaultAccess.patchNote({ path, oldString: original, newString: patched });
      return success({ path, message: 'Patched successfully' });
    }

    const result = await ctx.vaultAccess.patchNote({ path, oldString, newString, replaceAll });
    if (!result.success) return error(result.message);

    // Update cache
    const note = await ctx.vaultAccess.readNote(path);
    await ctx.cacheService.updateEntry(path, note.originalContent);
    return success(result);
  },

  async insert_at(args, ctx) {
    const { path, content, target, position = 'append' } = args as {
      path: string; content: string; target: string; position?: string;
    };
    const note = await ctx.vaultAccess.readNote(path);
    const fullContent = note.originalContent;
    const lines = fullContent.split('\n');

    // Determine where frontmatter ends so we skip it during heading/block search
    let contentStartLine = 0;
    if (lines[0]?.trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') { contentStartLine = i + 1; break; }
      }
    }

    if (target.startsWith('^')) {
      const blockId = target;
      const lineIdx = lines.findIndex((l, i) => i >= contentStartLine && l.trimEnd().endsWith(blockId));
      if (lineIdx === -1) {
        const available = lines
          .filter(l => /\^[\w-]+$/.test(l.trimEnd()))
          .map(l => l.trimEnd().match(/(\^[\w-]+)$/)?.[1])
          .filter(Boolean);
        return error(`Block ID ${blockId} not found. Available: ${available.join(', ') || 'none'}`);
      }
      const insertIdx = position === 'before' ? lineIdx : lineIdx + 1;
      lines.splice(insertIdx, 0, content);
    } else {
      const targetClean = target.replace(/^#+\s*/, '').toLowerCase();
      const lineIdx = lines.findIndex((l, i) => {
        if (i < contentStartLine) return false; // skip frontmatter
        const match = l.match(/^(#{1,6})\s+(.+)/);
        return match !== null && match[2]!.trim().toLowerCase() === targetClean;
      });
      if (lineIdx === -1) return error(`Heading "${target}" not found in ${path}`);

      const headingLevel = lines[lineIdx]!.match(/^(#{1,6})/)?.[1]?.length ?? 1;

      if (position === 'before') {
        lines.splice(lineIdx, 0, content);
      } else if (position === 'after' || position === 'prepend') {
        lines.splice(lineIdx + 1, 0, content);
      } else {
        let endIdx = lines.length;
        for (let i = lineIdx + 1; i < lines.length; i++) {
          const nextHeading = lines[i]!.match(/^(#{1,6})\s/);
          if (nextHeading && nextHeading[1]!.length <= headingLevel) {
            endIdx = i;
            break;
          }
        }
        lines.splice(endIdx, 0, content);
      }
    }

    await ctx.vaultAccess.patchNote({ path, oldString: fullContent, newString: lines.join('\n') });
    await ctx.cacheService.updateEntry(path, lines.join('\n'));
    return success(`Inserted content at ${target} (${position}) in ${path}`);
  },

  async delete_note(args, ctx) {
    const { path, confirmPath } = args as { path: string; confirmPath: string };
    const result = await ctx.vaultAccess.deleteNote({ path, confirmPath });
    if (result.success) ctx.cacheService.removeEntry(path);
    return result.success ? success(result) : error(result.message);
  },

  async move_note(args, ctx) {
    const { oldPath, newPath, overwrite } = args as { oldPath: string; newPath: string; overwrite?: boolean };
    const result = await ctx.vaultAccess.moveNote({ oldPath, newPath, overwrite });
    if (result.success) {
      ctx.cacheService.removeEntry(oldPath);
      const note = await ctx.vaultAccess.readNote(newPath);
      await ctx.cacheService.updateEntry(newPath, note.originalContent);
    }
    return result.success ? success(result) : error(result.message);
  },

  async move_file(args, ctx) {
    const { oldPath, newPath, confirmOldPath, confirmNewPath, overwrite } = args as {
      oldPath: string; newPath: string; confirmOldPath: string; confirmNewPath: string; overwrite?: boolean;
    };
    const result = await ctx.vaultAccess.moveFile({ oldPath, newPath, confirmOldPath, confirmNewPath, overwrite });
    return result.success ? success(result) : error(result.message);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/tools/note-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/note-tools.ts src/tools/note-tools.test.ts
git commit -m "feat: add note tool handlers with tests"
```

---

### Task 14: Create search and dataview tool handlers

**Files:**
- Create: `src/tools/search-tools.ts`
- Create: `src/tools/search-tools.test.ts`

- [ ] **Step 1: Write failing test**

`src/tools/search-tools.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { handlers } from './search-tools.js';
import { FileSystemService } from '../services/filesystem.js';
import { VaultAccess } from '../services/vault-access.js';
import { CacheService } from '../services/cache.js';
import { GraphService } from '../services/graph.js';
import { TemplateService } from '../services/template.js';
import { DataviewService } from '../services/dataview.js';
import { SearchService } from '../services/search.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import type { ToolContext } from './types.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('search-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEST_VAULT, pf, fh);
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEST_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEST_VAULT,
    };
  });

  it('search_vault returns results', async () => {
    const result = await handlers.search_vault({ query: 'project' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('project');
  });

  it('query_notes filters by frontmatter', async () => {
    const result = await handlers.query_notes({ query: 'status = "draft"' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('project-alpha');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/tools/search-tools.test.ts
```

- [ ] **Step 3: Implement search-tools.ts**

`src/tools/search-tools.ts`:
```typescript
import type { ToolHandler } from './types.js';
import { success, error } from './types.js';

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
    description: 'Query notes by frontmatter fields using dataview-style syntax (e.g. status = "draft" AND priority = "high")',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Dataview query (e.g. status = "draft")' },
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
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npx vitest run src/tools/search-tools.test.ts
git add src/tools/search-tools.ts src/tools/search-tools.test.ts
git commit -m "feat: add search and dataview query tool handlers"
```

---

### Task 15: Create frontmatter tool handlers

**Files:**
- Create: `src/tools/frontmatter-tools.ts`
- Create: `src/tools/frontmatter-tools.test.ts`

- [ ] **Step 1: Write failing test**

`src/tools/frontmatter-tools.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { handlers } from './frontmatter-tools.js';
import { FileSystemService } from '../services/filesystem.js';
import { VaultAccess } from '../services/vault-access.js';
import { CacheService } from '../services/cache.js';
import { GraphService } from '../services/graph.js';
import { TemplateService } from '../services/template.js';
import { DataviewService } from '../services/dataview.js';
import { SearchService } from '../services/search.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import type { ToolContext } from './types.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('frontmatter-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEST_VAULT, pf, fh);
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEST_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEST_VAULT,
    };
  });

  it('get_frontmatter returns frontmatter', async () => {
    const result = await handlers.get_frontmatter({ path: 'hello.md' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('greeting');
  });

  it('get_notes_info returns info', async () => {
    const result = await handlers.get_notes_info({ paths: ['hello.md'] }, ctx);
    expect(result.isError).toBeFalsy();
  });

  it('manage_tags lists tags', async () => {
    const result = await handlers.manage_tags({ path: 'hello.md', operation: 'list' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('greeting');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/tools/frontmatter-tools.test.ts
```

- [ ] **Step 3: Implement frontmatter-tools.ts**

`src/tools/frontmatter-tools.ts`:
```typescript
import type { ToolHandler } from './types.js';
import { success, error } from './types.js';

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
        merge: { type: 'boolean', default: true, description: 'Merge with existing (true) or replace (false)' },
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
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags (required for add/remove)' },
      },
      required: ['path', 'operation'],
    },
  },
  {
    name: 'get_notes_info',
    description: 'Get metadata (size, modified date, frontmatter presence) for one or more notes',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['paths'],
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

    // Handle null-to-delete: if a key is set to null, remove it from frontmatter
    if (merge) {
      const existing = await ctx.vaultAccess.readNote(path);
      const merged = { ...existing.frontmatter, ...frontmatter };
      // Delete keys explicitly set to null
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
};
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npx vitest run src/tools/frontmatter-tools.test.ts
git add src/tools/frontmatter-tools.ts src/tools/frontmatter-tools.test.ts
git commit -m "feat: add frontmatter tool handlers with tests"
```

---

### Task 16: Create folder tool handlers

**Files:**
- Create: `src/tools/folder-tools.ts`
- Create: `src/tools/folder-tools.test.ts`

- [ ] **Step 1: Write failing test**

`src/tools/folder-tools.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { handlers } from './folder-tools.js';
import { FileSystemService } from '../services/filesystem.js';
import { VaultAccess } from '../services/vault-access.js';
import { CacheService } from '../services/cache.js';
import { GraphService } from '../services/graph.js';
import { TemplateService } from '../services/template.js';
import { DataviewService } from '../services/dataview.js';
import { SearchService } from '../services/search.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import type { ToolContext } from './types.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('folder-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEST_VAULT, pf, fh);
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEST_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEST_VAULT,
    };
  });

  it('list_directory lists files', async () => {
    const result = await handlers.list_directory({ path: '' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('hello.md');
  });

  it('get_vault_stats returns stats', async () => {
    const result = await handlers.get_vault_stats({}, ctx);
    expect(result.isError).toBeFalsy();
  });

  it('get_vault_structure returns tree', async () => {
    const result = await handlers.get_vault_structure({ maxDepth: 2 }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('directory');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/tools/folder-tools.test.ts
```

- [ ] **Step 3: Implement folder-tools.ts**

`src/tools/folder-tools.ts`:
```typescript
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

  async get_vault_stats(args, ctx) {
    const stats = await ctx.filesystem.getVaultStats();
    return success(stats);
  },

  async get_vault_structure(args, ctx) {
    const { path = '', maxDepth = 3 } = args as { path?: string; maxDepth?: number };
    const tree = await ctx.filesystem.getVaultStructure(path, maxDepth);
    return success(tree);
  },
};
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npx vitest run src/tools/folder-tools.test.ts
git add src/tools/folder-tools.ts src/tools/folder-tools.test.ts
git commit -m "feat: add folder tool handlers with tests"
```

---

### Task 17: Create graph and backlink tool handlers

**Files:**
- Create: `src/tools/graph-tools.ts`
- Create: `src/tools/backlink-tools.ts`
- Create: `src/tools/graph-tools.test.ts`

- [ ] **Step 1: Write failing test**

`src/tools/graph-tools.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { handlers as graphHandlers } from './graph-tools.js';
import { handlers as backlinkHandlers } from './backlink-tools.js';
import { FileSystemService } from '../services/filesystem.js';
import { VaultAccess } from '../services/vault-access.js';
import { CacheService } from '../services/cache.js';
import { GraphService } from '../services/graph.js';
import { TemplateService } from '../services/template.js';
import { DataviewService } from '../services/dataview.js';
import { SearchService } from '../services/search.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import type { ToolContext } from './types.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('graph-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEST_VAULT, pf, fh);
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEST_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEST_VAULT,
    };
  });

  it('get_backlinks returns backlinks', async () => {
    const result = await graphHandlers.get_backlinks({ path: 'project-alpha.md' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('hello.md');
  });

  it('get_outgoing_links returns links', async () => {
    const result = await graphHandlers.get_outgoing_links({ path: 'hello.md' }, ctx);
    expect(result.isError).toBeFalsy();
  });

  it('find_orphan_notes finds orphans', async () => {
    const result = await graphHandlers.find_orphan_notes({}, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('orphan');
  });

  it('auto_backlink dry run finds suggestions', async () => {
    const result = await backlinkHandlers.auto_backlink({ dryRun: true }, ctx);
    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/tools/graph-tools.test.ts
```

- [ ] **Step 3: Implement graph-tools.ts**

`src/tools/graph-tools.ts`:
```typescript
import type { ToolHandler } from './types.js';
import { success } from './types.js';
import { generateObsidianUri } from '../uri.js';

export const definitions = [
  {
    name: 'get_backlinks',
    description: 'Get all notes that link TO a given note',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'get_outgoing_links',
    description: 'Get all notes that a given note links TO',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
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
      backlinks: backlinks.map(p => ({
        path: p,
        obsidianUri: generateObsidianUri(ctx.vaultPath, p),
      })),
      count: backlinks.length,
    });
  },

  async get_outgoing_links(args, ctx) {
    const { path } = args as { path: string };
    await ctx.cacheService.waitForBuild();
    const links = ctx.graphService.getOutgoingLinks(path);
    return success({
      path,
      outgoingLinks: links.map(p => ({
        path: p,
        obsidianUri: generateObsidianUri(ctx.vaultPath, p),
      })),
      count: links.length,
    });
  },

  async find_orphan_notes(_args, ctx) {
    await ctx.cacheService.waitForBuild();
    const orphans = ctx.graphService.findOrphanNotes();
    return success({
      orphans: orphans.map(p => ({
        path: p,
        obsidianUri: generateObsidianUri(ctx.vaultPath, p),
      })),
      count: orphans.length,
    });
  },
};
```

- [ ] **Step 4: Implement backlink-tools.ts**

`src/tools/backlink-tools.ts`:
```typescript
import type { ToolHandler } from './types.js';
import { success } from './types.js';

export const definitions = [
  {
    name: 'auto_backlink',
    description: 'Scan vault for note name mentions and optionally convert them to [[wikilinks]]',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: true, description: 'Preview changes without applying' },
        scope: { type: 'string', description: 'Folder path to limit scan scope' },
        minNameLength: { type: 'number', default: 3, description: 'Minimum note name length to match' },
        excludePaths: { type: 'array', items: { type: 'string' }, description: 'Paths to exclude' },
      },
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async auto_backlink(args, ctx) {
    const { dryRun = true, scope, minNameLength = 3, excludePaths = [] } = args as any;
    await ctx.cacheService.waitForBuild();

    const entries = ctx.cacheService.getAllEntries();
    const noteNames = new Map<string, string>(); // noteName → path

    // Build lookup: note filename (without .md) → path
    for (const path of entries.keys()) {
      const name = path.split('/').pop()?.replace(/\.md$/, '') || '';
      if (name.length >= minNameLength) {
        noteNames.set(name, path);
      }
    }

    const suggestions: Array<{ file: string; matches: Array<{ noteName: string; line: number }> }> = [];
    let processedCount = 0;
    const MAX_NOTES = 1000;

    for (const [filePath, entry] of entries) {
      if (processedCount >= MAX_NOTES) break;
      if (scope && !filePath.startsWith(scope)) continue;
      if (excludePaths.some((p: string) => filePath.startsWith(p))) continue;

      const lines = entry.content.split('\n');
      const fileMatches: Array<{ noteName: string; line: number }> = [];
      let inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        // Track code block boundaries
        if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) continue;

        for (const [noteName, targetPath] of noteNames) {
          if (targetPath === filePath) continue; // Don't self-link
          // Match whole word, case-insensitive, global (replace all on line)
          const escaped = noteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

          // Skip if this mention is already inside a [[wikilink]] or [markdown](link) on this line
          const matches = [...line.matchAll(regex)];
          for (const m of matches) {
            const idx = m.index!;
            const before = line.substring(0, idx);
            // Check if inside [[ ... ]] — the closest [[ before the match must not have a ]] between it and the match
            const lastOpen = before.lastIndexOf('[[');
            const lastClose = before.lastIndexOf(']]');
            if (lastOpen > lastClose) continue; // inside a wikilink
            // Check if inside [text](url) — look for unclosed [ before and ]( after
            const lastBracketOpen = before.lastIndexOf('[');
            const lastBracketClose = before.lastIndexOf(']');
            if (lastBracketOpen > lastBracketClose) continue; // inside a markdown link text

            fileMatches.push({ noteName, line: i + 1 });

            if (!dryRun) {
              lines[i] = lines[i]!.substring(0, idx) + `[[${noteName}]]` + lines[i]!.substring(idx + m[0].length);
            }
            break; // One replacement per note name per line to avoid index shifts
          }
        }
      }

      if (fileMatches.length > 0) {
        suggestions.push({ file: filePath, matches: fileMatches });

        if (!dryRun) {
          // Write back modified content, then read back to get properly formatted content for cache
          await ctx.vaultAccess.writeNote({
            path: filePath, content: lines.join('\n'),
            frontmatter: entry.frontmatter, mode: 'overwrite',
          });
          // Read back the written file to get canonical content for cache
          const written = await ctx.vaultAccess.readNote(filePath);
          await ctx.cacheService.updateEntry(filePath, written.originalContent);
        }
      }

      processedCount++;
    }

    return success({
      dryRun,
      totalFilesScanned: processedCount,
      filesWithSuggestions: suggestions.length,
      suggestions: suggestions.slice(0, 50), // Cap output size
    });
  },
};
```

- [ ] **Step 5: Run tests, verify pass, commit**

```bash
npx vitest run src/tools/graph-tools.test.ts
git add src/tools/graph-tools.ts src/tools/backlink-tools.ts src/tools/graph-tools.test.ts
git commit -m "feat: add graph, backlink, and auto-backlink tool handlers"
```

---

### Task 18: Create template, attachment, and REST API tool handlers

**Files:**
- Create: `src/tools/template-tools.ts`
- Create: `src/tools/attachment-tools.ts`
- Create: `src/tools/rest-api-tools.ts`
- Create: `src/tools/remaining-tools.test.ts`

- [ ] **Step 1: Write failing test**

`src/tools/remaining-tools.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handlers as templateHandlers } from './template-tools.js';
import { handlers as attachmentHandlers } from './attachment-tools.js';
import { handlers as restApiHandlers } from './rest-api-tools.js';
import { FileSystemService } from '../services/filesystem.js';
import { VaultAccess } from '../services/vault-access.js';
import { CacheService } from '../services/cache.js';
import { GraphService } from '../services/graph.js';
import { TemplateService } from '../services/template.js';
import { DataviewService } from '../services/dataview.js';
import { SearchService } from '../services/search.js';
import { PathFilter } from '../pathfilter.js';
import { FrontmatterHandler } from '../frontmatter.js';
import type { ToolContext } from './types.js';
import { join } from 'path';
import { rm, mkdir, copyFile } from 'node:fs/promises';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');
const TEMP_VAULT = join(process.cwd(), 'test-vault', 'temp-remaining');

describe('template-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    await mkdir(TEMP_VAULT, { recursive: true });
    await mkdir(join(TEMP_VAULT, 'templates'), { recursive: true });
    // Copy template file
    await copyFile(join(TEST_VAULT, 'templates', 'default.md'), join(TEMP_VAULT, 'templates', 'default.md'));

    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEMP_VAULT, pf, fh);
    const cache = new CacheService(TEMP_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEMP_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEMP_VAULT,
    };
  });

  afterAll(async () => {
    await rm(TEMP_VAULT, { recursive: true, force: true });
  });

  it('create_from_template creates note from template (title derived from filename)', async () => {
    const result = await templateHandlers.create_from_template({
      templatePath: 'templates/default.md',
      outputPath: 'My New Note.md',
    }, ctx);
    expect(result.isError).toBeFalsy();
    const readBack = await ctx.vaultAccess.readNote('My New Note.md');
    expect(readBack.content).toContain('My New Note');
  });
});

describe('rest-api-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEST_VAULT, pf, fh);
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null), // No REST API
      filesystem: fs,
      searchService: new SearchService(TEST_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEST_VAULT,
    };
  });

  it('get_active_note errors when REST API unavailable', async () => {
    const result = await restApiHandlers.get_active_note({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('REST API');
  });
});

describe('attachment-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    // Use the parent test-vault dir (which has attachments/ sibling to notes/)
    const vaultRoot = join(process.cwd(), 'test-vault');
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(vaultRoot, pf, fh);
    const cache = new CacheService(vaultRoot, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(vaultRoot, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: vaultRoot,
    };
  });

  it('list_attachments finds non-md files', async () => {
    const result = await attachmentHandlers.list_attachments({}, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('readme.txt');
  });

  it('list_attachments filters by extension', async () => {
    const result = await attachmentHandlers.list_attachments({ extensions: ['.png'] }, ctx);
    expect(result.isError).toBeFalsy();
    // readme.txt should be filtered out
    expect(result.content[0]!.text).not.toContain('readme.txt');
  });

  it('get_attachment_info returns metadata', async () => {
    const result = await attachmentHandlers.get_attachment_info({ path: 'attachments/readme.txt' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('size');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/tools/remaining-tools.test.ts
```

- [ ] **Step 3: Implement template-tools.ts**

`src/tools/template-tools.ts`:
```typescript
import type { ToolHandler } from './types.js';
import { success, error } from './types.js';

export const definitions = [
  {
    name: 'create_from_template',
    description: 'Create a new note from a template with variable substitution. Title is derived from outputPath filename.',
    inputSchema: {
      type: 'object',
      properties: {
        templatePath: { type: 'string', description: 'Path to the template note' },
        outputPath: { type: 'string', description: 'Path for the new note (title derived from filename)' },
        variables: { type: 'object', description: 'Custom template variables (override built-ins like title, date)' },
      },
      required: ['templatePath', 'outputPath'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async create_from_template(args, ctx) {
    const { templatePath, outputPath, variables = {} } = args as any;

    // Derive title from outputPath filename
    const title = outputPath.split('/').pop()?.replace(/\.md$/, '') || outputPath;

    // Read template
    const template = await ctx.vaultAccess.readNote(templatePath);

    // Render template with variables
    const rendered = ctx.templateService.render(template.originalContent, title, variables);

    // Write new note
    await ctx.vaultAccess.writeNote({ path: outputPath, content: rendered, mode: 'overwrite' });
    await ctx.cacheService.updateEntry(outputPath, rendered);

    return success({ path: outputPath, message: `Created note from template ${templatePath}` });
  },
};
```

- [ ] **Step 4: Implement attachment-tools.ts**

`src/tools/attachment-tools.ts`:
```typescript
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'path';
import type { ToolHandler } from './types.js';
import { success, error } from './types.js';

export const definitions = [
  {
    name: 'list_attachments',
    description: 'List non-markdown attachments. Mode: "vault" scans folders, "note" lists attachments linked from a specific note.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['vault', 'note'], default: 'vault', description: 'vault: scan folders; note: list attachments linked from a note' },
        path: { type: 'string', description: 'Folder to scan (vault mode) or note path (note mode)' },
        extensions: { type: 'array', items: { type: 'string' }, description: 'Filter by extension (e.g. [".png", ".pdf"])' },
      },
    },
  },
  {
    name: 'get_attachment_info',
    description: 'Get metadata and referencing notes for an attachment',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the attachment' },
      },
      required: ['path'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async list_attachments(args, ctx) {
    const { mode = 'vault', path: pathArg = '', extensions } = args as any;

    if (mode === 'note') {
      // Find attachments linked from a specific note
      await ctx.cacheService.waitForBuild();
      const note = await ctx.vaultAccess.readNote(pathArg);
      const content = note.originalContent;
      // Match ![[file.ext]], ![alt](file.ext), and [[file.ext]] for non-.md files
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

    // Vault mode: scan folders
    const searchDir = pathArg ? join(ctx.vaultPath, pathArg) : ctx.vaultPath;
    const attachments = await findAttachments(searchDir, ctx.vaultPath, extensions);
    return success({ attachments, count: attachments.length });
  },

  async get_attachment_info(args, ctx) {
    const { path: filePath } = args as { path: string };
    const fullPath = join(ctx.vaultPath, filePath);
    const fileStat = await stat(fullPath);

    // Find referencing notes from cache
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
```

- [ ] **Step 5: Implement rest-api-tools.ts**

`src/tools/rest-api-tools.ts`:
```typescript
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
    description: 'Get a periodic note (daily, weekly, monthly) from Obsidian (requires REST API)',
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
```

- [ ] **Step 6: Run tests, verify pass, commit**

```bash
npx vitest run src/tools/remaining-tools.test.ts
git add src/tools/template-tools.ts src/tools/attachment-tools.ts src/tools/rest-api-tools.ts src/tools/remaining-tools.test.ts
git commit -m "feat: add template, attachment, and REST API tool handlers"
```

---

### Task 19: Create tools index aggregator

**Files:**
- Create: `src/tools/index.ts`

- [ ] **Step 1: Create tools/index.ts**

`src/tools/index.ts`:
```typescript
import * as noteTools from './note-tools.js';
import * as searchTools from './search-tools.js';
import * as frontmatterTools from './frontmatter-tools.js';
import * as folderTools from './folder-tools.js';
import * as graphTools from './graph-tools.js';
import * as backlinkTools from './backlink-tools.js';
import * as templateTools from './template-tools.js';
import * as attachmentTools from './attachment-tools.js';
import * as restApiTools from './rest-api-tools.js';
import type { ToolHandler } from './types.js';

const modules = [
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
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat: add tools index aggregator"
```

---

## Chunk 7: Server Wiring & MCPB Build

### Task 20: Rewrite server.ts entry point

**Files:**
- Rewrite: `src/server.ts`

- [ ] **Step 1: Rewrite server.ts**

Replace the existing monolithic `server.ts` with a clean entry point that wires everything together:

```typescript
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
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return await handler(args || {}, context);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Test the server starts**

```bash
echo '{}' | OBSIDIAN_VAULT_PATH=./test-vault/notes npx tsx src/server.ts
```

Expected: Server starts without errors (will hang waiting for input, Ctrl+C to exit).

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: rewrite server entry point with modular tool wiring"
```

---

### Task 21: Populate manifest tools array

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Add all 27 tool entries to manifest.json tools array**

Replace the empty `"tools": []` in `manifest.json` with the full list:
```json
"tools": [
  { "name": "read_note", "description": "Read the content of a note including frontmatter" },
  { "name": "read_multiple_notes", "description": "Read multiple notes at once" },
  { "name": "write_note", "description": "Create or overwrite a note with content and optional frontmatter" },
  { "name": "patch_note", "description": "Find and replace text in a note" },
  { "name": "insert_at", "description": "Insert content at a specific heading or block ID" },
  { "name": "delete_note", "description": "Delete a note (requires confirmation)" },
  { "name": "move_note", "description": "Move/rename a note" },
  { "name": "move_file", "description": "Move/rename any file (requires double confirmation)" },
  { "name": "search_vault", "description": "Search notes with BM25 ranking" },
  { "name": "query_notes", "description": "Query notes by frontmatter using dataview syntax" },
  { "name": "get_frontmatter", "description": "Get YAML frontmatter of a note" },
  { "name": "update_frontmatter", "description": "Update frontmatter fields" },
  { "name": "manage_tags", "description": "Add, remove, or list tags" },
  { "name": "get_notes_info", "description": "Get metadata for one or more notes" },
  { "name": "list_directory", "description": "List files and folders in a directory" },
  { "name": "manage_folder", "description": "Create, rename, or delete a folder" },
  { "name": "get_vault_stats", "description": "Get vault statistics" },
  { "name": "get_vault_structure", "description": "Get recursive directory tree" },
  { "name": "get_backlinks", "description": "Get notes that link to a given note" },
  { "name": "get_outgoing_links", "description": "Get notes that a given note links to" },
  { "name": "find_orphan_notes", "description": "Find notes with no links" },
  { "name": "auto_backlink", "description": "Find and convert note name mentions to wikilinks" },
  { "name": "create_from_template", "description": "Create a note from a template" },
  { "name": "list_attachments", "description": "List non-markdown attachments" },
  { "name": "get_attachment_info", "description": "Get attachment metadata and referencing notes" },
  { "name": "get_active_note", "description": "Get currently active note (requires REST API)" },
  { "name": "get_periodic_note", "description": "Get periodic note (requires REST API)" }
]
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "docs: populate manifest with all 27 tool definitions"
```

---

### Task 22: Fix tools.json generation and build MCPB

**Files:**
- Create: `src/tools/export-definitions.ts`
- Modify: `scripts/build-mcpb.js`

The original plan had a bug: importing `mcp-bridge.cjs` to extract tool definitions would execute the entire server (connecting to stdio transport, hanging). Fix: create a separate entry point that only exports definitions.

- [ ] **Step 1: Create definitions-only export**

`src/tools/export-definitions.ts`:
```typescript
// Standalone entry point for extracting tool definitions without starting the server.
// Used by the MCPB build script.
export { allToolDefinitions } from './index.js';
```

- [ ] **Step 2: Update package.json with definitions build**

Add to `scripts` in `package.json`:
```json
"build:defs": "esbuild dist/tools/export-definitions.js --bundle --platform=node --target=node18 --format=cjs --outfile=dist/tools-definitions.cjs"
```

- [ ] **Step 3: Update build-mcpb.js to use separate definitions build**

Replace the tools.json generation section in `scripts/build-mcpb.js`:
```javascript
  // 3. Generate tools.json from the definitions-only bundle (NOT the server bundle)
  await build({
    entryPoints: [join(distDir, 'tools', 'export-definitions.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(distDir, 'tools-definitions.cjs'),
    external: [],
    minify: false,
  });

  // Import definitions from the standalone bundle (no server startup)
  const defsModule = await import(join(distDir, 'tools-definitions.cjs'));
  const toolDefinitions = defsModule.allToolDefinitions || defsModule.default?.allToolDefinitions;
  writeFileSync(
    join(mcpbDir, 'server', 'tools.json'),
    JSON.stringify(toolDefinitions, null, 2),
  );
```

- [ ] **Step 4: Run the full MCPB build**

```bash
npm run build:mcpb
```

Expected: `dist/obsidian-mcp.mcpb` is created without hanging.

- [ ] **Step 5: Verify the .mcpb contents**

```bash
unzip -l dist/obsidian-mcp.mcpb
```

Expected: Contains `manifest.json`, `server/mcp-bridge.cjs`, `server/tools.json`.

- [ ] **Step 6: Commit**

```bash
git add src/tools/export-definitions.ts scripts/build-mcpb.js package.json
git commit -m "build: fix tools.json generation with standalone definitions export"
```

---

## Chunk 8: E2E Integration Test & Final

### Task 23: End-to-end integration test

**Files:**
- Create: `src/e2e.test.ts`

- [ ] **Step 1: Write E2E test**

`src/e2e.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { FileSystemService } from './services/filesystem.js';
import { VaultAccess } from './services/vault-access.js';
import { CacheService } from './services/cache.js';
import { GraphService } from './services/graph.js';
import { DataviewService } from './services/dataview.js';
import { TemplateService } from './services/template.js';
import { SearchService } from './services/search.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { allToolDefinitions, allToolHandlers } from './tools/index.js';
import type { ToolContext } from './tools/types.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('E2E Integration', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
    const pf = new PathFilter();
    const fh = new FrontmatterHandler();
    const fs = new FileSystemService(TEST_VAULT, pf, fh);
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    ctx = {
      vaultAccess: new VaultAccess(fs, null),
      filesystem: fs,
      searchService: new SearchService(TEST_VAULT, pf),
      cacheService: cache,
      graphService: new GraphService(cache),
      templateService: new TemplateService(),
      dataviewService: new DataviewService(cache),
      pathFilter: pf,
      vaultPath: TEST_VAULT,
    };
  });

  it('registers all 27 tools', () => {
    expect(allToolDefinitions.length).toBe(27);
    expect(Object.keys(allToolHandlers).length).toBe(27);
  });

  it('read → cache → graph pipeline works', async () => {
    const readResult = await allToolHandlers.read_note!({ path: 'hello.md' }, ctx);
    expect(readResult.content[0]!.text).toContain('Hello World');

    const backlinkResult = await allToolHandlers.get_backlinks!({ path: 'project-alpha.md' }, ctx);
    expect(backlinkResult.content[0]!.text).toContain('hello.md');
  });

  it('dataview queries work on cached data', async () => {
    const result = await allToolHandlers.query_notes!({ query: 'status = "draft"' }, ctx);
    expect(result.content[0]!.text).toContain('project-alpha');
  });

  it('orphan detection works', async () => {
    const result = await allToolHandlers.find_orphan_notes!({}, ctx);
    expect(result.content[0]!.text).toContain('orphan');
  });

  it('search works end-to-end', async () => {
    const result = await allToolHandlers.search_vault!({ query: 'project' }, ctx);
    expect(result.isError).toBeFalsy();
  });

  it('vault stats works', async () => {
    const result = await allToolHandlers.get_vault_stats!({}, ctx);
    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass including E2E.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test: add E2E integration test, project complete"
```

- [ ] **Step 4: Push to remote**

```bash
git push origin main
```
