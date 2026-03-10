// scripts/build-mcpb.js
import { build } from 'esbuild';
import { createWriteStream, readFileSync, writeFileSync, mkdirSync } from 'fs';
import archiver from 'archiver';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const mcpbDir = join(distDir, 'mcpb');

async function buildMcpb() {
  // 1. Bundle server with esbuild
  mkdirSync(join(mcpbDir, 'server'), { recursive: true });

  await build({
    entryPoints: [join(distDir, 'server.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(mcpbDir, 'server', 'mcp-bridge.cjs'),
    external: [],
    minify: false,
    sourcemap: false,
  });

  // 2. Copy manifest.json
  const manifest = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(mcpbDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 3. Generate tools.json from standalone definitions bundle (NOT the server bundle)
  await build({
    entryPoints: [join(distDir, 'tools', 'export-definitions.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(distDir, 'tools-definitions.cjs'),
    external: [],
    minify: false,
  });

  // Import definitions from standalone bundle (no server startup)
  const defsModule = await import('file://' + join(distDir, 'tools-definitions.cjs').replace(/\\/g, '/'));
  const toolDefinitions = defsModule.allToolDefinitions || defsModule.default?.allToolDefinitions;
  writeFileSync(
    join(mcpbDir, 'server', 'tools.json'),
    JSON.stringify(toolDefinitions, null, 2),
  );

  // 4. Create .mcpb zip
  const output = createWriteStream(join(distDir, 'obsidian-mcp.mcpb'));
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(mcpbDir, false);

  await archive.finalize();
  console.log('Built obsidian-mcp.mcpb');
}

buildMcpb().catch(console.error);
