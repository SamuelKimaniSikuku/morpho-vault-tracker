import { build } from 'vite';
import { readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'extension'), out = resolve(root, 'dist-extension');
await build({ configFile: false, root: source, base: './', publicDir: false,
  build: { outDir: out, emptyOutDir: true, target: 'chrome120', modulePreload: { polyfill: false },
    rolldownOptions: { input: { popup: resolve(source, 'popup.html'), background: resolve(source, 'background.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } } },
});
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp(resolve(source, 'icons'), resolve(out, 'icons'), { recursive: true });
await cp(resolve(source, 'privacy.html'), resolve(out, 'privacy.html'));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path); else files.push(relative(out, path));
  }
}
await walk(out);
for (const required of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
  if (!files.includes(required)) throw new Error(`Package is missing ${required}`);
}
// Fixed archive timestamps make the release reproducible. Python is only
// needed to create the ZIP; the loadable folder is built by Vite above.
const archive = resolve(root, `vaultwatch-extension-${manifest.version}.zip`);
execFileSync('python3', ['-c', `import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file():
   info=zipfile.ZipInfo(p.relative_to(root).as_posix(),(2026,1,1,0,0,0))
   info.compress_type=zipfile.ZIP_DEFLATED
   info.external_attr=0o644 << 16
   z.writestr(info,p.read_bytes())
`, out, archive]);
console.log(`Built ${archive} (${files.length} packaged files).`);
