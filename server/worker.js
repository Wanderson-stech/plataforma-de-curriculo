const assets = /* assets:build */ {};
const maximumBytes = 900_000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function validWorkspace(value) {
  if (!value || typeof value !== 'object') return false;
  const { jobs, applications, profile, resumes, alerts } = value;
  return Array.isArray(jobs) &&
    jobs.every(job => job && typeof job.id === 'string' && typeof job.title === 'string' && Array.isArray(job.skills) && !job.demo) &&
    Array.isArray(applications) && applications.every(item => item && typeof item.id === 'string') &&
    profile && typeof profile === 'object' && typeof profile.name === 'string' &&
    Array.isArray(profile.experiences) && resumes && typeof resumes === 'object' &&
    alerts && typeof alerts === 'object' && Array.isArray(alerts.roles) &&
    Array.isArray(alerts.models) && Array.isArray(alerts.levels);
}

async function workspace(request, db) {
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) return json({ error: 'Entre com sua conta para acessar o Radar.' }, 401);
  if (!db) return json({ error: 'O armazenamento está temporariamente indisponível.' }, 503);
  const row = () => db.prepare('SELECT revision, record FROM workspaces WHERE user_id = ?').bind(userId).first();
  if (request.method === 'GET') {
    const saved = await row();
    return json({ revision: saved?.revision ?? 0, state: saved ? JSON.parse(saved.record) : null });
  }
  if (request.method !== 'PUT') return json({ error: 'Método indisponível.' }, 405);

  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Origem inválida.' }, 403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return json({ error: 'Formato inválido.' }, 415);
  }
  const match = request.headers.get('if-match')?.match(/^"(\d+)"$/);
  const revision = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(revision)) return json({ error: 'Versão de sincronização ausente.' }, 428);
  if (Number(request.headers.get('content-length')) > maximumBytes) return json({ error: 'O espaço atingiu o limite de armazenamento.' }, 413);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) return json({ error: 'O espaço atingiu o limite de armazenamento.' }, 413);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  if (!validWorkspace(value)) return json({ error: 'Dados inválidos.' }, 400);
  const record = JSON.stringify(value);

  const written = revision === 0
    ? await db.prepare('INSERT INTO workspaces (user_id, revision, record) VALUES (?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId, record).run()
    : await db.prepare('UPDATE workspaces SET record = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?').bind(record, userId, revision).run();
  if (written.meta.changes === 1) return json({ revision: revision + 1 });

  const current = await row();
  if (current?.record === record) return json({ revision: current.revision });
  return json({ error: 'Há uma versão mais recente em outra aba ou dispositivo.' }, 409);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/workspace') {
      try {
        return await workspace(request, env.DB);
      } catch {
        return json({ error: 'O armazenamento está temporariamente indisponível.' }, 503);
      }
    }

    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const path = pathname === '/index.html' ? '/' : pathname;
    if (!Object.hasOwn(assets, path)) return new Response('Página indisponível', { status: 404 });
    const asset = assets[path];
    const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.body), character => character.charCodeAt(0));
    return new Response(body, {
      headers: {
        'content-type': asset.type,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com"
      }
    });
  }
};
