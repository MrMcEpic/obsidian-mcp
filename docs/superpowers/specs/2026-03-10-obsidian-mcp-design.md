# Obsidian MCP — Definitive Design Spec

**Date**: 2026-03-10
**Author**: MrMcEpic
**Base**: Fork of `bitbonsai/mcp-obsidian` (659 stars, MIT license)
**Target**: Claude Desktop via `.mcpb` package

---

## Overview

The definitive Obsidian MCP server — a comprehensive Model Context Protocol server that gives Claude Desktop full access to an Obsidian vault. Merges the best features from three existing Obsidian MCP servers (`bitbonsai/mcp-obsidian`, `cyanheads/obsidian-mcp-server`, `newtype-01/obsidian-mcp`) and adds new capabilities for graph analysis, templates, dataview-style queries, and attachment management.

**27 tools** organized into 9 categories. Dual-mode vault access (REST API with filesystem fallback). Packaged as `.mcpb` for Claude Desktop with user-configurable settings.

---

## Architecture

### Project Structure

```
obsidian-mcp/
├── src/
│   ├── server.ts              # Entry point, tool registration, stdio transport
│   ├── services/
│   │   ├── filesystem.ts      # Direct disk read/write (from bitbonsai)
│   │   ├── rest-api.ts        # Obsidian Local REST API client (new)
│   │   ├── vault-access.ts    # Dual-mode orchestrator: REST → filesystem fallback (new)
│   │   ├── search.ts          # Search engine (from bitbonsai, extended)
│   │   ├── cache.ts           # In-memory vault cache with link index (from cyanheads)
│   │   ├── graph.ts           # Link/backlink analysis (new)
│   │   ├── template.ts        # Template support (new)
│   │   └── dataview.ts        # Frontmatter-based queries (new)
│   ├── frontmatter.ts         # Frontmatter parser (from bitbonsai)
│   └── pathfilter.ts          # Path filtering (from bitbonsai)
├── scripts/
│   └── build-mcpb.js          # Packages dist into .mcpb zip (new)
├── dist/                      # Compiled output
├── manifest.json              # MCPB manifest with user_config
├── package.json
├── tsconfig.json
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-10-obsidian-mcp-design.md  # This file
```

### Dual-Mode Vault Access

The `vault-access.ts` orchestrator handles all tool calls:

1. Check if REST API is configured (`OBSIDIAN_API_KEY` + `OBSIDIAN_API_PORT` set)
2. If not configured → use filesystem directly
3. If configured → try REST API first
   - Success → return result
   - Failure (connection refused, timeout) → fall back to filesystem

Two tools are REST-only and skip fallback:
- `get_active_note` — requires Obsidian to be running
- `get_periodic_note` — requires Obsidian to be running

These return a clear error when REST API is unavailable.

### Caching

In-memory vault cache (`cache.ts`), simplified from cyanheads' approach:

- **Data**: Map of all `.md` files: `path → { content, frontmatter, mtime, links }`
- **Startup**: Async initialization — server starts immediately, cache builds in background. Tools that need the cache wait for it; tools that don't (read/write/patch) work immediately. For large vaults (10k+ notes), prevents Claude Desktop startup timeout.
- **Refresh**: Auto-refreshes on configurable interval (default 10 min), only re-reads files where mtime changed
- **Proactive updates**: After any write/patch/delete tool, cache updates immediately for that file
- **Link index**: Secondary index maintained for graph operations:
  ```
  linkIndex: {
    "note-a.md": {
      outgoing: ["note-b.md", "note-c.md"],
      backlinks: ["note-d.md"]
    }
  }
  ```
  Built incrementally — only reparses files whose mtime changed on refresh, not the entire vault. Parsed from `[[wikilinks]]` and `[markdown](links.md)` in content.
- **Consumers**: `search_vault`, `query_notes`, `get_backlinks`, `get_outgoing_links`, `find_orphan_notes`, `auto_backlink`, `get_vault_stats`
- **Config**: `OBSIDIAN_CACHE_INTERVAL` env var (minutes, default 10, set 0 to disable)

### Dependencies

Keeping it lean — 3 runtime deps:
- `@modelcontextprotocol/sdk` — MCP protocol
- `gray-matter` — frontmatter parsing
- `axios` — REST API client

Dev dependencies: `typescript`, `esbuild` (bundler), `vitest` (testing), `@types/node`.

---

## Error Handling

All tools return structured JSON responses with consistent error format:

```json
{ "content": [{ "type": "text", "text": "Error: <message>" }], "isError": true }
```

