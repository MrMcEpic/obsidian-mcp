import { describe, it, expect, vi } from 'vitest';
import { VaultAccess } from './vault-access.js';
import { FileSystemService } from './filesystem.js';
import { RestApiService } from './rest-api.js';

describe('VaultAccess', () => {
  it('should use filesystem when no REST API configured', async () => {
    const fs = { readNote: vi.fn().mockResolvedValue({ frontmatter: {}, content: 'test', originalContent: 'test' }) } as any;
    const vault = new VaultAccess(fs, null);
    const result = await vault.readNote('test.md');
    expect(result.content).toBe('test');
    expect(fs.readNote).toHaveBeenCalledWith('test.md');
  });

  it('should fall back to filesystem when REST API fails', async () => {
    const fs = { readNote: vi.fn().mockResolvedValue({ frontmatter: {}, content: 'fs-content', originalContent: 'fs-content' }) } as any;
    const api = { readNote: vi.fn().mockRejectedValue(new Error('connection refused')), isAvailable: vi.fn().mockResolvedValue(false) } as any;
    const vault = new VaultAccess(fs, api);
    const result = await vault.readNote('test.md');
    expect(result.content).toBe('fs-content');
  });
});
