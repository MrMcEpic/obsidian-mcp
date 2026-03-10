import { join, resolve } from 'path';
import { readFile, readdir } from 'node:fs/promises';
import type { PathFilter } from '../pathfilter.js';
import type { ExtendedSearchParams, RankCandidate, SearchParams, SearchResult } from '../types.js';
import { generateObsidianUri } from '../uri.js';

export class SearchService {
  private vaultPath: string;

  constructor(
    vaultPath: string,
    private pathFilter: PathFilter
  ) {
    this.vaultPath = resolve(vaultPath);
  }

  async search(params: SearchParams | ExtendedSearchParams): Promise<SearchResult[]> {
    const {
      query,
      limit = 5,
      searchContent = true,
      searchFrontmatter = false,
      caseSensitive = false
    } = params;

    if (!query || query.trim().length === 0) {
      throw new Error('Search query cannot be empty');
    }

    const maxLimit = Math.min(limit, 20);
    const extParams = params as ExtendedSearchParams;

    // Corpus stats for reranking
    let totalDocLength = 0;
    let docCount = 0;
    const termDocFreq = new Map<string, number>();
    const candidates: RankCandidate[] = [];
    const searchQuery = caseSensitive ? query : query.toLowerCase();
    // In regex mode, treat the whole query as a single scoring "term"
    const terms = extParams.useRegex ? [searchQuery] : searchQuery.split(/\s+/).filter(t => t.length > 0);
    const scoringTerms = (!extParams.useRegex && terms.length > 1) ? [...terms, searchQuery] : terms;

    // Recursively find all .md files
    const markdownFiles = await this.findMarkdownFiles(this.vaultPath);

    // Pre-filter by pathFilter before I/O
    const prefixLen = this.vaultPath.length + 1;
    let allowedFiles: { fullPath: string; relativePath: string }[] = [];
    for (const fullPath of markdownFiles) {
      const relativePath = fullPath.substring(prefixLen).replace(/\\/g, '/');
      if (this.pathFilter.isAllowed(relativePath)) {
        allowedFiles.push({ fullPath, relativePath });
      }
    }

    // Path filter (for ExtendedSearchParams)
    if (extParams.pathFilter) {
      const pattern = extParams.pathFilter;
      allowedFiles = allowedFiles.filter(f => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(f.relativePath);
        }
        return f.relativePath.startsWith(pattern);
      });
    }

    // Read files in parallel batches
    const BATCH_SIZE = 5;
    for (let start = 0; start < allowedFiles.length; start += BATCH_SIZE) {
      const batch = allowedFiles.slice(start, start + BATCH_SIZE);
      const contents = await Promise.all(
        batch.map(f => readFile(f.fullPath, 'utf-8').catch(() => null))
      );

      for (let i = 0; i < batch.length; i++) {
        const content = contents[i];
        if (content === null || content === undefined) continue;

        const { relativePath } = batch[i]!;
        let searchableText = '';

        // Prepare search text based on options
        if (searchContent && searchFrontmatter) {
          searchableText = content;
        } else if (searchContent) {
          // Remove frontmatter from search
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
          searchableText = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
        } else if (searchFrontmatter) {
          // Search only frontmatter
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
          searchableText = frontmatterMatch ? frontmatterMatch[1] || '' : '';
        }

        const searchIn = caseSensitive ? searchableText : searchableText.toLowerCase();

        // Collect corpus stats for reranking
        const docLength = searchIn.split(/\s+/).filter(w => w.length > 0).length;
        totalDocLength += docLength;
        docCount++;
        if (extParams.useRegex) {
          try {
            if (new RegExp(searchQuery, caseSensitive ? '' : 'i').test(searchIn)) {
              termDocFreq.set(searchQuery, (termDocFreq.get(searchQuery) || 0) + 1);
            }
          } catch { /* ignore invalid regex */ }
        } else {
          for (const term of scoringTerms) {
            if (searchIn.includes(term)) {
              termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
            }
          }
        }

        // Extract title from filename
        const title = relativePath.split('/').pop()?.replace(/\.md$/, '') || relativePath;

        // Check filename match (any term)
        const filenameToSearch = caseSensitive ? title : title.toLowerCase();
        const filenameMatch = extParams.useRegex
          ? (() => { try { return new RegExp(searchQuery, caseSensitive ? '' : 'i').test(title); } catch { return false; } })()
          : terms.some(term => filenameToSearch.includes(term));

        let firstIndex: number;
        let matchedTermLength: number;

        if (extParams.useRegex) {
          // Regex match: find first occurrence in searchIn
          try {
            const regexFlags = caseSensitive ? '' : 'i';
            const regexMatch = new RegExp(searchQuery, regexFlags).exec(searchIn);
            firstIndex = regexMatch ? regexMatch.index : -1;
            matchedTermLength = regexMatch ? regexMatch[0].length : 1;
          } catch {
            firstIndex = -1;
            matchedTermLength = 1;
          }
        } else {
          // Check content match (any term)
          const termIndices = terms.map(term => searchIn.indexOf(term));
          const anyTermFound = termIndices.some(idx => idx !== -1);
          firstIndex = anyTermFound
            ? Math.min(...termIndices.filter(idx => idx !== -1))
            : -1;
          // Find the matched term length for excerpt calculation
          const firstTermIdx = firstIndex !== -1 ? termIndices.indexOf(firstIndex) : -1;
          matchedTermLength = firstTermIdx !== -1 ? (terms[firstTermIdx]?.length ?? 1) : 1;
        }

        if (firstIndex !== -1 || filenameMatch) {
          let excerpt: string;
          let matchCount = 0;
          let lineNumber = 0;

          const termFreqs = new Map<string, number>();

          if (firstIndex !== -1) {
            // Extract excerpt around first content match
            const excerptStart = Math.max(0, firstIndex - 21);
            const excerptEnd = Math.min(searchableText.length, firstIndex + matchedTermLength + 21);
            excerpt = searchableText.slice(excerptStart, excerptEnd).trim();

            // Add ellipsis if excerpt is truncated
            if (excerptStart > 0) excerpt = '...' + excerpt;
            if (excerptEnd < searchableText.length) excerpt = excerpt + '...';

            if (extParams.useRegex) {
              // Count regex matches
              try {
                const countRegex = new RegExp(searchQuery, caseSensitive ? 'g' : 'gi');
                const allMatches = searchIn.match(countRegex);
                const count = allMatches ? allMatches.length : 0;
                termFreqs.set(searchQuery, count);
                matchCount += count;
              } catch {
                // ignore invalid regex for counting
              }
            } else {
              // Count total content matches across all terms
              for (const term of scoringTerms) {
                let count = 0;
                let searchIndex = 0;
                while ((searchIndex = searchIn.indexOf(term, searchIndex)) !== -1) {
                  count++;
                  searchIndex += term.length;
                }
                termFreqs.set(term, count);
                matchCount += count;
              }
            }

            // Find line number of first match
            const lines = searchableText.slice(0, firstIndex).split('\n');
            lineNumber = lines.length;
          } else {
            // Filename-only match: use beginning of content as excerpt
            excerpt = searchableText.slice(0, 50).trim();
            if (searchableText.length > 50) excerpt = excerpt + '...';
            matchCount = 0;
            lineNumber = 0;
          }

          // Add filename match to count
          if (filenameMatch) matchCount++;

          candidates.push({
            result: {
              p: relativePath,
              t: title,
              ex: excerpt,
              mc: matchCount,
              ln: lineNumber,
              uri: generateObsidianUri(this.vaultPath, relativePath)
            },
            termFreqs,
            docLength
          });
        }
      }
    }

    const offset = extParams.offset || 0;
    const scored = this.rerankScored(candidates, scoringTerms, termDocFreq, docCount, totalDocLength);
    return scored.slice(offset, offset + maxLimit).map(s => s.result);
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const markdownFiles: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findMarkdownFiles(fullPath);
          markdownFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          markdownFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }

    return markdownFiles;
  }

  private rerankScored(
    candidates: RankCandidate[],
    terms: string[],
    termDocFreq: Map<string, number>,
    docCount: number,
    totalDocLength: number,
  ): { score: number; result: SearchResult }[] {
    const avgdl = docCount > 0 ? totalDocLength / docCount : 1;
    const k1 = 1.2;
    const b = 0.75;

    const scored = candidates.map(c => {
      let score = 0;
      for (const term of terms) {
        const tf = c.termFreqs.get(term) || 0;
        const df = termDocFreq.get(term) || 0;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.docLength / avgdl));
      }
      return { score, result: c.result };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private rerank(
    candidates: RankCandidate[],
    terms: string[],
    termDocFreq: Map<string, number>,
    docCount: number,
    totalDocLength: number,
    maxLimit: number
  ): SearchResult[] {
    const scored = this.rerankScored(candidates, terms, termDocFreq, docCount, totalDocLength);
    return scored.slice(0, maxLimit).map(s => s.result);
  }
}