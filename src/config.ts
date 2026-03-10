// src/config.ts
export interface AppConfig {
  vaultPath: string;
  apiKey?: string;
  apiPort: number;
  cacheInterval: number; // minutes, 0 = disabled
}

export function loadConfig(): AppConfig {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH || process.argv.slice(2).join(' ').trim() || process.cwd();
  const apiKey = process.env.OBSIDIAN_API_KEY || undefined;
  const apiPort = parseInt(process.env.OBSIDIAN_API_PORT || '27124', 10);
  const cacheInterval = parseInt(process.env.OBSIDIAN_CACHE_INTERVAL || '10', 10);

  if (!vaultPath) {
    throw new Error('OBSIDIAN_VAULT_PATH environment variable or vault path argument is required');
  }

  return { vaultPath, ...(apiKey !== undefined ? { apiKey } : {}), apiPort, cacheInterval };
}
