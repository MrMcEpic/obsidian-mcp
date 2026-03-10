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
