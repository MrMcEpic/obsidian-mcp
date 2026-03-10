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
