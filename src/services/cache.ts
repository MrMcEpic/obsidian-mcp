import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'path';
import matter from 'gray-matter';
import type { CachedNote, LinkIndex } from '../types.js';

export class CacheService {
  private entries = new Map<string, CachedNote>();
  private linkIndex: LinkIndex = {
    outgoing: new Map(),
    backlinks: new Map(),
  };
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private building = false;
  private buildPromise: Promise<void> | null = null;

  constructor(
    private vaultPath: string,
    private refreshIntervalMinutes: number = 10,
  ) {
    this.vaultPath = resolve(vaultPath);
  }

  /** Start async build. Returns immediately. Await waitForBuild() when needed. */
  startBuild(): void {
    this.stop();
    this.buildPromise = this.build();
    if (this.refreshIntervalMinutes > 0) {
      this.refreshTimer = setInterval(
        () => this.refresh(),
        this.refreshIntervalMinutes * 60 * 1000,
      );
      this.refreshTimer.unref();
    }
  }

  async waitForBuild(): Promise<void> {
    if (this.buildPromise) await this.buildPromise;
  }

  async build(): Promise<void> {
    if (this.building) return;
    this.building = true;
    try {
      const files = await this.findMarkdownFiles(this.vaultPath);

      // Pass 1: load all files with empty outgoingLinks so resolveLink can find them
      for (const fullPath of files) {
        const relativePath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
        await this.cacheFilePass1(relativePath, fullPath);
      }

      // Pass 2: resolve links now that all entries are known
      for (const fullPath of files) {
        const relativePath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
        this.resolveLinksForEntry(relativePath);
      }

      this.rebuildLinkIndex();
    } finally {
      this.building = false;
    }
  }

  async refresh(): Promise<void> {
    const files = await this.findMarkdownFiles(this.vaultPath);
    const currentPaths = new Set<string>();
    let changed = false;

    // Pass 1: cache all new/updated files with empty links
    for (const fullPath of files) {
      const relativePath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
      currentPaths.add(relativePath);

      const fileStat = await stat(fullPath);
      const cached = this.entries.get(relativePath);

      if (!cached || cached.mtime < fileStat.mtime.getTime()) {
        await this.cacheFilePass1(relativePath, fullPath, fileStat);
        changed = true;
      }
    }

    // Remove deleted files
    for (const path of this.entries.keys()) {
      if (!currentPaths.has(path)) {
        this.entries.delete(path);
        changed = true;
      }
    }

    if (changed) {
      // Pass 2: re-resolve all links
      for (const relativePath of this.entries.keys()) {
        this.resolveLinksForEntry(relativePath);
      }
      this.rebuildLinkIndex();
    }
  }

  async updateEntry(path: string, content: string): Promise<void> {
    const parsed = matter(content);
    const outgoingLinks = this.parseAndResolveLinks(parsed.content, path);
    this.entries.set(path, {
      content: parsed.content,
      frontmatter: parsed.data,
      mtime: Date.now(),
      outgoingLinks,
    });
    this.rebuildLinkIndex();
  }

  removeEntry(path: string): void {
    this.entries.delete(path);
    this.rebuildLinkIndex();
  }

  getEntry(path: string): CachedNote | undefined {
    return this.entries.get(path);
  }

  getAllEntries(): ReadonlyMap<string, CachedNote> {
    return this.entries;
  }

  getOutgoingLinks(path: string): string[] {
    return this.linkIndex.outgoing.get(path) || [];
  }

  getBacklinks(path: string): string[] {
    return this.linkIndex.backlinks.get(path) || [];
  }

  getOrphanNotes(): string[] {
    const orphans: string[] = [];
    for (const path of this.entries.keys()) {
      const outgoing = this.linkIndex.outgoing.get(path) || [];
      const backlinks = this.linkIndex.backlinks.get(path) || [];
      if (outgoing.length === 0 && backlinks.length === 0) {
        orphans.push(path);
      }
    }
    return orphans;
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // --- Private ---

  /** Pass 1: read file and store with empty outgoingLinks placeholder. */
  private async cacheFilePass1(
    relativePath: string,
    fullPath: string,
    existingStat?: Awaited<ReturnType<typeof stat>>,
  ): Promise<void> {
    try {
      const content = await readFile(fullPath, 'utf-8');
      const fileStat = existingStat ?? await stat(fullPath);
      const parsed = matter(content);

      this.entries.set(relativePath, {
        content: parsed.content,
        frontmatter: parsed.data,
        mtime: fileStat.mtime.getTime(),
        outgoingLinks: [],  // resolved in pass 2
      });
    } catch {
      // Skip files that can't be read
    }
  }

  /** Pass 2: resolve links for an already-cached entry. */
  private resolveLinksForEntry(relativePath: string): void {
    const entry = this.entries.get(relativePath);
    if (!entry) return;
    entry.outgoingLinks = this.parseAndResolveLinks(entry.content, relativePath);
  }

  private parseAndResolveLinks(content: string, sourcePath: string): string[] {
    const links: string[] = [];
    const seen = new Set<string>();

    // Match [[wikilinks]] (with optional alias [[target|alias]])
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const target = this.resolveLink(match[1]!, sourcePath);
      if (target && !seen.has(target)) {
        seen.add(target);
        links.push(target);
      }
    }

    // Match [text](link.md) markdown links (only .md files, not external URLs)
    const mdLinkRegex = /\[([^\]]*)\]\((?!https?:\/\/)([^)]+\.md)\)/g;
    while ((match = mdLinkRegex.exec(content)) !== null) {
      const target = this.resolveLink(match[2]!, sourcePath);
      if (target && !seen.has(target)) {
        seen.add(target);
        links.push(target);
      }
    }

    return links;
  }

  private resolveLink(link: string, sourcePath: string): string | null {
    // Strip heading/block references and .md extension if present, then add it back
    const cleanLink = link.replace(/#.*$/, '').replace(/\.md$/, '');

    // Try exact path match first
    const withMd = cleanLink + '.md';
    if (this.entries.has(withMd)) return withMd;

    // Try relative to source directory
    const sourceDir = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
    const relativePath = sourceDir ? `${sourceDir}/${withMd}` : withMd;
    if (this.entries.has(relativePath)) return relativePath;

    // Try finding by filename anywhere in vault
    for (const path of this.entries.keys()) {
      const filename = path.split('/').pop()?.replace(/\.md$/, '');
      if (filename === cleanLink) return path;
    }

    return null;
  }

  private rebuildLinkIndex(): void {
    const outgoing = new Map<string, string[]>();
    const backlinks = new Map<string, string[]>();

    for (const [path, entry] of this.entries) {
      outgoing.set(path, entry.outgoingLinks);
      for (const target of entry.outgoingLinks) {
        const existing = backlinks.get(target) || [];
        if (!existing.includes(path)) {
          existing.push(path);
          backlinks.set(target, existing);
        }
      }
    }

    this.linkIndex = { outgoing, backlinks };
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.name.startsWith('.')) continue; // Skip dotfiles/dirs
        if (entry.isDirectory()) {
          files.push(...await this.findMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
    return files;
  }
}
