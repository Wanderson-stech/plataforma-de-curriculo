import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const project = new URL('../', import.meta.url);
const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: fileURLToPath(project), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const { default: worker } = await import('../dist/server/index.js');
const directory = new URL('.radar-local/', project);
await mkdir(directory, { recursive: true });
const database = new DatabaseSync(fileURLToPath(new URL('workspace.sqlite', directory)));
for (const migration of ['0000_workspace.sql', '0001_job_discovery.sql']) {
  database.exec(await readFile(new URL('drizzle/' + migration, project), 'utf8'));
}

const DB = {
  prepare(sql) {
    const statement = database.prepare(sql);
    return {
      all: () => ({ results: statement.all() }),
      bind(...parameters) {
        return {
          first: () => statement.get(...parameters),
          run: () => ({ meta: statement.run(...parameters) })
        };
      }
    };
  }
};

const port = Number(process.env.PORT ?? 4173);
const origin = 'http://127.0.0.1:' + port;
createServer(async (input, output) => {
  try {
    const headers = new Headers(input.headers);
    // The unattended endpoint is for the production owner's private Site.
    headers.set('oai-authenticated-user-id', 'radar-local');
    const method = input.method;
    const body = ['GET', 'HEAD'].includes(method) ? undefined : input;
    const url = new URL(input.url, origin);
    if (url.origin !== origin) {
      output.writeHead(400).end();
      return;
    }
    const response = await worker.fetch(new Request(url, { method, headers, body, duplex: 'half' }), { DB });
    output.writeHead(response.status, Object.fromEntries(response.headers));
    output.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    output.writeHead(500).end('Erro ao carregar o Radar.');
  }
}).listen(port, '127.0.0.1', () => console.log('Radar disponível em ' + origin));
