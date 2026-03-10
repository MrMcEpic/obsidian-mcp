import { describe, it, expect, beforeEach } from 'vitest';
import { SearchService } from './search.js';
import { PathFilter } from '../pathfilter.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('SearchService extended features', () => {
  let search: SearchService;

  beforeEach(() => {
    search = new SearchService(TEST_VAULT, new PathFilter());
  });

  it('should support regex search', async () => {
    const results = await search.search({
      query: 'Task \\d+',
      useRegex: true,
      limit: 10,
    });
    expect(results.some(r => r.p.includes('project-alpha'))).toBe(true);
  });

  it('should support path filtering', async () => {
    const results = await search.search({
      query: 'worked',
      pathFilter: 'daily/*',
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.p.startsWith('daily/'))).toBe(true);
  });

  it('should support pagination offset', async () => {
    const all = await search.search({ query: 'the', limit: 20 });
    const page2 = await search.search({ query: 'the', limit: 2, offset: 2 });
    if (all.length > 2) {
      expect(page2[0]?.p).toBe(all[2]?.p);
    }
  });
});
