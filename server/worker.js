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
    if (pathname === '/api/discovery' || pathname === '/api/discovery/scheduled') {
      try {
        return await handleDiscovery(request, env.DB, pathname);
      } catch {
        return json({ error: 'A busca está temporariamente indisponível. Tente novamente em instantes.' }, 503);
      }
    }
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

const gupyEndpoint = 'https://candidates.mcp.api.gupy.io/mcp';
const modality = { Remoto: 'remote', 'Híbrido': 'hybrid', Presencial: 'on-site' };
const modalityLabels = { remote: 'Remoto', hybrid: 'Híbrido', 'on-site': 'Presencial' };
const contractLabels = {
  vacancy_type_effective: 'Efetivo', vacancy_type_internship: 'Estágio',
  vacancy_type_trainee: 'Trainee', vacancy_type_temporary: 'Temporário',
  vacancy_legal_entity: 'PJ', vacancy_type_autonomous: 'Autônomo'
};
const refreshInterval = 5 * 60_000;

function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function preferenceList(values, limit) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string').map(value => value.trim().slice(0, 100)).filter(Boolean))].slice(0, limit);
}

function searchPrefs(state) {
  const alerts = state?.alerts;
  if (!alerts?.active || !alerts.inApp) return null;
  const roles = preferenceList(alerts.roles, 6);
  if (!roles.length) return null;

  const profile = state.profile;
  const skills = preferenceList([profile.skills, ...profile.experiences.map(item => item.skills)]
    .filter(value => typeof value === 'string').flatMap(value => value.split(',')), 80);
  return {
    roles, skills,
    models: preferenceList(alerts.models, 3).filter(model => Object.hasOwn(modality, model)),
    levels: preferenceList(alerts.levels, 4),
    city: typeof alerts.city === 'string' ? alerts.city.trim().slice(0, 120) : '',
    minimum: Math.max(0, Math.min(100, Number(alerts.minimum) || 0))
  };
}

async function gupySearch(term, prefs) {
  const args = { term, limit: 18, sortBy: 'relevance', sortOrder: 'desc' };
  if (prefs.city) args.city = prefs.city;
  if (prefs.models.length) args.workplaceTypes = prefs.models.map(model => modality[model]).join(',');
  const response = await fetch(gupyEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26'
    },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_jobs', arguments: args } })
  });
  if (!response.ok) throw new Error('Gupy respondeu com status ' + response.status);
  const mediaType = response.headers.get('content-type') ?? '';
  let reply;
  if (mediaType.includes('text/event-stream')) {
    const events = (await response.text()).split(/\r?\n\r?\n/);
    for (const event of events) {
      const body = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim()).join('\n');
      if (!body) continue;
      const entry = JSON.parse(body);
      if (entry.id === 1) {
        reply = entry;
        break;
      }
    }
  } else {
    reply = await response.json();
  }
  const result = reply?.result;
  if (!result || result.isError) throw new Error('A busca da Gupy está indisponível');
  const item = result.content?.find(entry => entry.type === 'text');
  const record = result.structuredContent ?? (item ? JSON.parse(item.text) : null);
  const jobs = record?.data?.data;
  if (!Array.isArray(jobs)) throw new Error('A Gupy retornou um formato inesperado');
  return jobs;
}

function safeGupyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'gupy.io' || url.hostname.endsWith('.gupy.io')) ? url.href : '';
  } catch {
    return '';
  }
}

function jobWords(text) {
  return normalize(text).replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
}

function jobLevel(title, type) {
  const name = normalize(title);
  if (type === 'vacancy_type_internship' || /\bestagi[oa]/.test(name)) return 'Estágio';
  if (/\b(junior|jr)\b/.test(name)) return 'Júnior';
  if (/\b(pleno|pl)\b/.test(name)) return 'Pleno';
  if (/\b(senior|sr)\b/.test(name)) return 'Sênior';
  return '';
}

