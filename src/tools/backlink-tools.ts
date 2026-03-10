import type { ToolHandler } from './types.js';
import { success } from './types.js';

export const definitions = [
  {
    name: 'auto_backlink',
    description: 'Scan vault for note name mentions and optionally convert them to [[wikilinks]]',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: true },
        scope: { type: 'string', description: 'Folder path to limit scan scope' },
        minNameLength: { type: 'number', default: 3 },
        excludePaths: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async auto_backlink(args, ctx) {
    const { dryRun = true, scope, minNameLength = 3, excludePaths = [] } = args as any;
    await ctx.cacheService.waitForBuild();

    const entries = ctx.cacheService.getAllEntries();
    const noteNames = new Map<string, string>();

    for (const path of entries.keys()) {
      const name = path.split('/').pop()?.replace(/\.md$/, '') || '';
      if (name.length >= minNameLength) {
        noteNames.set(name, path);
      }
    }

    const suggestions: Array<{ file: string; matches: Array<{ noteName: string; line: number }> }> = [];
    let processedCount = 0;
    const MAX_NOTES = 1000;

    for (const [filePath, entry] of entries) {
      if (processedCount >= MAX_NOTES) break;
      if (scope && !filePath.startsWith(scope)) continue;
      if (excludePaths.some((p: string) => filePath.startsWith(p))) continue;

      const lines = entry.content.split('\n');
      const fileMatches: Array<{ noteName: string; line: number }> = [];
      let inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) continue;

        for (const [noteName, targetPath] of noteNames) {
          if (targetPath === filePath) continue;
          const escaped = noteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

          const matches = [...line.matchAll(regex)];
          for (const m of matches) {
            const idx = m.index!;
            const before = line.substring(0, idx);
            const lastOpen = before.lastIndexOf('[[');
            const lastClose = before.lastIndexOf(']]');
            if (lastOpen > lastClose) continue;
            const lastBracketOpen = before.lastIndexOf('[');
            const lastBracketClose = before.lastIndexOf(']');
            if (lastBracketOpen > lastBracketClose) continue;

            fileMatches.push({ noteName, line: i + 1 });

            if (!dryRun) {
              lines[i] = lines[i]!.substring(0, idx) + `[[${noteName}]]` + lines[i]!.substring(idx + m[0].length);
            }
            break;
          }
        }
      }

      if (fileMatches.length > 0) {
        suggestions.push({ file: filePath, matches: fileMatches });
        if (!dryRun) {
          await ctx.vaultAccess.writeNote({
            path: filePath, content: lines.join('\n'),
            frontmatter: entry.frontmatter, mode: 'overwrite',
          });
          const written = await ctx.vaultAccess.readNote(filePath);
          await ctx.cacheService.updateEntry(filePath, written.originalContent);
        }
      }

      processedCount++;
    }

    return success({
      dryRun,
      totalFilesScanned: processedCount,
      filesWithSuggestions: suggestions.length,
      suggestions: suggestions.slice(0, 50),
    });
  },
};
