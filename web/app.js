import { initialData, levels, models, stages } from './data.js';
import { createPdf } from './pdf.js';
import { recoverWorkspace } from './legacy.js';

const content = document.querySelector('main');
const navigation = document.querySelector('#main-nav');
const menu = document.querySelector('#menu-toggle');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const syncStatus = document.querySelector('#sync-status');

const sections = {
  'visao-geral': 'Visão geral', vagas: 'Explorar vagas', candidaturas: 'Candidaturas',
  curriculos: 'Currículos', perfil: 'Meu perfil', alertas: 'Meus alertas', configuracoes: 'Configurações'
};

const profileSections = {
  personal: ['Dados pessoais', [['name', 'Nome completo'], ['role', 'Cargo ou área profissional'], ['location', 'Localização'], ['email', 'E-mail'], ['portfolio', 'Portfólio'], ['summary', 'Resumo profissional', true]]],
  goal: ['Objetivos profissionais', [['goal', 'Cargos e áreas de interesse', true]]],
  experiences: ['Experiências'],
  projects: ['Projetos e resultados', [['projects', 'Projetos, resultados e evidências', true]]],
  skills: ['Competências', [['skills', 'Competências separadas por vírgula', true]]],
  formation: ['Formação', [['formation', 'Curso, instituição e período', true]]],
  certifications: ['Certificações', [['certifications', 'Certificações, instituições e datas', true]]],
  languages: ['Idiomas', [['languages', 'Idiomas e níveis comprovados', true]]],
  documents: ['Portfólio e documentos', [['portfolio', 'Link de portfólio'], ['documents', 'Links de documentos ou trabalhos', true]]]
};

const letters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => letters[character]);
const normalized = text => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const commaList = value => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
const lineList = value => String(value ?? '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const byId = (items, id) => items.find(item => item.id === id);
const findJob = id => byId(data.jobs, id);
const jobUrl = id => '#vagas/' + encodeURIComponent(id);
const newId = () => crypto.randomUUID();
const pageSize = 5;

let data = initialData();
let revision = 0;
let ready = false;
let saveQueue = Promise.resolve();
let writeConflict = false;
let route = 'visao-geral';
let profileTab = 'experiences';
let alertDraft;
let searchPage = 1;
let toastTimer;
let dialogAction;
let lastTrigger;
let draggedCard;
const filters = { query: '', source: '', level: '', model: '', minimum: '', order: 'recent' };

function persist({ announceErrors = true } = {}) {
  const payload = JSON.stringify(data);
  const save = saveQueue.then(async () => {
    if (!ready || writeConflict) return false;
    syncStatus.textContent = 'Salvando…';
    try {
      const response = await fetch('./api/workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': '"' + revision + '"' },
        body: payload
      });
      if (!response.ok) {
        if (response.status === 409) writeConflict = true;
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || 'O Radar não conseguiu salvar.');
      }
      revision = (await response.json()).revision;
      syncStatus.textContent = 'Salvo';
      return true;
    } catch (error) {
      syncStatus.textContent = 'Alterações pendentes';
      if (announceErrors) {
        message(writeConflict
          ? 'Os dados mudaram em outra aba. Baixe suas alterações em Configurações antes de recarregar.'
          : error.message + ' Você pode tentar novamente em Configurações.');
      }
      return false;
    }
  });
  saveQueue = save;
  return save;
}

