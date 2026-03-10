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
