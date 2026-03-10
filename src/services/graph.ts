import type { CacheService } from './cache.js';

export interface LinkInfo {
  path: string;
  title: string;
}

export class GraphService {
  constructor(private cache: CacheService) {}

  getBacklinks(path: string): string[] {
    return this.cache.getBacklinks(path);
  }

  getOutgoingLinks(path: string): string[] {
    return this.cache.getOutgoingLinks(path);
  }

  findOrphanNotes(): string[] {
    return this.cache.getOrphanNotes();
  }
}