function message(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function commit(text) {
  void persist().then(saved => { if (saved) message(text); });
}

function options(list, selected = '') {
  return list.map(entry => {
    const [value, label] = Array.isArray(entry) ? entry : [entry, entry];
    return `<option value="${escape(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${escape(label)}</option>`;
  }).join('');
}

function button(label, action, kind = 'primary', id = '') {
  return `<button type="button" class="${kind === 'link' ? 'link-button' : 'button ' + kind}" data-action="${action}"${id ? ' data-id="' + escape(id) + '"' : ''}>${escape(label)}</button>`;
}

function page(title, subtitle, action = '') {
  return `<div class="page-head"><div class="head-row"><h1>${escape(title)}</h1>${action}</div>${subtitle ? '<p>' + escape(subtitle) + '</p>' : ''}</div>`;
}

function tag(text) {
  return `<span class="tag">${escape(text)}</span>`;
}

function list(items, className = '') {
  return `<ul${className ? ' class="' + className + '"' : ''}>${items.map(item => '<li>' + escape(item) + '</li>').join('')}</ul>`;
}

function input(label, name, value = '', { type = 'text', required = false, wide = false, placeholder = '' } = {}) {
  const attrs = `name="${name}" ${required ? 'required' : ''} placeholder="${escape(placeholder)}"`;
  const field = type === 'textarea'
    ? `<textarea ${attrs} maxlength="5000">${escape(value)}</textarea>`
    : `<input ${attrs} type="${type}" value="${escape(value)}" maxlength="${type === 'url' ? '2048' : '240'}">`;
  return `<label class="field${wide ? ' wide' : ''}">${escape(label)}${field}</label>`;
}

function select(label, name, list, value) {
  return `<label class="field">${escape(label)}<select name="${name}">${options(list, value)}</select></label>`;
}

function progress(value, label) {
  return `<progress class="progress" value="${value}" max="100" aria-label="${escape(label)}">${value}%</progress>`;
}

function scoreJob(job) {
  if (!job.skills?.length || !profileSkills().size) return null;
  return Math.round(100 * matchedSkills(job).length / job.skills.length);
}

function profileSkills() {
  return new Set([
    ...commaList(data.profile.skills),
    ...data.profile.experiences.flatMap(item => commaList(item.skills))
  ].map(normalized));
}

function matchedSkills(job) {
  const known = profileSkills();
  return (job.skills ?? []).filter(item => known.has(normalized(item)));
}

function elapsed(date) {
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
  if (!minutes) return 'Agora';
  if (minutes < 60) return 'Há ' + minutes + ' min';
  if (minutes < 1440) return 'Há ' + Math.floor(minutes / 60) + ' h';
  return 'Há ' + Math.floor(minutes / 1440) + ' d';
}

function jobTable(jobs) {
  if (!jobs.length) {
    return data.jobs.length
      ? '<div class="panel empty">Nenhuma oportunidade encontrada.</div>'
      : `<div class="panel empty"><p>Seu Radar ainda está sem vagas.</p>
          ${button('Adicionar uma vaga por link', 'import', 'secondary')}</div>`;
  }
  return `<div class="panel jobs" tabindex="0" role="region" aria-label="Tabela de oportunidades">
    <table><thead><tr><th scope="col">Cargo / empresa</th><th scope="col">Fonte</th><th scope="col">Modelo</th>
      <th scope="col">Aderência</th><th scope="col">Cadastro</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${jobs.map(job => {
      const score = scoreJob(job);
      return `<tr>
        <td><a class="job-title link-button" href="${jobUrl(job.id)}">${escape(job.title)}</a><span class="job-company">${escape(job.company)}</span></td>
        <td class="muted">${escape(job.source)}</td><td>${escape(job.model)}</td>
        <td class="fit">${score === null ? '—' : score + '%'}</td><td class="muted">${elapsed(job.date)}</td>
        <td><a class="link-button" href="${jobUrl(job.id)}" aria-label="Ver vaga: ${escape(job.title + ' na ' + job.company)}">Ver vaga ›</a></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function jobsByDate() {
  return [...data.jobs].sort((first, second) => second.date - first.date);
}

function dashboard() {
  const jobs = jobsByDate();
  const active = data.applications.filter(item => ['applied', 'interview'].includes(item.stage));
  const fresh = jobs.filter(job => Date.now() - job.date < 86400000);
  const metrics = [
    ['Novas oportunidades', fresh.length, 'Cadastradas nas últimas 24 h'],
    ['Alta aderência', jobs.filter(job => scoreJob(job) >= 80).length, 'A partir de 80%'],
    ['Em andamento', active.length, 'Candidaturas ativas'],
    ['Entrevistas', active.filter(item => item.stage === 'interview').length, 'Agendadas ou em avaliação']
  ];
  return page('Sua busca de carreira', 'Acompanhe as oportunidades encontradas e suas próximas ações.') + `
    <section class="metrics" aria-label="Indicadores da busca de carreira">
      ${metrics.map(([label, value, description]) => `<div class="panel metric"><p class="metric-label">${label}</p><strong class="metric-value">${value}</strong><p class="small muted">${description}</p></div>`).join('')}
    </section>
    <div class="panel monitor">
      <div class="monitor-main"><span class="dot${data.alerts.active ? '' : ' paused'}" aria-hidden="true"></span><div>
        <strong>${data.alerts.active ? 'Alertas ativos' : 'Alertas pausados'}</strong>
        <p class="hint">Acompanhe as oportunidades cadastradas que combinam com sua busca.</p>
      </div></div>
      <a href="#alertas" class="link-button small">${alertMatches().length} alertas no Radar</a>
    </div>
    <div class="section-row recent-head"><h2>Oportunidades recentes</h2><a href="#vagas" class="link-button">Ver todas as vagas ›</a></div>
    ${jobTable(jobs.slice(0, 4))}`;
}

function explore() {
  const fields = [
    ['source', 'Fonte', [['', 'Todas as fontes'], 'Gupy', 'LinkedIn', 'Outra']],
    ['level', 'Senioridade', [['', 'Senioridade'], ...levels]],
    ['model', 'Modelo de trabalho', [['', 'Modelo de trabalho'], ...models]],
    ['minimum', 'Aderência mínima', [['', 'Aderência mínima'], ['60', '60% ou mais'], ['70', '70% ou mais'], ['80', '80% ou mais'], ['90', '90% ou mais']]],
    ['order', 'Ordenação', [['recent', 'Mais recentes'], ['fit', 'Maior aderência'], ['title', 'Cargo A–Z']]]
  ];
  return page('Explorar vagas', 'Encontre oportunidades compatíveis com seus objetivos profissionais.') + `
    <section class="panel filters" aria-label="Filtros de vagas">
      <div class="filter-top">
        <input type="search" aria-label="Buscar por cargo, empresa ou palavra-chave" name="query" data-filter value="${escape(filters.query)}" placeholder="Buscar por cargo, empresa ou palavra-chave">
        ${button('Importar vaga por link', 'import', 'secondary')}
      </div>
      <div class="filter-grid">${fields.map(([name, label, values]) => `<select name="${name}" aria-label="${label}" data-filter>${options(values, filters[name])}</select>`).join('')}</div>
    </section><div id="job-results">${results()}</div>`;
}

function results() {
  const terms = normalized(filters.query).split(/\s+/).filter(Boolean);
  const jobs = jobsByDate().filter(job => {
    const text = normalized([job.title, job.company, job.description, ...job.skills].join(' '));
    return terms.every(term => text.includes(term)) &&
      (!filters.source || job.source === filters.source) &&
      (!filters.level || job.level === filters.level) &&
      (!filters.model || job.model === filters.model) &&
      (!filters.minimum || scoreJob(job) >= Number(filters.minimum));
  });
  if (filters.order === 'fit') jobs.sort((a, b) => (scoreJob(b) ?? -1) - (scoreJob(a) ?? -1));
  if (filters.order === 'title') jobs.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const totalPages = Math.max(1, Math.ceil(jobs.length / pageSize));
  searchPage = Math.min(searchPage, totalPages);
  const start = (searchPage - 1) * pageSize;
  const sortLabel = { recent: 'Ordenado por cadastro', fit: 'Ordenado por aderência', title: 'Ordenado por cargo' };
  return `<div class="section-row results-head"><h2 aria-live="polite" tabindex="-1">${jobs.length} ${jobs.length === 1 ? 'oportunidade encontrada' : 'oportunidades encontradas'}</h2><p class="small muted">${sortLabel[filters.order]}</p></div>
    ${jobTable(jobs.slice(start, start + pageSize))}
    ${totalPages > 1 ? `<div class="pagination" aria-label="Paginação de oportunidades">
      <button type="button" class="button secondary" data-action="previous" ${searchPage === 1 ? 'disabled' : ''}>Anterior</button>
      <span class="small muted">${searchPage} de ${totalPages}</span>
      <button type="button" class="button secondary" data-action="next" ${searchPage === totalPages ? 'disabled' : ''}>Próxima</button>
    </div>` : ''}`;
}

function detail(job) {
  if (!job) return page('Vaga indisponível', '') + '<a class="link-button" href="#vagas">Voltar para explorar vagas ›</a>';
  const score = scoreJob(job);
  const evidence = matchedSkills(job);
  const missing = (job.skills ?? []).filter(skill => !matchedSkills(job).includes(skill));
  const attention = score !== null && missing.length ? 'Sem evidências para ' + missing.join(', ') + '.' : '';
  const saved = data.applications.find(item => item.jobId === job.id);
  const roleMeta = [job.company, job.model, job.contract, job.source, elapsed(job.date)].filter(Boolean).join('  ·  ');

  return page(job.title, roleMeta) + `<div class="two-col detail-grid">
    <article class="panel description">
      <h2>Sobre a oportunidade</h2>
      <p>${escape(job.description || 'Descrição ainda não cadastrada.')}</p>
      ${job.duties?.length ? '<section><h3>Responsabilidades</h3>' + list(job.duties) + '</section>' : ''}
      ${(job.requirements ?? job.skills).length ? '<section><h3>Requisitos</h3>' + list(job.requirements ?? job.skills) + '</section>' : ''}
      <div class="action-row">
        ${job.url ? `<a class="button secondary" target="_blank" rel="noopener noreferrer" href="${escape(job.url)}">Abrir vaga original ↗</a>` : ''}
        ${saved ? '<a class="button secondary" href="#candidaturas">Oportunidade salva ✓</a>' : button('Salvar oportunidade', 'save-job', 'secondary', job.id)}
      </div>
    </article>
    <aside class="panel compatibility">
      <h2>Aderência ao seu perfil</h2>
      <strong class="score">${score === null ? '—' : score + '%'}</strong>
      <p class="hint">${score === null ? 'Informe as competências do perfil e os requisitos da vaga para estimar a aderência.' : 'Compatibilidade estimada'}</p>
      ${progress(score ?? 0, 'Compatibilidade estimada')}
      <section><h3>Requisitos com evidências</h3>
        ${evidence.length ? list(evidence, 'checklist') : '<p class="hint">Nenhuma evidência correspondente.</p>'}
        ${attention ? `<div class="attention-block"><h3>Pontos de atenção</h3><p class="hint warning">${escape(attention)}</p></div>` : ''}
        <p class="small muted fit-note">A pontuação é uma estimativa do Radar, não do ATS.</p>
      </section>
      <section class="prepare"><h3>Preparar candidatura</h3><p class="hint">Selecione experiências e adapte o conteúdo do seu currículo.</p>
        ${button('Gerar currículo personalizado', 'resume', 'primary', job.id)}
      </section>
    </aside>
  </div>`;
}

function profile() {
  const profile = data.profile;
  const fields = ['name', 'role', 'location', 'email', 'portfolio', 'summary', 'goal', 'projects', 'skills', 'formation', 'certifications', 'languages'];
  const completed = fields.filter(field => profile[field]?.trim()).length + Number(profile.experiences.length > 0);
  const completion = Math.round(100 * completed / (fields.length + 1));
  return page('Meu perfil profissional', 'Sua base de experiências, competências e evidências para currículos personalizados.', button('Salvar alterações', 'profile-save')) + `
    <div class="two-col profile-grid">
      <aside class="panel profile-nav" aria-label="Seções do perfil">
        <p class="nav-caption">Informações</p>
        ${Object.entries(profileSections).map(([key, [label]]) => `<button type="button" aria-pressed="${key === profileTab}" data-action="profile-tab" data-id="${key}">${label}</button>`).join('')}
        <div class="profile-progress"><p class="small muted">Perfil preenchido</p><strong>${completion}%</strong>${progress(completion, 'Perfil preenchido')}</div>
      </aside>
      <section class="panel profile-content">
        ${profileTab === 'experiences' ? experiencePanel() : profileFields()}
      </section>
    </div>`;
}

function profileFields() {
  const [label, fields] = profileSections[profileTab];
  return `<div class="section-row"><h2>${label}</h2></div>
    <form id="profile-form" class="fields two profile-form">
      ${fields.map(([key, text, multiline]) => input(text, key, data.profile[key], { type: multiline ? 'textarea' : key === 'email' ? 'email' : 'text', wide: multiline })).join('')}
    </form>`;
}

function experiencePanel() {
  const experiences = data.profile.experiences;
  return `<div class="section-row"><div><h2>Experiências profissionais</h2><p class="hint">Cadastre atividades, responsabilidades e resultados verificáveis.</p></div>
      ${button('+ Adicionar experiência', 'experience', 'primary')}</div>
    ${!experiences.length ? '<p class="empty">Adicione sua primeira experiência profissional.</p>' : ''}
    ${experiences.map((item, index) => `<article class="experience">
      <div class="item-row"><h3>${escape(item.title)}</h3>${button('Editar', 'experience', 'link', item.id)}</div>
      <p class="hint">${escape([item.company, item.period].filter(Boolean).join(' · '))}</p>
      <p class="summary">${escape(item.description)}</p>
      ${(!index || item.evidence.length) ? `
        <p class="small muted related">Competências relacionadas</p><div class="tags">${commaList(item.skills).map(tag).join('')}</div>
        <h4 class="evidence-title">Resultados e evidências</h4>
        <div class="evidence-box">
          ${item.evidence.length ? list(item.evidence) : '<p class="muted">Nenhum resultado quantitativo registrado.</p>'}
          ${button('+ Adicionar resultado', 'evidence', 'link', item.id)}
        </div>` : ''}
    </article>`).join('')}
    <p class="profile-footer small muted">${experiences.length} ${experiences.length === 1 ? 'experiência cadastrada' : 'experiências cadastradas'}</p>`;
}

function kanban() {
  return page('Minhas candidaturas', 'Organize seus processos seletivos e acompanhe cada etapa.', button('+ Nova candidatura', 'application')) + `
    <div class="kanban">
      ${stages.map(([stage, label]) => {
        const cards = data.applications.filter(item => item.stage === stage);
        return `<section class="kanban-column" data-stage="${stage}" aria-label="${label}">
          <header class="section-row"><h2>${label}</h2><span class="small muted">${cards.length}</span></header>
          <div class="kanban-list">${cards.map(item => `<button type="button" class="kanban-card" draggable="true" data-action="edit-application" data-id="${escape(item.id)}">
            <strong>${escape(item.title)}</strong><span class="small muted">${escape(item.company)}</span>
            ${item.info ? '<span class="positive">' + escape(item.info) + '</span>' : ''}
            <small class="muted">${new Date(item.updated).toDateString() === new Date().toDateString() ? 'Atualizada hoje' : 'Atualizada ' + elapsed(item.updated).toLowerCase()}</small>
          </button>`).join('')}</div>
          <button type="button" class="link-button kanban-add" data-action="application" data-id="${stage}">+ Adicionar candidatura</button>
        </section>`;
      }).join('')}
    </div>`;
}

function resumeSelection(job) {
  const profile = data.profile;
  const saved = data.resumes[job.id];
  return {
    ...saved,
    summary: saved?.summary ?? profile.summary,
    experiences: profile.experiences.filter(item => !saved || saved.selected.includes(item.id)),
    skills: saved?.skills ?? [...new Set([...matchedSkills(job), ...commaList(profile.skills)])]
  };
}

function resumeBlocks(selection) {
  const profile = data.profile;
  return [
    ['Resumo profissional', selection.summary],
    ['Formação', profile.formation],
    ['Competências', selection.skills.join(', ')],
    ['Projetos e resultados', profile.projects],
    ['Certificações', profile.certifications],
    ['Idiomas', profile.languages]
  ].filter(([, value]) => value?.trim());
}

function resume(job) {
  if (!job) return page('Currículos', 'Prepare um currículo a partir do seu perfil profissional.') +
    '<section class="panel resume-picker"><h2>Selecione uma oportunidade</h2><p class="hint">Abra uma vaga e gere um currículo com as suas experiências.</p><a class="button primary" href="#vagas">Explorar vagas</a></section>';
  const selection = resumeSelection(job);
  const profile = data.profile;
  const subtitle = [job.title, job.company, 'Versão ' + String(selection.version ?? 1).padStart(2, '0')].join(' · ');
  const blocks = resumeBlocks(selection);
  const summary = blocks.find(([heading]) => heading === 'Resumo profissional');
  return page('Preparar currículo', subtitle) + `<div class="two-col resume-grid">
    <section class="panel resume-controls"><h2>Conteúdo selecionado</h2><p class="hint">Revise as evidências utilizadas para esta vaga.</p><hr class="rule">
      <h3>Experiências</h3>
      ${selection.experiences.length ? list(selection.experiences.map(item => item.title), 'checklist') : '<p class="hint">Nenhuma experiência selecionada.</p>'}
      <h3 class="skills-title">Competências priorizadas</h3><div class="tags">${selection.skills.map(tag).join('') || '<p class="hint">Nenhuma competência selecionada.</p>'}</div><hr class="rule">
      <h3>Verificação ATS</h3>${list(['Estrutura de coluna única', 'Texto selecionável', 'Conteúdo baseado no perfil'], 'checklist')}
      <p class="small warning">${profile.name ? 'Revise seus dados antes de enviar o currículo.' : 'Preencha o nome no seu perfil para exportar o currículo.'}</p>
      <div class="action-row">
        ${button('Revisar conteúdo', 'review-resume', 'secondary', job.id)}
        ${button('Exportar currículo', 'export-resume', 'primary', job.id)}
      </div>
    </section>
    <section class="panel preview" aria-label="Prévia do documento">Prévia do documento
      <article class="paper"><h2>${escape(profile.name || 'Nome do profissional')}</h2>
        <p class="paper-meta">${escape([profile.role, profile.location].filter(Boolean).join('  |  '))}</p>
        <p class="paper-meta">${escape([profile.email, profile.portfolio].filter(Boolean).join('  ·  '))}</p><hr class="rule">
        ${summary ? `<section><h3>${summary[0]}</h3><p class="paper-career">${escape(summary[1])}</p></section>` : ''}
        ${selection.experiences.length ? `<section><h3>Experiência profissional</h3>${selection.experiences.map(item => `
          <div class="paper-item"><strong>${escape(item.title + ' | ' + item.company)}</strong><p class="muted">${escape(item.period)}</p>
            ${experienceBullets(item).length ? list(experienceBullets(item)) : ''}</div>`).join('')}</section>` : ''}
        ${blocks.filter(([heading]) => heading !== 'Resumo profissional').map(([heading, value]) => `<section><h3>${heading}</h3><p class="paper-career">${escape(value)}</p></section>`).join('')}
      </article>
    </section>
  </div>`;
}

function experienceBullets(item) {
  return [...lineList(item.activities || item.description), ...item.evidence];
}

function alertMatches() {
  const alerts = data.alerts;
  if (!alerts.active || !alerts.inApp) return [];
  return jobsByDate().filter(job =>
    (!alerts.roles.length || alerts.roles.some(term => normalized(job.title).includes(normalized(term)))) &&
    (!alerts.models.length || alerts.models.includes(job.model)) &&
    (!alerts.levels.length || alerts.levels.includes(job.level)) &&
    (scoreJob(job) ?? 0) >= alerts.minimum
  );
}

function alerts() {
  const draft = alertDraft;
  const modelTags = (list, group) => list.map(item => `<button type="button" class="tag${draft[group].includes(item) ? '' : ' inactive'}" aria-pressed="${draft[group].includes(item)}" data-action="alert-toggle" data-group="${group}" data-id="${escape(item)}">${escape(item)}</button>`).join('');
  const matches = alertMatches();
  return page('Meus alertas', 'Defina o que procurar e quando receber novas oportunidades.') + `
    <div class="two-col alerts-grid">
      <section class="panel alert-form">
        <div class="section-row"><h2>Busca principal</h2><button type="button" class="tag${draft.active ? '' : ' inactive'}" data-action="alert-active" aria-pressed="${draft.active}">${draft.active ? 'Ativo' : 'Pausado'}</button></div>
        <div class="alert-group"><p class="hint">Cargos de interesse</p><div class="tags">
          ${draft.roles.map(role => `<button type="button" class="tag" data-action="remove-role" data-id="${escape(role)}" aria-label="Remover ${escape(role)}">${escape(role)}<span aria-hidden="true">×</span></button>`).join('')}
          <button class="tag add-tag" type="button" data-action="add-role">+ Cargo</button>
        </div></div>
        <div class="alert-group"><p class="hint">Modelo de trabalho</p><div class="tags">${modelTags(models, 'models')}</div></div>
        <div class="alert-group"><p class="hint">Senioridade</p><div class="tags">${modelTags(levels, 'levels')}</div></div>
        <div class="range-row"><label class="hint" for="alert-min">Aderência mínima para alertar</label>
          <input type="range" id="alert-min" min="0" max="100" value="${draft.minimum}" style="--range: ${draft.minimum}%"><output for="alert-min">${draft.minimum}%</output>
        </div>
        <hr class="rule">${button('Salvar preferências', 'save-alerts')}
      </section>
      <aside class="panel sources"><h2>Fontes de vagas</h2>
        ${[['Gupy', 'Importação de vagas por link'], ['LinkedIn', 'Importação de alertas e links']].map(([source, caption]) => `<section class="source"><h3>${source}</h3>
          <p class="small muted">${caption}</p><button class="tag attention" type="button" data-action="source" data-id="${source}">Configurar</button>
        </section>`).join('')}
        <div class="channels"><h2>Notificações</h2>
          <label><input type="checkbox" id="alert-in-app" ${draft.inApp ? 'checked' : ''}>Dentro do Radar</label>
        </div>
        <p class="small muted">Os alertas são atualizados quando você cadastra vagas ou edita suas preferências.</p>
      </aside>
    </div>
    <section class="panel inbox"><h2>Alertas no Radar</h2>
      ${matches.length ? `<ul>${matches.map(job => `<li><a href="${jobUrl(job.id)}">${escape(job.title)} · ${escape(job.company)} · ${scoreJob(job)}%</a></li>`).join('')}</ul>` : '<p class="hint">Nenhuma oportunidade corresponde às preferências salvas.</p>'}
    </section>`;
}

function settings() {
  return page('Configurações', 'Gerencie os dados do seu espaço pessoal no Radar.') + `
    <section class="panel settings-panel">
      <h2>Dados da sua conta</h2><p class="hint">Suas vagas, candidaturas e perfil são salvos no Radar e ficam disponíveis quando você entra com a mesma conta.</p>
      <div class="action-row">${button('Baixar meus dados', 'export-data', 'secondary')}${button('Sincronizar agora', 'sync-data', 'secondary')}</div><hr class="rule">
      <h2>Fontes e notificações</h2><p class="hint">Configure a importação e as preferências de busca em Meus alertas.</p>
      <a href="#alertas" class="link-button">Abrir Meus alertas ›</a>
    </section>`;
}

function render(changeRoute = false) {
  const [requested, id] = location.hash.slice(1).split('/');
  const next = Object.hasOwn(sections, requested) ? requested : 'visao-geral';
  if (next === 'alertas' && (route !== 'alertas' || !alertDraft)) alertDraft = structuredClone(data.alerts);
  route = next;
  navigation.querySelectorAll('a').forEach(link => {
    if (link.hash === '#' + route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#breadcrumb').innerHTML = 'Workspace <span aria-hidden="true">/</span> ' + sections[route];
  document.title = sections[route] + ' — Radar';
  const pages = { 'visao-geral': dashboard, vagas: () => id ? detail(findJob(id)) : explore(), candidaturas: kanban,
    curriculos: () => resume(findJob(id || data.resumeId)), perfil: profile, alertas: alerts, configuracoes: settings };
  content.innerHTML = pages[route]();
  if (changeRoute) {
    menu.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('open');
    window.scrollTo(0, 0);
    content.focus({ preventScroll: true });
  }
}

function openDialog(title, body, submitLabel, submit, intro = '') {
  lastTrigger = document.activeElement;
  dialogAction = submit;
  dialog.innerHTML = `<div class="section-row"><h2 id="dialog-title">${escape(title)}</h2>
    <button type="button" class="dialog-close" data-close aria-label="Fechar">×</button></div>
    ${intro ? '<p class="dialog-intro">' + escape(intro) + '</p>' : ''}
    <form id="modal-form">${body}<p class="dialog-error" role="alert"></p>
      <div class="action-row"><button type="button" class="button secondary" data-close>${submit ? 'Cancelar' : 'Fechar'}</button>
        ${submit ? '<button type="submit" class="button primary">' + escape(submitLabel) + '</button>' : ''}</div>
    </form>`;
  dialog.showModal();
  dialog.querySelector('input:not([type="checkbox"]), textarea, select')?.focus();
}

function saveModal(form, action) {
  const fields = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
  const missing = [...form.querySelectorAll('[required]')].find(field => !fields[field.name]);
  if (missing) {
    missing.focus();
    dialog.querySelector('.dialog-error').textContent = 'Preencha os campos obrigatórios.';
    return;
  }
  const error = action(fields, form);
  if (error) dialog.querySelector('.dialog-error').textContent = error;
  else dialog.close();
}

dialog.addEventListener('click', event => {
  if (event.target.closest('[data-close]')) dialog.close();
});
dialog.addEventListener('submit', event => {
  event.preventDefault();
  if (dialogAction) saveModal(event.target, dialogAction);
});
dialog.addEventListener('close', () => {
  if (lastTrigger?.isConnected) lastTrigger.focus();
  else content.focus({ preventScroll: true });
  dialogAction = null;
});

function importJob(source = '') {
  const sourceInput = source ? '' : '<p class="small muted">O Radar identifica links da Gupy e do LinkedIn pelo endereço.</p>';
  openDialog('Importar vaga por link', `<div class="fields two">
    ${input('Link da vaga', 'url', '', { type: 'url', required: true, wide: true, placeholder: 'https://…' })}
    ${input('Cargo', 'title', '', { required: true })}${input('Empresa', 'company', '', { required: true })}
    ${select('Modelo de trabalho', 'model', models, 'Remoto')}${select('Senioridade', 'level', levels, 'Pleno')}
    ${input('Contrato', 'contract', '', { placeholder: 'Ex.: CLT' })}
    ${input('Competências exigidas', 'skills', '', { placeholder: 'Separe por vírgula' })}
    ${input('Descrição da vaga', 'description', '', { type: 'textarea', wide: true })}
  </div>${sourceInput}`, 'Importar vaga', fields => {
    let url;
    try {
      url = new URL(fields.url);
    } catch {
      return 'Informe um link válido para a vaga.';
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return 'Use um endereço HTTP ou HTTPS da vaga.';
    url.hash = '';
    const cleanUrl = url.href;
    if (data.jobs.some(job => job.url === cleanUrl)) return 'Este link já foi importado.';
    const host = url.hostname.toLowerCase();
    const matches = domain => host === domain || host.endsWith('.' + domain);
    const detected = matches('gupy.io') || matches('gupy.com.br') ? 'Gupy' : matches('linkedin.com') ? 'LinkedIn' : 'Outra';
    if (source && detected !== source) return 'Informe um link de vaga da fonte ' + source + '.';
    const skills = [...new Map(commaList(fields.skills).map(skill => [normalized(skill), skill])).values()];
    const job = { ...fields, url: cleanUrl, id: newId(), source: detected, date: Date.now(), skills };
    data.jobs.unshift(job);
    commit('Vaga cadastrada.');
    location.hash = jobUrl(job.id);
  }, 'Cole o link e inclua os dados que deseja acompanhar.');
}

function saveJob(id) {
  const job = findJob(id);
  if (!job || data.applications.some(item => item.jobId === id)) return;
  const score = scoreJob(job);
  data.applications.push({ id: newId(), jobId: id, title: job.title, company: job.company, stage: 'saved',
    info: score === null ? job.source : job.source + ' · ' + score + '%', notes: '', updated: Date.now() });
  commit('Oportunidade adicionada às candidaturas salvas.');
  render();
  content.querySelector('a[href="#candidaturas"]')?.focus();
}

function saveProfile(renderAfter = true, showMessage = true) {
  const form = document.querySelector('#profile-form');
  if (form && !form.reportValidity()) return false;
  if (form) {
    const changes = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, value.trim()]));
    if (Object.keys(changes).some(name => data.profile[name] !== changes[name])) {
      Object.assign(data.profile, changes);
    }
  }
  if (showMessage) commit('Perfil salvo.');
  else persist();
  if (renderAfter) render();
  return true;
}

function editExperience(id) {
  const xp = byId(data.profile.experiences, id) ?? {};
  openDialog(id ? 'Editar experiência' : 'Adicionar experiência', `<div class="fields two">
    ${input('Cargo', 'title', xp.title, { required: true })}${input('Empresa', 'company', xp.company, { required: true })}
    ${input('Período', 'period', xp.period, { placeholder: 'Ex.: Jan/2026 – Atual' })}
    ${input('Competências', 'skills', xp.skills, { placeholder: 'Separe por vírgula' })}
    ${input('Descrição', 'description', xp.description, { type: 'textarea', wide: true })}
    ${input('Atividades para o currículo', 'activities', xp.activities, { type: 'textarea', wide: true, placeholder: 'Uma atividade por linha' })}
    ${input('Resultados e evidências', 'evidence', xp.evidence?.join('\n'), { type: 'textarea', wide: true, placeholder: 'Um resultado por linha' })}
  </div>`, 'Salvar experiência', fields => {
    const updated = { ...fields, id: id || newId(), evidence: lineList(fields.evidence) };
    if (id) data.profile.experiences = data.profile.experiences.map(item => item.id === id ? updated : item);
    else data.profile.experiences.unshift(updated);
    commit('Experiência salva.');
    render();
  });
}

function addEvidence(id) {
  const item = byId(data.profile.experiences, id);
  if (!item) return;
  openDialog('Adicionar resultado', '<div class="fields">' + input('Resultado ou evidência', 'result', '', { type: 'textarea', required: true }) + '</div>', 'Adicionar resultado', fields => {
    item.evidence.push(fields.result);
    commit('Resultado adicionado.');
    render();
  });
}

function applicationEditor(id, stage = 'saved') {
  const item = byId(data.applications, id) ?? {};
  const relatedJob = findJob(item.jobId);
  openDialog(id ? 'Editar candidatura' : 'Nova candidatura', `<div class="fields two">
    ${input('Cargo', 'title', item.title, { required: true })}${input('Empresa', 'company', item.company, { required: true })}
    ${select('Etapa', 'stage', stages, item.stage || stage)}${input('Informação da etapa', 'info', item.info, { placeholder: 'Ex.: Entrevista inicial' })}
    ${input('Anotações', 'notes', item.notes, { type: 'textarea', wide: true })}
  </div>${relatedJob ? '<a class="link-button" href="' + jobUrl(relatedJob.id) + '" data-close>Ver vaga vinculada ›</a>' : ''}`, 'Salvar candidatura', fields => {
    const updated = { ...item, ...fields, id: id || newId(), updated: Date.now() };
    if (id) data.applications = data.applications.map(record => record.id === id ? updated : record);
    else data.applications.push(updated);
    commit('Candidatura salva.');
    render();
  });
}

function prepareResume(id) {
  if (!findJob(id)) return;
  data.resumeId = id;
  persist();
  location.hash = '#curriculos/' + encodeURIComponent(id);
}

function editResume(id) {
  const job = findJob(id);
  const selection = resumeSelection(job);
  const selectedIds = new Set(selection.experiences.map(item => item.id));
  const choices = data.profile.experiences.map(item => `<label><input type="checkbox" name="experience" value="${escape(item.id)}" ${selectedIds.has(item.id) ? 'checked' : ''}>${escape(item.title + ' · ' + item.company)}</label>`).join('');
  openDialog('Revisar currículo', `<div class="fields">
    ${input('Resumo profissional', 'summary', selection.summary, { type: 'textarea' })}
    <div><h3>Experiências</h3><div class="choices">${choices || '<p class="hint">Cadastre experiências no seu perfil.</p>'}</div></div>
    ${input('Competências', 'skills', selection.skills.join(', '), { placeholder: 'Separe por vírgula' })}
  </div>`, 'Salvar versão', (fields, form) => {
    data.resumes[id] = { summary: fields.summary, selected: new FormData(form).getAll('experience'),
      skills: commaList(fields.skills), version: (selection.version ?? 1) + 1 };
    commit('Versão do currículo salva.');
    render();
  });
}

function download(content, filename) {
  const url = URL.createObjectURL(content);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportResume(id) {
  const job = findJob(id);
  const selection = resumeSelection(job);
  const profile = data.profile;
  if (!profile.name.trim()) {
    message('Preencha o nome em Meu perfil antes de exportar.');
    return;
  }
  const rows = [
    { text: profile.name || 'Nome do profissional', size: 21, bold: true },
    { text: [profile.role, profile.location].filter(Boolean).join(' | ') },
    { text: [profile.email, profile.portfolio].filter(Boolean).join(' · ') }
  ];
  const block = (label, value) => {
    rows.push({ text: label.toUpperCase(), bold: true, gap: 14 }, { text: value });
  };
  const blocks = resumeBlocks(selection);
  if (selection.summary.trim()) block('Resumo profissional', selection.summary);
  if (selection.experiences.length) {
    rows.push({ text: 'EXPERIÊNCIA PROFISSIONAL', bold: true, gap: 14 });
    for (const item of selection.experiences) {
      rows.push({ text: item.title + ' | ' + item.company, bold: true, gap: 7 }, { text: item.period });
      for (const text of experienceBullets(item)) rows.push({ text: '• ' + text });
    }
  }
  for (const [heading, value] of blocks) if (heading !== 'Resumo profissional') block(heading, value);
  const name = normalized(profile.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  download(createPdf(rows), 'curriculo-' + (name || 'radar') + '.pdf');
  message('Currículo em PDF gerado.');
}

function setAlertRole() {
  openDialog('Adicionar cargo de interesse', '<div class="fields">' + input('Cargo', 'role', '', { required: true }) + '</div>', 'Adicionar cargo', fields => {
    if (alertDraft.roles.some(item => normalized(item) === normalized(fields.role))) return 'Esse cargo já está na busca.';
    alertDraft.roles.push(fields.role);
    render();
  });
}

function alterAlerts(action, target) {
  const id = target.dataset.id;
  if (action === 'alert-active') alertDraft.active = !alertDraft.active;
  if (action === 'remove-role') alertDraft.roles = alertDraft.roles.filter(role => role !== id);
  if (action === 'alert-toggle') {
    const group = target.dataset.group;
    const values = alertDraft[group];
    alertDraft[group] = values.includes(id) ? values.filter(value => value !== id) : [...values, id];
  }
  render();
  const replacement = [...content.querySelectorAll('[data-action]')].find(item =>
    item.dataset.action === target.dataset.action && item.dataset.id === target.dataset.id && item.dataset.group === target.dataset.group
  );
  (replacement ?? content.querySelector('[data-action="add-role"]'))?.focus();
}

function updateResults() {
  document.querySelector('#job-results').innerHTML = results();
}

const actions = {
  import: () => importJob(), source: id => importJob(id), 'save-job': saveJob,
  previous: () => pageBy(-1), next: () => pageBy(1),
  'profile-tab': id => {
    if (!saveProfile(false, false)) return;
    profileTab = id;
    render();
    content.querySelector('[data-action="profile-tab"][aria-pressed="true"]')?.focus();
  },
  'profile-save': () => saveProfile(), experience: editExperience, evidence: addEvidence,
  application: stage => applicationEditor('', stage || 'saved'), 'edit-application': applicationEditor,
  resume: prepareResume, 'review-resume': editResume, 'export-resume': exportResume,
  'alert-active': (_, target) => alterAlerts('alert-active', target),
  'alert-toggle': (_, target) => alterAlerts('alert-toggle', target),
  'remove-role': (_, target) => alterAlerts('remove-role', target),
  'add-role': setAlertRole,
  'save-alerts': () => {
    data.alerts = structuredClone(alertDraft);
    commit('Preferências salvas.');
    render();
    content.querySelector('[data-action="save-alerts"]')?.focus();
  },
  'sync-data': () => {
    if (writeConflict) {
      message('Baixe suas alterações antes de recarregar para obter a versão mais recente.');
      return;
    }
    commit('Dados sincronizados.');
  },
  'export-data': () => download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'radar-dados.json')
};

function pageBy(amount) {
  searchPage += amount;
  updateResults();
  const next = amount > 0 ? 'next' : 'previous';
  (content.querySelector('[data-action="' + next + '"]:not(:disabled)') ??
    content.querySelector('.results-head h2'))?.focus();
}

content.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target) actions[target.dataset.action]?.(target.dataset.id, target);
});

content.addEventListener('submit', event => {
  if (event.target.id === 'profile-form') {
    event.preventDefault();
    saveProfile();
  }
});

content.addEventListener('input', event => {
  const target = event.target;
  if (target.matches('input[data-filter]')) {
    filters[target.name] = target.value;
    searchPage = 1;
    updateResults();
  }
  if (target.id === 'alert-min') {
    alertDraft.minimum = Number(target.value);
    target.style.setProperty('--range', target.value + '%');
    content.querySelector('output').value = target.value + '%';
  }
});

content.addEventListener('change', event => {
  const target = event.target;
  if (target.matches('select[data-filter]')) {
    filters[target.name] = target.value;
    searchPage = 1;
    updateResults();
  }
  if (target.id === 'alert-in-app') alertDraft.inApp = target.checked;
});

content.addEventListener('dragstart', event => {
  const card = event.target.closest('.kanban-card');
  if (!card) return;
  draggedCard = card.dataset.id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedCard);
});
content.addEventListener('dragover', event => {
  const column = event.target.closest('.kanban-column');
  if (!column || !draggedCard) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  content.querySelectorAll('.kanban-column.over').forEach(item => item.classList.remove('over'));
  column.classList.add('over');
});
content.addEventListener('drop', event => {
  const column = event.target.closest('.kanban-column');
  const card = byId(data.applications, draggedCard);
  if (!column || !card) return;
  event.preventDefault();
  column.classList.remove('over');
  if (card.stage === column.dataset.stage) return;
  card.stage = column.dataset.stage;
  card.updated = Date.now();
  draggedCard = null;
  commit('Candidatura movida.');
  render();
});
content.addEventListener('dragend', () => {
  draggedCard = null;
  content.querySelectorAll('.kanban-column.over').forEach(item => item.classList.remove('over'));
});

