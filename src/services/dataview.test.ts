import { describe, it, expect, beforeEach } from 'vitest';
import { DataviewService, parseQuery } from './dataview.js';
import { CacheService } from './cache.js';
import { join } from 'path';

const TEST_VAULT = join(process.cwd(), 'test-vault', 'notes');

describe('parseQuery', () => {
  it('should parse simple equality', () => {
    const ast = parseQuery('status = "draft"');
    expect(ast).toEqual({ field: 'status', op: '=', value: 'draft' });
  });

  it('should parse AND expressions', () => {
    const ast = parseQuery('status = "draft" AND priority = "high"');
    expect(ast.type).toBe('AND');
  });

  it('should parse contains operator', () => {
    const ast = parseQuery('tags contains "project"');
    expect(ast).toEqual({ field: 'tags', op: 'contains', value: 'project' });
  });

  it('should parse exists operator', () => {
    const ast = parseQuery('author exists');
    expect(ast).toEqual({ field: 'author', op: 'exists' });
  });

  it('should parse nested fields', () => {
    const ast = parseQuery('author.name = "John"');
    expect(ast).toEqual({ field: 'author.name', op: '=', value: 'John' });
  });

  it('should throw on invalid query', () => {
    expect(() => parseQuery('')).toThrow();
  });
});

describe('DataviewService', () => {
  let dv: DataviewService;

  beforeEach(async () => {
    const cache = new CacheService(TEST_VAULT, 0);
    await cache.build();
    dv = new DataviewService(cache);
  });

  it('should query by status', () => {
    const results = dv.query('status = "draft"');
    expect(results.some(r => r.path.includes('project-alpha'))).toBe(true);
  });

  it('should query with AND', () => {
    const results = dv.query('status = "draft" AND priority = "high"');
    expect(results.some(r => r.path.includes('project-alpha'))).toBe(true);
  });

  it('should query nested fields', () => {
    const results = dv.query('author.name = "John"');
    expect(results.some(r => r.path.includes('project-alpha'))).toBe(true);
  });
});