### Dual-mode fallback errors
- REST API timeout: 5 second default. On timeout or connection refused, silently falls back to filesystem.
- If both REST API and filesystem fail, return error describing what went wrong in both modes.
- REST-only tools (`get_active_note`, `get_periodic_note`): return clear error "Obsidian must be running with Local REST API plugin enabled."

### File operation errors
- Path traversal attempts (e.g. `../../etc/passwd`): rejected by pathfilter before any I/O.
- File not found: return error with the path that was attempted.
- Permission denied: return OS error message.
- Confirmation mismatch (`delete_note`, `move_file`): return error explaining the mismatch.

### Cache errors
- Cache build failure on a single file: skip that file, log warning, continue.
- Full cache failure: tools fall back to direct filesystem reads (slower but functional).

---

## Tool Set (27 tools)

### Core Note Operations (8 tools)

| Tool | Description | Origin |
|---|---|---|
| `read_note` | Read single note (content + frontmatter + file stats) | bitbonsai |
| `read_multiple_notes` | Batch read up to 10 notes | bitbonsai |
| `write_note` | Create/write note (overwrite/append/prepend modes) | bitbonsai |
| `patch_note` | Find-and-replace within a note. Supports string or regex, case-sensitive flag, whole-word flag, replaceAll option. | bitbonsai + cyanheads |
| `insert_at` | Insert content at heading or `^block-id` position. See Insert At section below. | newtype-01 |
| `delete_note` | Delete note with path confirmation | bitbonsai |
| `move_note` | Move/rename a note | bitbonsai |
| `move_file` | Move/rename any file (binary-safe, with confirmation) | bitbonsai |

### Search (2 tools)

| Tool | Description | Origin |
|---|---|---|
| `search_vault` | Global search — regex, pagination, date filter, path filter. Results ranked by relevance: exact title match > title substring > content frequency. | cyanheads + newtype-01 |
| `query_notes` | Dataview-style: query notes by frontmatter properties. See Query Language section below. | new |

### Frontmatter & Tags (4 tools)

| Tool | Description | Origin |
|---|---|---|
| `get_frontmatter` | Extract frontmatter without reading content | bitbonsai |
| `update_frontmatter` | Atomic set/delete on individual keys (set key to `null` to delete), or merge an object into existing frontmatter | bitbonsai + cyanheads |
| `manage_tags` | Add/remove/list tags (frontmatter + inline) | cyanheads |
| `get_notes_info` | Metadata for multiple notes without full content | bitbonsai |

### Folder & Vault (4 tools)

| Tool | Description | Origin |
|---|---|---|
| `list_directory` | List files/dirs with tree view | bitbonsai + cyanheads |
| `manage_folder` | Create/rename/move/delete folders | newtype-01 |
| `get_vault_stats` | Total notes, folders, size, recently modified files | bitbonsai |
| `get_vault_structure` | Full vault tree for orientation | new |

### Graph & Links (3 tools)

| Tool | Description | Origin |
|---|---|---|
| `get_backlinks` | Find all notes that link to a given note | new |
| `get_outgoing_links` | List all links from a note (wiki + markdown) | new |
| `find_orphan_notes` | Find notes with no incoming or outgoing links | new |

### Auto-Linking (1 tool)

| Tool | Description | Origin |
|---|---|---|
| `auto_backlink` | Scan vault, convert text mentions to `[[wikilinks]]`. See Auto-Backlink section below. | newtype-01 |

### Templates (1 tool)

| Tool | Description | Origin |
|---|---|---|
| `create_from_template` | Create note from template file. See Templates section below. | new |

### Attachments (2 tools)

| Tool | Description | Origin |
|---|---|---|
| `list_attachments` | List non-markdown files (images, PDFs, etc.). Two modes: `vault` (all attachments) or `note` (files linked from a specific note). Filterable by extension. | new |
| `get_attachment_info` | Get metadata (size, type, dimensions for images, which notes reference it) for a specific attachment | new |

### REST API Exclusive (2 tools)

| Tool | Description | Origin |
|---|---|---|
| `get_active_note` | Read the currently open note in Obsidian | cyanheads |
| `get_periodic_note` | Get daily/weekly/monthly/quarterly/yearly note | cyanheads |

---

## Tool Specifications

### `insert_at` — Heading & Block ID Insertion

**Parameters**: `path`, `content`, `target` (heading text or `^block-id`), `position` (before|after|append|prepend)