menu.addEventListener('click', () => {
  menu.setAttribute('aria-expanded', String(navigation.classList.toggle('open')));
});
navigation.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (link?.hash === location.hash) {
    navigation.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
  }
});
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  content.focus();
});
window.addEventListener('hashchange', () => { if (ready) render(true); });

async function initialize() {
  syncStatus.textContent = 'Carregando…';
  try {
    const response = await fetch('./api/workspace', { cache: 'no-store' });
    if (!response.ok) throw new Error('O Radar não conseguiu carregar seus dados.');
    const saved = await response.json();
    revision = saved.revision;
    if (saved.state) data = saved.state;
    else {
      const recovered = await recoverWorkspace(initialData());
      if (recovered) data = recovered;
      ready = true;
      if (recovered) await persist();
    }
    ready = true;
    if (!data.profile.experiences.length) profileTab = 'personal';
    if (syncStatus.textContent === 'Carregando…') syncStatus.textContent = 'Espaço pessoal';
    render();
  } catch {
    syncStatus.textContent = 'Conexão indisponível';
    content.innerHTML = page('Não foi possível carregar o Radar', 'Recarregue a página para tentar novamente.') +
      '<button type="button" class="button primary" id="reload">Tentar novamente</button>';
    content.querySelector('#reload').addEventListener('click', () => location.reload());
  }
}

void initialize();
