import { cp, readdir, readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../integrations/paperlesspaper');
const target = process.argv[2];
if (!target || target.startsWith('--')) throw new Error('Usage: node scripts/sync-paperlesspaper-integration.mjs <paperlesspaper-integrations-directory> [--replace]');
const root = resolve(target);
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.name !== 'paperlesspaper-openintegrations') throw new Error('Target is not a paperlesspaper-integrations checkout.');
const destination = join(root, 'applications/open-inventory');
if (destination === source) throw new Error('Source and destination must differ.');
async function files(path, prefix = '') {
  const entries = await readdir(join(path, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(path, join(prefix, entry.name)) : join(prefix, entry.name)))).flat();
}
if (!process.argv.includes('--replace')) {
  for (const file of await files(source)) {
    try {
      const existing = await readFile(join(destination, file));
      if (!existing.equals(await readFile(join(source, file)))) throw new Error(`Different target file: ${file}. Review it, then use --replace to update.`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await stat(join(root, 'server/index.js'));
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Integration copied to ${destination}`);