**Heading resolution**:
- Matches heading text case-insensitively, ignoring leading `#` characters
- If multiple headings match, uses the first occurrence
- `position: append` inserts content at the end of the heading's section (before the next heading of equal or higher level)
- `position: prepend` inserts content immediately after the heading line
- `position: before` inserts content before the heading line itself
- `position: after` inserts content after the heading line (same as prepend)

**Block ID resolution**:
- Looks for `^block-id` at the end of a paragraph/list item
- If block ID not found, returns error with available block IDs in the note
- `position: before/after` inserts relative to the block's paragraph

### `query_notes` — Query Language

A simple query language for filtering notes by frontmatter properties.

**Supported operators**: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `startsWith`, `endsWith`, `exists`, `notExists`

**Logical operators**: `AND`, `OR` (AND takes precedence, use parentheses to override)

**Value types**: strings (quoted `"value"`), numbers, booleans (`true`/`false`), dates (`2026-03-10`)

**Nested fields**: Dot notation — `author.name = "John"`

**Examples**:
```
status = "draft"
status = "draft" AND tags contains "project"
created >= 2026-01-01 OR updated >= 2026-03-01
category = "work" AND (priority = "high" OR priority = "urgent")
author.name exists
```

**Parameters**: `query` (string), `limit` (default 20, max 100), `sortBy` (frontmatter key), `sortOrder` (asc|desc)

**Returns**: Array of `{ path, frontmatter }` matching the query.

**Invalid queries**: Return error with a description of what failed to parse. Do not silently return empty results.

### `auto_backlink` — Auto-Linking Rules

**Parameters**: `dryRun` (boolean, default `true`), `scope` (path filter, default entire vault), `minNameLength` (default 3), `excludePaths` (array of paths/globs to skip)

