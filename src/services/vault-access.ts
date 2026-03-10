import type { FileSystemService } from './filesystem.js';
import type { RestApiService } from './rest-api.js';
import type { ParsedNote, NoteWriteParams, PatchNoteParams, PatchNoteResult, DeleteNoteParams, DeleteResult, MoveNoteParams, MoveFileParams, MoveResult, DirectoryListing } from '../types.js';
import { FrontmatterHandler } from '../frontmatter.js';

export class VaultAccess {
  private frontmatterHandler = new FrontmatterHandler();

  constructor(
    private filesystem: FileSystemService,
    private restApi: RestApiService | null,
  ) {}

  private async tryRestApi<T>(
    restCall: () => Promise<T>,
    fsCall: () => Promise<T>,
  ): Promise<T> {
    if (!this.restApi) return fsCall();

    try {
      return await restCall();
    } catch {
      return fsCall();
    }
  }

  async readNote(path: string): Promise<ParsedNote> {
    return this.tryRestApi(
      async () => {
        const response = await this.restApi!.readNote(path);
        return this.frontmatterHandler.parse(response.content);
      },
      () => this.filesystem.readNote(path),
    );
  }

  async writeNote(params: NoteWriteParams): Promise<void> {
    return this.tryRestApi(
      async () => {
        if (params.mode === 'append') {
          // REST API append endpoint adds to end of file.
          // If frontmatter is provided, we need to read-modify-write to merge it.
          if (params.frontmatter) {
            const existing = await this.restApi!.readNote(params.path).catch(() => null);
            const parsed = existing ? this.frontmatterHandler.parse(existing.content) : { frontmatter: {}, content: '' };
            const mergedFm = { ...parsed.frontmatter, ...params.frontmatter };
            const fullContent = this.frontmatterHandler.stringify(mergedFm, parsed.content + params.content);
            await this.restApi!.writeNote(params.path, fullContent);
          } else {
            await this.restApi!.appendNote(params.path, params.content);
          }
        } else if (params.mode === 'prepend') {
          // REST API has no prepend endpoint — read, parse, prepend, write back
          const existing = await this.restApi!.readNote(params.path).catch(() => null);
          const parsed = existing ? this.frontmatterHandler.parse(existing.content) : { frontmatter: {}, content: '' };
          const mergedFm = params.frontmatter ? { ...parsed.frontmatter, ...params.frontmatter } : parsed.frontmatter;
          const fullContent = this.frontmatterHandler.stringify(mergedFm, params.content + parsed.content);
          await this.restApi!.writeNote(params.path, fullContent);
        } else {
          // overwrite (default)
          const content = params.frontmatter
            ? this.frontmatterHandler.stringify(params.frontmatter, params.content)
            : params.content;
          await this.restApi!.writeNote(params.path, content);
        }
      },
      () => this.filesystem.writeNote(params),
    );
  }

  async patchNote(params: PatchNoteParams): Promise<PatchNoteResult> {
    // Always use filesystem for patch (needs exact string matching)
    return this.filesystem.patchNote(params);
  }

  async deleteNote(params: DeleteNoteParams): Promise<DeleteResult> {
    return this.tryRestApi(
      async () => {
        if (params.path !== params.confirmPath) {
          return { success: false, path: params.path, message: "Deletion cancelled: confirmation path does not match." };
        }
        await this.restApi!.deleteNote(params.path);
        return { success: true, path: params.path, message: `Successfully deleted: ${params.path}` };
      },
      () => this.filesystem.deleteNote(params),
    );
  }

  async listDirectory(path: string = ''): Promise<DirectoryListing> {
    // Always use filesystem — more reliable for directory listing
    return this.filesystem.listDirectory(path);
  }

  async moveNote(params: MoveNoteParams): Promise<MoveResult> {
    // Always use filesystem for move operations
    return this.filesystem.moveNote(params);
  }

  async moveFile(params: MoveFileParams): Promise<MoveResult> {
    return this.filesystem.moveFile(params);
  }

  // REST-only methods
  async getActiveNote(): Promise<ParsedNote> {
    if (!this.restApi) {
      throw new Error('Obsidian must be running with Local REST API plugin enabled. Set OBSIDIAN_API_KEY to use this feature.');
    }
    const response = await this.restApi.getActiveNote();
    return this.frontmatterHandler.parse(response.content);
  }

  async getPeriodicNote(period: string): Promise<ParsedNote> {
    if (!this.restApi) {
      throw new Error('Obsidian must be running with Local REST API plugin enabled. Set OBSIDIAN_API_KEY to use this feature.');
    }
    const response = await this.restApi.getPeriodicNote(period);
    return this.frontmatterHandler.parse(response.content);
  }

  // Expose filesystem for services that need direct access
  getFilesystem(): FileSystemService {
    return this.filesystem;
  }
}
