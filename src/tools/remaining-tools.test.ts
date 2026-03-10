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

  it('create_from_template creates note from template', async () => {
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

  it('get_active_note errors when REST API unavailable', async () => {
    const result = await restApiHandlers.get_active_note({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('REST API');
  });
});

describe('attachment-tools handlers', () => {
  let ctx: ToolContext;

  beforeAll(async () => {
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
    expect(result.content[0]!.text).not.toContain('readme.txt');
  });

  it('get_attachment_info returns metadata', async () => {
    const result = await attachmentHandlers.get_attachment_info({ path: 'attachments/readme.txt' }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain('size');
  });
});