**Matching rules**:
- Matches note filenames (without `.md`) as whole words in other notes' content
- Case-insensitive matching
- Minimum note name length: 3 characters (configurable). Prevents matching notes named "I", "A", "The", etc.
- Skips matches already inside `[[wikilinks]]`, `[markdown](links)`, code blocks, and frontmatter
- Skips self-references (won't link a note to itself)

**Performance**:
- Uses the cache's link index, not raw file scanning
- Processes notes in batches of 50
- Maximum 1000 notes per invocation. If vault exceeds this, requires `scope` to narrow the operation.
- `dryRun: true` (default) returns a preview of changes without modifying any files

**Returns**: `{ modified: number, changes: [{ path, matches: [{ text, line }] }] }`

### `create_from_template` — Templates

**Parameters**: `templatePath` (path to template note), `outputPath` (path for new note), `variables` (object of key-value pairs)

**Built-in variables** (always available, can be overridden):
- `{{title}}` — filename without extension, derived from `outputPath`
- `{{date}}` — current date in ISO format (YYYY-MM-DD)
- `{{time}}` — current time (HH:MM:SS)
- `{{datetime}}` — current datetime (YYYY-MM-DD HH:MM:SS)

**Custom variables**: Any key in the `variables` object becomes `{{key}}`. Undefined variables are left as-is in the output (not replaced, not errored).

**Template frontmatter**: Template's own frontmatter is included in the output. Variables are substituted in frontmatter values too.

---

## Test Strategy

### Unit tests (vitest)
- **Services**: Each service (`filesystem`, `rest-api`, `cache`, `search`, `graph`, `dataview`, `template`) gets its own test file
- **Frontmatter/pathfilter**: Existing tests from bitbonsai, extended for new functionality
- **Query parser**: Dedicated tests for the `query_notes` grammar — valid queries, invalid queries, edge cases
- **Link parser**: Tests for extracting `[[wikilinks]]` and `[markdown](links)` from content

### Integration tests
- **Dual-mode fallback**: Mock REST API failures, verify filesystem fallback triggers
- **Cache consistency**: Write a note, verify cache updates, verify search finds the new content
- **Auto-backlink**: Test on a small fixture vault with known note names and expected wikilink conversions

### Test vault
- A small fixture vault (`test-vault/`) with ~20 notes covering: nested folders, frontmatter variations, wikilinks, block IDs, headings, attachments, templates. Used by integration tests.

---

## MCPB Packaging

### Bundle Structure

```
obsidian-mcp.mcpb (zip)
├── manifest.json
├── server/
│   ├── mcp-bridge.cjs     # Single-file bundled server (esbuild, all deps inlined)
│   └── tools.json          # Full tool schemas with inputSchema
```

### manifest.json

```json
{
  "manifest_version": "0.3",
  "name": "obsidian-mcp",
  "display_name": "Obsidian Knowledge Base",
  "version": "1.0.0",
  "description": "AI-driven knowledge management for Obsidian vaults. Read, write, search, and analyze notes; manage frontmatter and tags; graph analysis; template support; auto-backlinking; dataview-style queries.",
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
      "description": "Path to your Obsidian vault (e.g. C:\\Users\\You\\Documents\\MyVault)",
      "required": true
    },
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "API key from Obsidian Local REST API plugin (optional — enables live Obsidian features)",
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
      "title": "Cache Refresh Interval",
      "description": "How often to refresh the vault cache in minutes (0 to disable)",
      "default": "10",
      "required": false
    }
  },
  "tools": [
    { "name": "read_note", "description": "Read a note's content and frontmatter" },
    { "name": "read_multiple_notes", "description": "Batch read up to 10 notes" },
    { "name": "write_note", "description": "Create or write a note (overwrite/append/prepend)" },
    { "name": "patch_note", "description": "Find and replace within a note (string or regex, case-sensitive, whole-word)" },
    { "name": "insert_at", "description": "Insert content at a heading or block ID position" },
    { "name": "delete_note", "description": "Delete a note with path confirmation" },
    { "name": "move_note", "description": "Move or rename a note" },
    { "name": "move_file", "description": "Move or rename any file (binary-safe)" },
    { "name": "search_vault", "description": "Global vault search with regex, pagination, date/path filtering" },
    { "name": "query_notes", "description": "Query notes by frontmatter properties (dataview-style)" },
    { "name": "get_frontmatter", "description": "Extract frontmatter without reading content" },
    { "name": "update_frontmatter", "description": "Atomic get/set/delete frontmatter keys" },
    { "name": "manage_tags", "description": "Add, remove, or list tags in a note" },
    { "name": "get_notes_info", "description": "Get metadata for multiple notes without content" },
    { "name": "list_directory", "description": "List files and directories with tree view" },
    { "name": "manage_folder", "description": "Create, rename, move, or delete folders" },
    { "name": "get_vault_stats", "description": "Vault statistics: note count, size, recent files" },
    { "name": "get_vault_structure", "description": "Full vault directory tree" },
    { "name": "get_backlinks", "description": "Find all notes linking to a given note" },
    { "name": "get_outgoing_links", "description": "List all links from a note" },
    { "name": "find_orphan_notes", "description": "Find notes with no links in or out" },
    { "name": "auto_backlink", "description": "Scan vault and convert text mentions to [[wikilinks]]" },
    { "name": "create_from_template", "description": "Create a note from a template with variable substitution" },
    { "name": "list_attachments", "description": "List images, PDFs, and files in the vault" },
    { "name": "get_attachment_info", "description": "Get metadata and references for an attachment" },
    { "name": "get_active_note", "description": "Read the currently open note in Obsidian (REST API only)" },
    { "name": "get_periodic_note", "description": "Get daily/weekly/monthly/yearly note (REST API only)" }
  ],
  "compatibility": {
    "platforms": ["win32", "darwin", "linux"]
  }
}
```

### Build Pipeline

```
1. tsc              — compile TypeScript to dist/
2. esbuild          — bundle dist/ into single server/mcp-bridge.cjs
                      (CommonJS, node platform, all deps inlined)
3. extract schemas  — generate tools.json from tool definitions in server.ts
4. zip              — package manifest.json + server/ → obsidian-mcp.mcpb
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OBSIDIAN_VAULT_PATH` | Yes | — | Path to Obsidian vault |
| `OBSIDIAN_API_KEY` | No | — | Enables REST API mode when set |
| `OBSIDIAN_API_PORT` | No | `27123` | REST API port |
| `OBSIDIAN_CACHE_INTERVAL` | No | `10` | Cache refresh interval in minutes (0 = disabled) |

All configured via Claude Desktop's settings UI through `user_config` in the manifest.

---

## Feature Origins

| Source Repo | Features Ported |
|---|---|
| **bitbonsai/mcp-obsidian** | Core CRUD (read/write/patch/delete/move), batch read, frontmatter parsing, path filtering, vault stats, search, directory listing |
| **cyanheads/obsidian-mcp-server** | REST API client, vault cache, regex/case-sensitive/whole-word options for patch_note, global search with pagination/filtering, atomic frontmatter ops, tag management (frontmatter + inline), active note targeting, periodic notes |
| **newtype-01/obsidian-mcp** | Heading/block-level insertion, folder CRUD, auto-backlinking, dual API with filesystem fallback |
| **New features** | Graph analysis (backlinks, outgoing links, orphan detection), vault structure tree, template support, dataview-style queries, attachment management |
