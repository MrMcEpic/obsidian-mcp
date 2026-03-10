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
