import type { ToolHandler } from './types.js';
import { success, error } from './types.js';
import { generateObsidianUri } from '../uri.js';

export const definitions = [
  {
    name: 'read_note',
    description: 'Read the content of a note including frontmatter',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note relative to vault root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_multiple_notes',
    description: 'Read multiple notes at once',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Array of note paths' },
        includeContent: { type: 'boolean', default: true },
        includeFrontmatter: { type: 'boolean', default: true },
      },
      required: ['paths'],
    },
  },
  {
    name: 'write_note',
    description: 'Create or overwrite a note with content and optional frontmatter',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'Note content (markdown)' },
        frontmatter: { type: 'object', description: 'YAML frontmatter as key-value pairs' },
        mode: { type: 'string', enum: ['overwrite', 'append', 'prepend'], default: 'overwrite' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_note',
    description: 'Find and replace text in a note (supports regex, case-insensitive, whole-word)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        oldString: { type: 'string', description: 'Text to find (or regex pattern if useRegex=true)' },
        newString: { type: 'string', description: 'Replacement text' },
        replaceAll: { type: 'boolean', default: false },
        useRegex: { type: 'boolean', description: 'Treat oldString as regex', default: false },
        caseSensitive: { type: 'boolean', default: true },
        wholeWord: { type: 'boolean', description: 'Match whole words only', default: false },
      },
      required: ['path', 'oldString', 'newString'],
    },
  },
  {
    name: 'insert_at',
    description: 'Insert content at a specific heading or block ID position in a note',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note' },
        content: { type: 'string', description: 'Content to insert' },
        target: { type: 'string', description: "Heading text (e.g. '## Tasks') or block ID (e.g. '^block1')" },
        position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'], default: 'append' },
      },
      required: ['path', 'content', 'target'],
    },
  },
  {
    name: 'delete_note',
    description: 'Delete a note (requires confirmation via confirmPath)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the note to delete' },
        confirmPath: { type: 'string', description: 'Must match path exactly to confirm deletion' },
      },
      required: ['path', 'confirmPath'],
    },
  },
  {
    name: 'move_note',
    description: 'Move/rename a note (.md files only)',
    inputSchema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string' },
        newPath: { type: 'string' },
        overwrite: { type: 'boolean', default: false },
      },
      required: ['oldPath', 'newPath'],
    },
  },
  {
    name: 'move_file',
    description: 'Move/rename any file (requires double confirmation)',
    inputSchema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string' },
        newPath: { type: 'string' },
        confirmOldPath: { type: 'string' },
        confirmNewPath: { type: 'string' },
        overwrite: { type: 'boolean', default: false },
      },
      required: ['oldPath', 'newPath', 'confirmOldPath', 'confirmNewPath'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async read_note(args, ctx) {
    const { path } = args as { path: string };
    const note = await ctx.vaultAccess.readNote(path);
    return success({
      path,
      frontmatter: note.frontmatter,
      content: note.content,
      obsidianUri: generateObsidianUri(ctx.vaultPath, path),
    });
  },

  async read_multiple_notes(args, ctx) {
    const { paths, includeContent = true, includeFrontmatter = true } = args as {
      paths: string[]; includeContent?: boolean; includeFrontmatter?: boolean;
    };
    const results = await ctx.filesystem.readMultipleNotes({ paths, includeContent, includeFrontmatter });
    return success(results);
  },

  async write_note(args, ctx) {
    const { path, content, frontmatter, mode } = args as {
      path: string; content: string; frontmatter?: Record<string, unknown>; mode?: string;
    };
    await ctx.vaultAccess.writeNote({
      path,
      content,
      frontmatter: frontmatter as Record<string, any>,
      mode: (mode as 'overwrite' | 'append' | 'prepend') || 'overwrite',
    });
    const note = await ctx.vaultAccess.readNote(path);
    await ctx.cacheService.updateEntry(path, note.originalContent);
    return success({ path, message: `Note written successfully (${mode || 'overwrite'})` });
  },

  async patch_note(args, ctx) {
    const { path, oldString, newString, replaceAll, useRegex, caseSensitive = true, wholeWord = false } = args as {
      path: string; oldString: string; newString: string;
      replaceAll?: boolean; useRegex?: boolean; caseSensitive?: boolean; wholeWord?: boolean;
    };

    if (useRegex || !caseSensitive || wholeWord) {
      const note = await ctx.vaultAccess.readNote(path);
      const flags = (caseSensitive ? '' : 'i') + (replaceAll ? 'g' : '');
      const escaped = useRegex ? oldString : oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
      const original = note.originalContent;

      // Count matches before replacing (always use 'g' flag for counting)
      const countRegex = new RegExp(pattern, flags.replace('g', '') + 'g');
      const matchCount = (original.match(countRegex) || []).length;

      if (matchCount === 0) {
        return error(`No matches found for "${oldString}" in ${path}`);
      }

      if (!replaceAll && matchCount > 1) {
        return error(
          `Found ${matchCount} occurrences of the pattern. Use replaceAll=true to replace all, or provide a more specific pattern to match exactly one occurrence.`
        );
      }

      const regex = new RegExp(pattern, flags);
      const patched = original.replace(regex, newString);
      await ctx.vaultAccess.patchNote({ path, oldString: original, newString: patched });

      const updatedNote = await ctx.vaultAccess.readNote(path);
      await ctx.cacheService.updateEntry(path, updatedNote.originalContent);
      return success({ path, message: `Patched successfully (${replaceAll ? matchCount : 1} occurrence${matchCount > 1 ? 's' : ''})` });
    }

    const result = await ctx.vaultAccess.patchNote({ path, oldString, newString, replaceAll: replaceAll ?? false });
    if (!result.success) return error(result.message);

    const note = await ctx.vaultAccess.readNote(path);
    await ctx.cacheService.updateEntry(path, note.originalContent);
    return success(result);
  },

  async insert_at(args, ctx) {
    const { path, content, target, position = 'append' } = args as {
      path: string; content: string; target: string; position?: string;
    };
    const note = await ctx.vaultAccess.readNote(path);
    const fullContent = note.originalContent;
    const lines = fullContent.split('\n');

    let contentStartLine = 0;
    if (lines[0]?.trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') { contentStartLine = i + 1; break; }
      }
    }

    if (target.startsWith('^')) {
      const blockId = target;
      const lineIdx = lines.findIndex((l, i) => i >= contentStartLine && l.trimEnd().endsWith(blockId));
      if (lineIdx === -1) {
        const available = lines
          .filter(l => /\^[\w-]+$/.test(l.trimEnd()))
          .map(l => l.trimEnd().match(/(\^[\w-]+)$/)?.[1])
          .filter((x): x is string => x !== undefined);
        return error(`Block ID ${blockId} not found. Available: ${available.join(', ') || 'none'}`);
      }
      const insertIdx = position === 'before' ? lineIdx : lineIdx + 1;
      lines.splice(insertIdx, 0, content);
    } else {
      const targetClean = target.replace(/^#+\s*/, '').toLowerCase();
      const lineIdx = lines.findIndex((l, i) => {
        if (i < contentStartLine) return false;
        const match = l.match(/^(#{1,6})\s+(.+)/);
        return match !== null && match[2]!.trim().toLowerCase() === targetClean;
      });
      if (lineIdx === -1) return error(`Heading "${target}" not found in ${path}`);

      const headingLevel = lines[lineIdx]!.match(/^(#{1,6})/)?.[1]?.length ?? 1;

      if (position === 'before') {
        lines.splice(lineIdx, 0, content);
      } else if (position === 'after' || position === 'prepend') {
        lines.splice(lineIdx + 1, 0, content);
      } else {
        let endIdx = lines.length;
        for (let i = lineIdx + 1; i < lines.length; i++) {
          const nextHeading = lines[i]!.match(/^(#{1,6})\s/);
          if (nextHeading && nextHeading[1]!.length <= headingLevel) {
            endIdx = i;
            break;
          }
        }
        lines.splice(endIdx, 0, content);
      }
    }

    await ctx.vaultAccess.patchNote({ path, oldString: fullContent, newString: lines.join('\n') });
    await ctx.cacheService.updateEntry(path, lines.join('\n'));
    return success(`Inserted content at ${target} (${position}) in ${path}`);
  },

  async delete_note(args, ctx) {
    const { path, confirmPath } = args as { path: string; confirmPath: string };
    const result = await ctx.vaultAccess.deleteNote({ path, confirmPath });
    if (result.success) ctx.cacheService.removeEntry(path);
    return result.success ? success(result) : error(result.message);
  },

  async move_note(args, ctx) {
    const { oldPath, newPath, overwrite } = args as { oldPath: string; newPath: string; overwrite?: boolean };
    const moveNoteParams = overwrite !== undefined ? { oldPath, newPath, overwrite } : { oldPath, newPath };
    const result = await ctx.vaultAccess.moveNote(moveNoteParams);
    if (result.success) {
      ctx.cacheService.removeEntry(oldPath);
      const note = await ctx.vaultAccess.readNote(newPath);
      await ctx.cacheService.updateEntry(newPath, note.originalContent);
    }
    return result.success ? success(result) : error(result.message);
  },

  async move_file(args, ctx) {
    const { oldPath, newPath, confirmOldPath, confirmNewPath, overwrite } = args as {
      oldPath: string; newPath: string; confirmOldPath: string; confirmNewPath: string; overwrite?: boolean;
    };
    const moveFileParams = overwrite !== undefined
      ? { oldPath, newPath, confirmOldPath, confirmNewPath, overwrite }
      : { oldPath, newPath, confirmOldPath, confirmNewPath };
    const result = await ctx.vaultAccess.moveFile(moveFileParams);
    return result.success ? success(result) : error(result.message);
  },
};
