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
