const oldProfileDefaults = {
  "name": "98a89d455ed7ea21da71f0d47e981058cb066a87cb5319c2128d164935b2e395",
  "role": "6152606c7cca9754f90f5ab6aa0431f14fe0831e92b673d406afa201d8317603",
  "location": "9d1a775648850480f36c9968e84138ebd6aed5bdc705486e8e9034315dedccb9",
  "email": "3708404477634adfb49f1c39e51c4cb4405abac82a9b6ce4a33a7f0932f563fc",
  "portfolio": "b7329fd116189448f9e18478cf73559e357838672156f07751def8f875f8c6aa",
  "summary": "f98a0efeaf1a2d9f35699d6b71c6bacb0954140ecc7fafae89da927519dd3d73",
  "formation": "94ab5c3e497bdd58d4a4a2646247be905f07d14690cf3ca46c92d31596954825",
  "skills": "ea23186f61720f2ad5c60c15ba94f9e136403411099737cb5405db9923b355b9"
};
const oldAlertDefaults = {
  "active": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
  "roles": "11a1aa54ea0d16b61f6e8c44b84903a793cce2b6c548cfa282fa7bf211479876",
  "models": "774d0416c6c1843976903c9d897fafaa824e16f2e705da531492254b54b47757",
  "levels": "1754ae81591a3c7e9ab691d263e0fe47a8e1b69f69bf6d6a773538455620b530",
  "frequency": "391552c099c101b131feaf24c5795a6a15bc8ec82015424e0d2b4274a369a0bf",
  "minimum": "48449a14a4ff7d79bb7a1b6f3d488eba397c36ef25634c111b49baf362511afc",
  "inApp": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b"
};

async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function recoverWorkspace(empty) {
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem('radar-vagas-v1'));
  } catch {
    return null;
  }
  if (!legacy?.profile || !Array.isArray(legacy.jobs) || !Array.isArray(legacy.applications)) return null;

  const jobs = legacy.jobs.filter(job => job.demo !== true);
  const demoJobIds = new Set(legacy.jobs.filter(job => job.demo === true).map(job => job.id));
  const jobIds = new Set(jobs.map(job => job.id));
  empty.jobs = jobs;
  empty.applications = legacy.applications.filter(item => !demoJobIds.has(item.jobId) && !/^app-\d+$/.test(item.id));
  empty.resumeId = jobIds.has(legacy.resumeId) ? legacy.resumeId : null;
  // An old résumé revision may contain text copied from the example profile.
  // Rebuild it from the recovered profile before the next export.
  empty.profile.experiences = (legacy.profile.experiences ?? []).filter(item => !['xp-1', 'xp-2'].includes(item.id));

  let hasRecords = Boolean(jobs.length || empty.applications.length || empty.profile.experiences.length);
  for (const name of Object.keys(empty.profile).filter(key => key !== 'experiences')) {
    const value = legacy.profile[name];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (await fingerprint(value) === oldProfileDefaults[name]) continue;
    empty.profile[name] = value;
    hasRecords = true;
  }

  for (const name of ['roles', 'models', 'levels', 'minimum', 'inApp']) {
    const value = legacy.alerts?.[name];
    if (typeof value === typeof empty.alerts[name] && await fingerprint(value) !== oldAlertDefaults[name]) {
      empty.alerts[name] = value;
      hasRecords = true;
    }
  }
  if (hasRecords && legacy.alerts?.active && empty.alerts.roles.length) empty.alerts.active = true;
  return hasRecords ? empty : null;
}
