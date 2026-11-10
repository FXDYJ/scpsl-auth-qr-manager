import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

await mkdir('public/vendor', { recursive: true });
await build({
  entryPoints: ['scripts/scanner-worker.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome101', 'firefox114', 'safari16.4'],
  outfile: 'public/vendor/scanner-worker.js',
  minify: true,
  legalComments: 'eof',
});
await copyFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'public/vendor/zxing_reader.wasm');
await copyFile('node_modules/zxing-wasm/LICENSE', 'public/vendor/ZXing-LICENSE.txt');

const template = await readFile('scripts/sw.js', 'utf8');
const revision = createHash('sha256').update(template);
for (const file of (await readdir('public', { recursive: true, withFileTypes: true }))
  .filter((file) => file.isFile() && file.name !== 'sw.js')
  .map((file) => file.parentPath + '/' + file.name).sort()) {
  revision.update(await readFile(file));
}
await writeFile('public/sw.js', template.replace('__APP_REVISION__', revision.digest('hex').slice(0, 16)));
