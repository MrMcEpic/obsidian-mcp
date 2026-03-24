import { join, resolve, relative, dirname, basename } from 'path';
import { readdir, stat, readFile, writeFile, unlink, mkdir, access, rename, copyFile, rmdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { FrontmatterHandler } from '../frontmatter.js';
import { PathFilter } from '../pathfilter.js';
import { generateObsidianUri } from '../uri.js';
import type { ParsedNote, DirectoryListing, NoteWriteParams, DeleteNoteParams, DeleteResult, MoveNoteParams, MoveFileParams, MoveResult, BatchReadParams, BatchReadResult, UpdateFrontmatterParams, NoteInfo, TagManagementParams, TagManagementResult, PatchNoteParams, PatchNoteResult, VaultStats, ManageFolderParams, ManageFolderResult, VaultStructureNode, TagInfo } from '../types.js';

/** Matches inline #hashtags: must start with a letter, supports nested tags (e.g. #project/work) */
const INLINE_TAG_REGEX = /#[a-zA-Z][a-zA-Z0-9_/-]*/g;

export class FileSystemService {
  private frontmatterHandler: FrontmatterHandler;
  private pathFilter: PathFilter;
  private _realVaultPath: string | null = null;

  constructor(
    private vaultPath: string,
    pathFilter?: PathFilter,
    frontmatterHandler?: FrontmatterHandler
  ) {
    this.vaultPath = resolve(vaultPath);
    this.pathFilter = pathFilter || new PathFilter();
    this.frontmatterHandler = frontmatterHandler || new FrontmatterHandler();
  }

  private async getRealVaultPath(): Promise<string> {
    if (!this._realVaultPath) {
      this._realVaultPath = await realpath(this.vaultPath);
    }
    return this._realVaultPath;
  }

  private isWithinBoundary(childPath: string, parentPath: string): boolean {
    const normalizedChild = childPath.replace(/\\/g, '/');
    const normalizedParent = parentPath.replace(/\\/g, '/');
    const rel = relative(parentPath, childPath);
    return !rel.startsWith('..') &&
      (normalizedChild.startsWith(normalizedParent + '/') || normalizedChild === normalizedParent);
  }

  // Two-phase path resolution: lexical boundary check, then symlink resolution + re-check
  private async resolvePath(relativePath: string): Promise<string> {
    if (!relativePath) {
      relativePath = '';
    }
    relativePath = relativePath.trim();
    const normalizedPath = relativePath.startsWith('/')
      ? relativePath.slice(1)
      : relativePath;
    const fullPath = resolve(join(this.vaultPath, normalizedPath));

    // Phase 1: Lexical boundary check (before symlink resolution)
    if (!this.isWithinBoundary(fullPath, this.vaultPath)) {
      throw new Error(`Path traversal not allowed: ${relativePath}. Paths must be within the vault directory.`);
    }

    // Phase 2: Resolve symlinks and re-check boundary
    try {
      const realFullPath = await realpath(fullPath);
      const realVaultPath = await this.getRealVaultPath();
      if (!this.isWithinBoundary(realFullPath, realVaultPath)) {
        throw new Error(`Symlink target is outside the vault: ${relativePath}. Symlinks must resolve to paths within the vault directory.`);
      }
      return realFullPath;
    } catch (error: any) {
      if (error.message?.includes('Symlink target')) throw error;
      if (error.code === 'ELOOP') {
        throw new Error(`Circular symlink detected: ${relativePath}. The path contains a symlink loop.`);
      }
      if (error.code === 'ENOENT') {
        // File doesn't exist yet — resolve parent directory to check for symlink escapes
        const parentDir = dirname(fullPath);
        try {
          const realParent = await realpath(parentDir);
          const realVaultPath = await this.getRealVaultPath();
          if (!this.isWithinBoundary(realParent, realVaultPath)) {
            throw new Error(`Symlink target is outside the vault: ${relativePath}. Symlinks must resolve to paths within the vault directory.`);
          }
          return join(realParent, basename(fullPath));
        } catch (parentError: any) {
          if (parentError.message?.includes('Symlink target')) throw parentError;
          // Parent also doesn't exist (deeply nested new path) — lexical check already passed
          return fullPath;
        }
      }
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied: ${relativePath}. Cannot resolve symlink due to filesystem permissions.`);
      }
      throw error;
    }
  }

  async readNote(path: string): Promise<ParsedNote> {
    const fullPath = await this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    // Check if the path is a directory first
    const isDir = await this.isDirectory(path);
    if (isDir) {
      throw new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`);
    }

    try {
      const content = await readFile(fullPath, 'utf-8');
      return this.frontmatterHandler.parse(content);
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          throw new Error(`File not found: ${path}. Use list_directory to see available files, or check the path spelling.`);
        }
        if (error.code === 'EACCES') {
          throw new Error(`Permission denied: ${path}. The file exists but cannot be read due to filesystem permissions.`);
        }
        if (error.code === 'EISDIR') {
          throw new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`);
        }
      }
      throw new Error(`Failed to read file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async writeNote(params: NoteWriteParams): Promise<void> {
    const { path, content, frontmatter, mode = 'overwrite' } = params;
    const fullPath = await this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    // Validate content is a defined string to prevent writing literal "undefined"
    if (content === undefined || content === null) {
      throw new Error(`Content is required for writing a note: ${path}. The content parameter must be a string.`);
    }

    // Validate frontmatter if provided
    if (frontmatter) {
      const validation = this.frontmatterHandler.validate(frontmatter);
      if (!validation.isValid) {
        throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
      }
    }

    try {
      let finalContent: string;

      if (mode === 'overwrite') {
        finalContent = frontmatter
          ? this.frontmatterHandler.stringify(frontmatter, content)
          : content;
      } else {
        // For append/prepend, read existing content (or treat as overwrite if file doesn't exist)
        let existingNote: ParsedNote | undefined;
        try {
          existingNote = await this.readNote(path);
        } catch {
          // File doesn't exist — fall through to overwrite
        }

        if (existingNote) {
          const mergedFrontmatter = frontmatter
            ? { ...existingNote.frontmatter, ...frontmatter }
            : existingNote.frontmatter;

          const body = mode === 'append'
            ? existingNote.content + content
            : content + existingNote.content;

          finalContent = this.frontmatterHandler.stringify(mergedFrontmatter, body);
        } else {
          finalContent = frontmatter
            ? this.frontmatterHandler.stringify(frontmatter, content)
            : content;
        }
      }

      // Create directories if they don't exist
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, finalContent!, 'utf-8');
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw new Error(`Permission denied: ${path}`);
        }
        if (error.message.includes('space') || error.message.includes('ENOSPC')) {
          throw new Error(`No space left on device: ${path}`);
        }
      }
      throw new Error(`Failed to write file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async patchNote(params: PatchNoteParams): Promise<PatchNoteResult> {
    const { path, oldString, newString, replaceAll = false } = params;

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        path,
        message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    // Validate that strings are not empty
    if (!oldString || oldString.trim() === '') {
      return {
        success: false,
        path,
        message: 'oldString cannot be empty'
      };
    }

    // Validate newString is not null/undefined (empty string is valid for deletion)
    if (newString == null) {
      return {
        success: false,
        path,
        message: 'newString is required'
      };
    }

    // Validate that oldString and newString are different
    if (oldString === newString) {
      return {
        success: false,
        path,
        message: 'oldString and newString must be different'
      };
    }

    try {
      // Read the existing note
      const note = await this.readNote(path);

      // Get the full content with frontmatter
      const fullContent = note.originalContent;

      // Count occurrences of oldString
      const occurrences = fullContent.split(oldString).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          path,
          message: `String not found in note: "${oldString.substring(0, 50)}${oldString.length > 50 ? '...' : ''}"`,
          matchCount: 0
        };
      }

      // If not replaceAll and multiple occurrences exist, fail
      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          path,
          message: `Found ${occurrences} occurrences of the string. Use replaceAll=true to replace all occurrences, or provide a more specific string to match exactly one occurrence.`,
          matchCount: occurrences
        };
      }

      // Perform the replacement
      const updatedContent = replaceAll
        ? fullContent.split(oldString).join(newString)
        : fullContent.replace(oldString, newString);

      // Write the updated content
      const fullPath = await this.resolvePath(path);
      await writeFile(fullPath, updatedContent, 'utf-8');

      return {
        success: true,
        path,
        message: `Successfully replaced ${replaceAll ? occurrences : 1} occurrence${occurrences > 1 ? 's' : ''}`,
        matchCount: occurrences
      };

    } catch (error) {
      return {
        success: false,
        path,
        message: `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async listDirectory(path: string = ''): Promise<DirectoryListing> {
    // Normalize path: treat '.' as root directory
    const normalizedPath = path === '.' ? '' : path;
    const fullPath = await this.resolvePath(normalizedPath);

    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      const files: string[] = [];
      const directories: string[] = [];

      for (const entry of entries) {
        const entryPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;

        if (!this.pathFilter.isAllowedForListing(entryPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          directories.push(entry.name);
        } else if (entry.isFile()) {
          files.push(entry.name);
        }
        // Skip other types (symlinks, etc.)
      }

      return {
        files: files.sort(),
        directories: directories.sort()
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('ENOENT')) {
          throw new Error(`Directory not found: ${path}. Use list_directory with no path or '/' to see root folders.`);
        }
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw new Error(`Permission denied: ${path}. The directory exists but cannot be read due to filesystem permissions.`);
        }
        if (error.message.includes('not a directory') || error.message.includes('ENOTDIR')) {
          throw new Error(`Not a directory: ${path}. This path points to a file, not a folder. Use read_note to read files.`);
        }
      }
      throw new Error(`Failed to list directory: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = await this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }

    try {
      await access(fullPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    const fullPath = await this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }

    try {
      const stats = await stat(fullPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async deleteNote(params: DeleteNoteParams): Promise<DeleteResult> {
    const { path, confirmPath } = params;

    // Confirmation check - paths must match exactly
    if (path !== confirmPath) {
      return {
        success: false,
        path: path,
        message: "Deletion cancelled: confirmation path does not match. For safety, both 'path' and 'confirmPath' must be identical."
      };
    }

    const fullPath = await this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        path: path,
        message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    try {
      // Check if it's a directory first (can't delete directories with this method)
      const isDir = await this.isDirectory(path);
      if (isDir) {
        return {
          success: false,
          path: path,
          message: `Cannot delete: ${path} is not a file`
        };
      }

      // Perform the deletion using Node.js native API
      await unlink(fullPath);

      return {
        success: true,
        path: path,
        message: `Successfully deleted note: ${path}. This action cannot be undone.`
      };

    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          return {
            success: false,
            path: path,
            message: `File not found: ${path}. Use list_directory to see available files.`
          };
        }
        if (error.code === 'EACCES') {
          return {
            success: false,
            path: path,
            message: `Permission denied: ${path}. The file exists but cannot be deleted due to filesystem permissions.`
          };
        }
      }
      return {
        success: false,
        path: path,
        message: `Failed to delete file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async moveNote(params: MoveNoteParams): Promise<MoveResult> {
    const { oldPath, newPath, overwrite = false } = params;

    if (!this.pathFilter.isAllowed(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${oldPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    if (!this.pathFilter.isAllowed(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${newPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    const oldFullPath = await this.resolvePath(oldPath);
    const newFullPath = await this.resolvePath(newPath);

    try {
      // Read source content (will throw ENOENT if not found)
      let content: string;
      try {
        content = await readFile(oldFullPath, 'utf-8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return {
            success: false,
            oldPath,
            newPath,
            message: `Source file not found: ${oldPath}. Use list_directory to see available files.`
          };
        }
        throw error;
      }

      // Create directories if needed
      await mkdir(dirname(newFullPath), { recursive: true });

      // Write to new location, checking for existing file atomically if !overwrite
      try {
        if (overwrite) {
          await writeFile(newFullPath, content, 'utf-8');
        } else {
          // wx flag: write exclusive - fails if file exists
          await writeFile(newFullPath, content, { encoding: 'utf-8', flag: 'wx' });
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          return {
            success: false,
            oldPath,
            newPath,
            message: `Target file already exists: ${newPath}. Use overwrite=true to replace it.`
          };
        }
        throw error;
      }

      // Delete the source file
      await unlink(oldFullPath);

      return {
        success: true,
        oldPath,
        newPath,
        message: `Successfully moved note from ${oldPath} to ${newPath}`
      };

    } catch (error) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to move note: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async moveFile(params: MoveFileParams): Promise<MoveResult> {
    const { oldPath, newPath, confirmOldPath, confirmNewPath, overwrite = false } = params;

    if (oldPath !== confirmOldPath || newPath !== confirmNewPath) {
      return {
        success: false,
        oldPath,
        newPath,
        message: "Move cancelled: confirmation paths do not match. For safety, oldPath must equal confirmOldPath and newPath must equal confirmNewPath."
      };
    }

    if (!this.pathFilter.isAllowedForListing(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${oldPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    if (!this.pathFilter.isAllowedForListing(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${newPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    const oldFullPath = await this.resolvePath(oldPath);
    const newFullPath = await this.resolvePath(newPath);

    try {
      const sourceStat = await stat(oldFullPath);
      if (sourceStat.isDirectory()) {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Source path is a directory: ${oldPath}. move_file currently supports files only.`
        };
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Source file not found: ${oldPath}. Use list_directory to see available files.`
        };
      }
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to inspect source file: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }

    try {
      if (!overwrite) {
        try {
          await access(newFullPath, constants.F_OK);
          return {
            success: false,
            oldPath,
            newPath,
            message: `Target file already exists: ${newPath}. Use overwrite=true to replace it.`
          };
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      await mkdir(dirname(newFullPath), { recursive: true });

      if (overwrite) {
        try {
          const targetStat = await stat(newFullPath);
          if (targetStat.isDirectory()) {
            return {
              success: false,
              oldPath,
              newPath,
              message: `Target path is a directory: ${newPath}. Please provide a file path.`
            };
          }
          await unlink(newFullPath);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      try {
        await rename(oldFullPath, newFullPath);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EXDEV') {
          await copyFile(oldFullPath, newFullPath);
          await unlink(oldFullPath);
        } else {
          throw error;
        }
      }

      return {
        success: true,
        oldPath,
        newPath,
        message: `Successfully moved file from ${oldPath} to ${newPath}`
      };
    } catch (error) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async readMultipleNotes(params: BatchReadParams): Promise<BatchReadResult> {
    const { paths, includeContent = true, includeFrontmatter = true } = params;

    if (paths.length > 10) {
      throw new Error('Maximum 10 files per batch read request');
    }

    const results = await Promise.allSettled(
      paths.map(async (path) => {
        if (!this.pathFilter.isAllowed(path)) {
          throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
        }

        const note = await this.readNote(path);
        const result: any = {
          path,
          obsidianUri: generateObsidianUri(this.vaultPath, path)
        };

        if (includeFrontmatter) {
          result.frontmatter = note.frontmatter;
        }

        if (includeContent) {
          result.content = note.content;
        }

        return result;
      })
    );

    const successful: Array<{ path: string; frontmatter?: Record<string, any>; content?: string; }> = [];
    const failed: Array<{ path: string; error: string; }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          path: paths[index] || '',
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        });
      }
    });

    return { successful, failed };
  }

  async updateFrontmatter(params: UpdateFrontmatterParams): Promise<void> {
    const { path, frontmatter, merge = true } = params;

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    // Read the existing note
    const note = await this.readNote(path);

    // Prepare new frontmatter
    const newFrontmatter = merge
      ? { ...note.frontmatter, ...frontmatter }
      : frontmatter;

    // Validate the new frontmatter
    const validation = this.frontmatterHandler.validate(newFrontmatter);
    if (!validation.isValid) {
      throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
    }

    // Update the note with new frontmatter, preserving content
    await this.writeNote({
      path,
      content: note.content,
      frontmatter: newFrontmatter
    });
  }

  async getNotesInfo(paths: string[]): Promise<NoteInfo[]> {
    const results = await Promise.allSettled(
      paths.map(async (path): Promise<NoteInfo> => {
        if (!this.pathFilter.isAllowed(path)) {
          throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
        }

        const fullPath = await this.resolvePath(path);

        let stats;
        try {
          stats = await stat(fullPath);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw new Error(`File not found: ${path}`);
          }
          throw error;
        }

        const size = stats.size;
        const lastModified = stats.mtime.getTime();

        // Quick check for frontmatter without reading full content
        const file = await readFile(fullPath, 'utf-8');
        const firstChunk = file.slice(0, 100);
        const hasFrontmatter = firstChunk.startsWith('---\n');

        return {
          path,
          size,
          modified: lastModified,
          hasFrontmatter,
          obsidianUri: generateObsidianUri(this.vaultPath, path)
        };
      })
    );

    // Return only successful results, filter out failed ones
    return results
      .filter((result): result is PromiseFulfilledResult<NoteInfo> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  async manageTags(params: TagManagementParams): Promise<TagManagementResult> {
    const { path, operation, tags = [] } = params;

    if (!this.pathFilter.isAllowed(path)) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    try {
      const note = await this.readNote(path);
      let currentTags: string[] = [];

      // Extract tags from frontmatter
      if (note.frontmatter.tags) {
        if (Array.isArray(note.frontmatter.tags)) {
          currentTags = note.frontmatter.tags;
        } else if (typeof note.frontmatter.tags === 'string') {
          currentTags = [note.frontmatter.tags];
        }
      }

      // Also extract inline tags from content (must start with letter, supports nested tags with /)
      const inlineTagMatches = note.content.match(INLINE_TAG_REGEX) || [];
      const inlineTags = inlineTagMatches.map(tag => tag.slice(1)); // Remove #
      currentTags = [...new Set([...currentTags, ...inlineTags])]; // Deduplicate

      if (operation === 'list') {
        return {
          path,
          operation,
          tags: currentTags,
          success: true
        };
      }

      let newTags = [...currentTags];

      if (operation === 'add') {
        for (const tag of tags) {
          if (!newTags.includes(tag)) {
            newTags.push(tag);
          }
        }
      } else if (operation === 'remove') {
        newTags = newTags.filter(tag => !tags.includes(tag));
      }

      // Update frontmatter with new tags
      const updatedFrontmatter: Record<string, any> = {
        ...note.frontmatter
      };

      if (newTags.length > 0) {
        updatedFrontmatter.tags = newTags;
      } else if ('tags' in updatedFrontmatter) {
        delete updatedFrontmatter.tags;
      }

      // Write back the note with updated frontmatter
      await this.writeNote({
        path,
        content: note.content,
        frontmatter: updatedFrontmatter,
        mode: 'overwrite'
      });

      return {
        path,
        operation,
        tags: newTags,
        success: true,
        message: `Successfully ${operation === 'add' ? 'added' : 'removed'} tags`
      };

    } catch (error) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async listAllTags(): Promise<TagInfo[]> {
    const tagCounts = new Map<string, number>();

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!this.pathFilter.isAllowedForListing(entryRelativePath)) continue;
          await scanDirectory(fullEntryPath, entryRelativePath);
        } else if (entry.isFile()) {
          if (!this.pathFilter.isAllowed(entryRelativePath)) continue;

          try {
            const content = await readFile(fullEntryPath, 'utf-8');
            const parsed = this.frontmatterHandler.parse(content);

            // Extract frontmatter tags
            if (parsed.frontmatter.tags) {
              const fmTags = Array.isArray(parsed.frontmatter.tags)
                ? parsed.frontmatter.tags
                : [parsed.frontmatter.tags];
              for (const tag of fmTags) {
                const t = String(tag).toLowerCase();
                tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
              }
            }

            // Extract inline #hashtags from content
            const inlineMatches = parsed.content.match(INLINE_TAG_REGEX) || [];
            for (const match of inlineMatches) {
              const t = match.slice(1).toLowerCase(); // Remove #
              tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
          } catch {
            // Skip files that can't be parsed
          }
        }
      }
    };

    await scanDirectory(this.vaultPath);

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  async manageFolder(params: ManageFolderParams): Promise<ManageFolderResult> {
    const { path, operation, newPath } = params;

    if (!this.pathFilter.isAllowedForListing(path)) {
      return { success: false, path, message: `Access denied: ${path}. This path is restricted.` };
    }
    if (newPath && !this.pathFilter.isAllowedForListing(newPath)) {
      return { success: false, path, message: `Access denied: ${newPath}. This path is restricted.` };
    }

    const fullPath = await this.resolvePath(path);

    switch (operation) {
      case 'create': {
        await mkdir(fullPath, { recursive: true });
        return { success: true, path, message: `Created folder: ${path}` };
      }
      case 'rename':
      case 'move': {
        if (!newPath) throw new Error('newPath is required for rename/move operation');
        const fullNewPath = await this.resolvePath(newPath);
        await mkdir(dirname(fullNewPath), { recursive: true });
        await rename(fullPath, fullNewPath);
        return { success: true, path: newPath, message: `${operation === 'move' ? 'Moved' : 'Renamed'} ${path} → ${newPath}` };
      }
      case 'delete': {
        try {
          await rmdir(fullPath);
          return { success: true, path, message: `Deleted folder: ${path}` };
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          return { success: false, path, message: `Failed to delete folder: ${msg}` };
        }
      }
      default:
        throw new Error(`Unknown folder operation: ${operation}`);
    }
  }

  async getVaultStructure(subPath: string = '', maxDepth: number = 3): Promise<VaultStructureNode> {
    const fullPath = subPath ? await this.resolvePath(subPath) : resolve(this.vaultPath);
    return this.buildTree(fullPath, basename(fullPath), 0, maxDepth);
  }

  private async buildTree(dirPath: string, name: string, depth: number, maxDepth: number): Promise<VaultStructureNode> {
    if (depth >= maxDepth) {
      return { name, type: 'directory' };
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    const children: VaultStructureNode[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relativePath = relative(this.vaultPath, join(dirPath, entry.name)).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!this.pathFilter.isAllowedForListing(relativePath)) continue;
        children.push(await this.buildTree(join(dirPath, entry.name), entry.name, depth + 1, maxDepth));
      } else if (entry.isFile()) {
        if (!this.pathFilter.isAllowed(relativePath)) continue;
        children.push({ name: entry.name, type: 'file' });
      }
    }

    return { name, type: 'directory', children };
  }

  async getVaultStats(recentCount: number = 5): Promise<VaultStats> {
    let totalNotes = 0;
    let totalFolders = 0;
    let totalSize = 0;
    const recentFiles: Array<{ path: string; modified: number }> = [];

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!this.pathFilter.isAllowedForListing(entryRelativePath)) {
            continue;
          }
          totalFolders++;
          await scanDirectory(fullEntryPath, entryRelativePath);
        } else if (entry.isFile()) {
          if (!this.pathFilter.isAllowed(entryRelativePath)) {
            continue;
          }

          totalNotes++;
          const stats = await stat(fullEntryPath);
          totalSize += stats.size;

          // Track recent files
          const fileInfo = { path: entryRelativePath, modified: stats.mtime.getTime() };

          // Insert in sorted order (most recent first)
          const insertIndex = recentFiles.findIndex(f => f.modified < fileInfo.modified);
          if (insertIndex === -1) {
            if (recentFiles.length < recentCount) {
              recentFiles.push(fileInfo);
            }
          } else {
            recentFiles.splice(insertIndex, 0, fileInfo);
            if (recentFiles.length > recentCount) {
              recentFiles.pop();
            }
          }
        }
      }
    };

    await scanDirectory(this.vaultPath);

    return {
      totalNotes,
      totalFolders,
      totalSize,
      recentlyModified: recentFiles
    };
  }
}
