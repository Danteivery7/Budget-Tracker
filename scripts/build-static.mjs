import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = process.cwd();
const out = join(root, 'dist');
const allowed = new Set(['.html', '.css', '.js', '.webmanifest', '.svg']);

await rm(out, { recursive:true, force:true });
await mkdir(out, { recursive:true });

for (const entry of await readdir(root, { withFileTypes:true })) {
  if (!entry.isFile()) continue;
  if (!allowed.has(extname(entry.name))) continue;
  await copyFile(join(root, entry.name), join(out, entry.name));
}

await copyFile(join(root, '_headers'), join(out, '_headers'));
await writeFile(join(out, '_routes.json'), `${JSON.stringify({ version:1, include:['/api/*'], exclude:[] }, null, 2)}\n`);
