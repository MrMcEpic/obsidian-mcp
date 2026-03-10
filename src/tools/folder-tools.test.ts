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
