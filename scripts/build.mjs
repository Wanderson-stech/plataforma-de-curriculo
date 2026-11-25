import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/data.js': ['data.js', 'text/javascript; charset=utf-8'],
  '/legacy.js': ['legacy.js', 'text/javascript; charset=utf-8'],
  '/pdf.js': ['pdf.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/assets/radar.svg': ['assets/radar.svg', 'image/svg+xml'],
  '/assets/inter.woff2': ['assets/inter.woff2', 'font/woff2'],
  '/assets/inter-LICENSE': ['assets/inter-LICENSE', 'text/plain; charset=utf-8']
};
const files = await Promise.all(Object.entries(assets).map(async ([url, [path, type]]) => {
  const bytes = await readFile(new URL('web/' + path, project));
  return [url, { type, body: bytes.toString('base64') }];
}));
const worker = await readFile(new URL('server/worker.js', project), 'utf8');
const source = worker.replace('/* assets:build */ {}', JSON.stringify(Object.fromEntries(files)));
const output = new URL('dist/server/', project);
await mkdir(output, { recursive: true });
await writeFile(new URL('index.js', output), source);
console.log('Build do Radar concluído.');
