import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

// banking.js predates the hosting migration. Keep its behavior intact while ensuring
// the production Pages bundle never instructs the owner to configure Netlify.
const bankingPath = join(out, 'banking.js');
let banking = await readFile(bankingPath, 'utf8');
banking = banking
  .replace('until the required secrets exist in Netlify.', 'until the required Cloudflare secrets and D1 binding are configured.')
  .replace('Add the values directly in Netlify environment variables, then redeploy.', 'Add the encrypted values in Cloudflare Pages → Settings → Variables and Secrets, bind D1 as DB, then redeploy.');
await writeFile(bankingPath, banking);

await copyFile(join(root, '_headers'), join(out, '_headers'));
await writeFile(join(out, '_routes.json'), `${JSON.stringify({ version:1, include:['/api/*'], exclude:[] }, null, 2)}\n`);
