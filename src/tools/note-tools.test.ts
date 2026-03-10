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
