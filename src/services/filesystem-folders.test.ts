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