function toOpportunity(job, prefs, now) {
  const url = safeGupyUrl(job.jobUrl);
  const title = typeof job.name === 'string' ? job.name.trim() : '';
  if (!Number.isSafeInteger(job.id) || !url || !title) return null;
  const titleWords = new Set(jobWords(title).split(' '));
  if (!prefs.roles.some(role => {
    const term = jobWords(role);
    return term && term.split(' ').every(word => titleWords.has(word));
  })) return null;
  const deadline = typeof job.applicationDeadline === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(job.applicationDeadline) ? Date.parse(job.applicationDeadline + 'T23:59:59-03:00') : NaN;
  if (Number.isFinite(deadline) && deadline < now) return null;

  const model = modalityLabels[job.workplaceType] ?? '';
  const level = jobLevel(title, job.type);
  if ((prefs.models.length && !prefs.models.includes(model)) || (prefs.levels.length && !prefs.levels.includes(level))) return null;
  const text = String(job.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const searchable = ' ' + jobWords(title + ' ' + text) + ' ';
  const matches = prefs.skills.filter(skill => {
    const term = jobWords(skill);
    return term && searchable.includes(' ' + term + ' ');
  });
  const fit = prefs.skills.length && text ? Math.round(100 * matches.length / prefs.skills.length) : null;
  if ((fit ?? 0) < prefs.minimum) return null;
  const company = job.isConfidentialCareerPage ? 'Empresa confidencial' : String(job.careerPageName || 'Empresa não informada');
  return {
    id: 'gupy-' + job.id, title: title.slice(0, 240), company: company.slice(0, 240), url,
    source: 'Gupy', automatic: true, location: [job.city, job.state].filter(Boolean).join(', ').slice(0, 160),
    model, level, contract: contractLabels[job.type] ?? '',
    date: Date.parse(job.publishedDate) || now, deadline: Number.isFinite(deadline) ? deadline : null,
    description: text.length > 1400 ? text.slice(0, 1399) + '…' : text,
    skills: matches, fit
  };
}

const listDiscovery = (db, userId) => db.prepare(
  'SELECT criteria, checked_at, lock_until, jobs, seen FROM job_discovery WHERE user_id = ?'
).bind(userId).first();

function discoveryPayload(row) {
  return { checkedAt: row?.checked_at || null, jobs: row ? JSON.parse(row.jobs) : [] };
}

async function refreshDiscovery(db, userId, prefs) {
  const now = Date.now();
  const criteria = JSON.stringify(prefs);
  const lease = now + 75_000;
  const locked = await db.prepare(
    'INSERT INTO job_discovery (user_id, lock_until) VALUES (?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET lock_until = excluded.lock_until ' +
    'WHERE job_discovery.lock_until <= ? AND (job_discovery.criteria != ? OR job_discovery.checked_at <= ?)'
  ).bind(userId, lease, now, criteria, now - refreshInterval).run();
  const previous = await listDiscovery(db, userId);
  if (locked.meta.changes !== 1) return {
    ...discoveryPayload(previous), newJobs: [], status: previous?.lock_until > now ? 'busy' : 'cached'
  };

  try {
    const responses = await Promise.all(prefs.roles.map(term => gupySearch(term, prefs)));
    const byId = new Map();
    for (const jobs of responses) {
      for (const entry of jobs) {
        const match = toOpportunity(entry, prefs, now);
        if (match) byId.set(match.id, match);
      }
    }
    const jobs = [...byId.values()].sort((a, b) => b.date - a.date).slice(0, 72);
    const seen = new Set(previous ? JSON.parse(previous.seen) : []);
    const newJobs = jobs.filter(job => !seen.has(job.id));
    const history = [...new Set([...jobs.map(job => job.id), ...seen])].slice(0, 1200);
    await db.prepare(
      'UPDATE job_discovery SET criteria = ?, checked_at = ?, jobs = ?, seen = ?, lock_until = 0 WHERE user_id = ? AND lock_until = ?'
    ).bind(criteria, now, JSON.stringify(jobs), JSON.stringify(history), userId, lease).run();
    return { checkedAt: now, jobs, newJobs, status: 'ok' };
  } catch (error) {
    await db.prepare('UPDATE job_discovery SET lock_until = 0 WHERE user_id = ? AND lock_until = ?')
      .bind(userId, lease).run();
    throw error;
  }
}

function notificationJob(job) {
  return { title: job.title, company: job.company, model: job.model, url: job.url };
}

async function handleDiscovery(request, db, pathname) {
  if (!db) return json({ error: 'O Radar está temporariamente indisponível.' }, 503);
  if (pathname === '/api/discovery/scheduled') {
    if (request.method !== 'POST') return json({ error: 'Método indisponível.' }, 405);
    // Sites keeps this endpoint behind the owner-private gate. An unattended
    // bearer-authenticated call carries neither a browser Origin nor identity.
    if (request.headers.has('origin') || request.headers.has('oai-authenticated-user-id')) {
      return json({ error: 'Use a conexão privada da tarefa agendada.' }, 403);
    }
    const { results } = await db.prepare(
      "SELECT user_id, record FROM workspaces WHERE json_extract(record, '$.alerts.active') = 1 " +
      "AND json_extract(record, '$.alerts.inApp') = 1 LIMIT 10"
    ).all();
    const combined = { checked: 0, newCount: 0, failed: 0, newJobs: [] };
    for (const row of results) {
      try {
        const prefs = searchPrefs(JSON.parse(row.record));
        if (!prefs) continue;
        const update = await refreshDiscovery(db, row.user_id, prefs);
        if (update.status === 'busy') continue;
        combined.checked += 1;
        combined.newCount += update.newJobs.length;
        combined.newJobs.push(...update.newJobs.slice(0, 4).map(notificationJob));
      } catch {
        combined.failed += 1;
      }
    }
    combined.newJobs = combined.newJobs.slice(0, 4);
    return json(combined, combined.failed && !combined.checked ? 503 : 200);
  }

  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) return json({ error: 'Entre com sua conta para acessar o Radar.' }, 401);
  if (request.method === 'GET') return json(discoveryPayload(await listDiscovery(db, userId)));
  if (request.method !== 'POST') return json({ error: 'Método indisponível.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Origem inválida.' }, 403);
  const saved = await db.prepare('SELECT record FROM workspaces WHERE user_id = ?').bind(userId).first();
  const prefs = searchPrefs(saved ? JSON.parse(saved.record) : null);
  if (!prefs) return json({ error: 'Ative a busca e salve ao menos um cargo de interesse em Meus alertas.' }, 422);
  const update = await refreshDiscovery(db, userId, prefs);
  return json({ jobs: update.jobs, checkedAt: update.checkedAt, status: update.status, newCount: update.newJobs.length });
}
