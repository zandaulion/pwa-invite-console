/* Private, same-origin administration. Every request and event retains its app
   context: changing the selection must never retarget an existing action. */
'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : n % 100 >= 20 || n % 100 === 0 ? `de ${many}` : many}`;
// SQLite's datetime('now') values are UTC even though they omit the zone.
const timestamp = value => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
const expired = date => !!date && timestamp(date) <= Date.now();
const dateLabel = (value, accessDate = false) => value ? new Date(timestamp(value)).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric', ...(accessDate ? { timeZone: 'UTC' } : {}) }) : '';
const ICONS = {
  invite: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.invite}</svg>`;
let apps = [], currentApp = null, tab = 'invites', view = null, loadController = null;
let selectionVersion = 0, formVersion = 0, formApp = null, formOptions = { classes: [], children: [] };
let optionsReady = true, submitting = false, toastTimer;
const summaries = new Map(), summaryVersions = new Map();
const filters = { invites: 'all', devices: 'all' };
const queries = { invites: '', devices: '' };
const DEFAULT_NOTE = 'Un singur dispozitiv, expiră în {days} zile. În prima oră de la folosire codul re-leagă același dispozitiv, nu înregistrează altul.';
const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
let recent = readStored('console:recent', []);
if (!Array.isArray(recent)) recent = [];

async function apiFor(app, endpoint, { body, method = body ? 'POST' : 'GET', signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 18000);
  try {
    const response = await fetch(app.api + endpoint, {
      method, cache: 'no-store', signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || data?.detail || `Cererea a eșuat (${response.status}).`);
    if (!data && method === 'GET') throw new Error('Răspunsul aplicației nu este valid.');
    return data || {};
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Aplicația nu a răspuns la timp. Încearcă din nou.');
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
function when(value) {
  if (!value) return 'niciodată';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp(value)) / 60000));
  if (minutes < 1) return 'chiar acum';
  if (minutes < 60) return `acum ${minutes} min`;
  if (minutes < 1440) return `acum ${Math.round(minutes / 60)} h`;
  return dateLabel(value);
}
function remaining(value) {
  if (!value) return '';
  const hours = Math.max(0, Math.ceil((timestamp(value) - Date.now()) / 3600000));
  return hours < 48 ? `în ${hours} h` : `în ${Math.ceil(hours / 24)} zile`;
}
function inviteState(inv) {
  if (inv.revoked) return { key: 'revoked', label: 'Anulată', style: 'danger' };
  if (inv.used_at || (inv.max_uses && Number(inv.use_count) >= Number(inv.max_uses))) return { key: 'used', label: 'Folosită', style: 'neutral' };
  if (expired(inv.expires_at) || expired(inv.access_expires_at)) return { key: 'expired', label: 'Expirată', style: 'neutral' };
  return { key: 'pending', label: Number(inv.use_count) > 0 ? 'Parțial folosită' : 'În așteptare', style: 'warning' };
}
function deviceState(device) {
  if (device.revoked) return { key: 'revoked', label: 'Revocat', style: 'danger' };
  const noAccess = Array.isArray(device.permissions)
    ? !device.permissions.some(p => !expired(p.access_expires_at))
    : expired(device.access_expires_at);
  if (noAccess) return { key: 'expired', label: 'Acces expirat', style: 'neutral' };
  return { key: 'active', label: 'Activ', style: 'success' };
}
const badge = state => `<span class="badge ${state.style}">${esc(state.label)}</span>`;
const roleName = (app, role) => app.invite_profiles?.find(p => p.value === role)?.short_label || app.invite_profiles?.find(p => p.value === role)?.label || role || '';
const noteFor = (app, inv, ttl) => String(app.invite_notes?.[inv.role] || app.invite_note || DEFAULT_NOTE).replaceAll('{days}', String(inv.expires_in_days ?? ttl));
const messageFor = (app, inv, ttl) => String(app.invite_messages?.[inv.role] || app.message || '').replaceAll('{link}', inv.url || '').replaceAll('{days}', String(inv.expires_in_days ?? ttl));
function toast(message) {
  const host = document.querySelector('dialog[open]') || document.body;
  host.append($('toast'));
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
async function copyText(text, button) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch {}
  if (!ok) {
    const field = document.createElement('textarea'); field.value = text; field.readOnly = true;
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    // Clipboard fallback must remain inside the active modal's focus scope.
    const parent = document.querySelector('dialog[open]') || document.body;
    parent.append(field); field.select(); field.setSelectionRange(0, text.length);
    try { ok = document.execCommand('copy'); } catch {}
    field.remove(); button?.focus();
  }
  toast(ok ? 'Copiat în clipboard.' : 'Copierea nu a reușit. Selectează și copiază textul manual.');
}
const appImage = app => `<img class="app-icon" src="${esc(app.icon || 'icons/icon.svg')}" alt="" width="38" height="38">`;
function renderAppLists() {
  const focusedApp = document.activeElement?.closest('[data-app]');
  const focusedList = focusedApp?.parentElement?.id;
  const focusedId = focusedApp?.dataset.app;
  for (const [inputId, listId, mobile] of [['app-search', 'app-list', false], ['mobile-app-search', 'mobile-app-list', true]]) {
    const query = normalize($(inputId).value);
    const ordered = mobile ? [...apps].sort((a, b) => {
      const rank = id => recent.includes(id) ? recent.indexOf(id) : 999;
      return rank(a.id) - rank(b.id);
    }) : apps;
    const matches = ordered.filter(a => normalize(`${a.name} ${a.description || ''}`).includes(query));
    $(listId).innerHTML = matches.map(a => {
      const summary = summaries.get(a.id);
      const status = summary?.error ? 'Nu răspunde' : summary ? `${plural(summary.active, 'dispozitiv', 'dispozitive')} · ${plural(summary.pending, 'invitație', 'invitații')}` : a.description || 'Invitații și dispozitive';
      return `<button type="button" class="app-option${a.id === currentApp?.id ? ' is-selected' : ''}" data-app="${esc(a.id)}"${a.id === currentApp?.id ? ' aria-current="true"' : ''}>${appImage(a)}<span class="app-option-copy"><span class="app-option-name">${esc(a.name)}</span><span class="app-option-meta">${esc(status)}</span></span>${summary?.error ? '<span class="app-indicator" title="Nu răspunde">!</span>' : ''}</button>`;
    }).join('') || '<p class="empty-state">Nicio aplicație găsită.</p>';
  }
  $('app-count').textContent = String(apps.length);
  if (focusedList && focusedId) [...$(focusedList).querySelectorAll('[data-app]')].find(b => b.dataset.app === focusedId)?.focus({ preventScroll: true });
  renderSummary();
}
function renderSummary() {
  if (!currentApp) return;
  const s = summaries.get(currentApp.id);
  $('app-summary').textContent = s?.error ? 'Conexiune indisponibilă' : s ? `${plural(s.active, 'dispozitiv activ', 'dispozitive active')} · ${plural(s.pending, 'invitație disponibilă', 'invitații disponibile')}` : 'Se încarcă situația aplicației…';
}
function storeSummary(app, devices, invites) {
  summaries.set(app.id, { active: devices.filter(d => deviceState(d).key === 'active').length, pending: invites.filter(i => inviteState(i).key === 'pending').length });
}
async function loadOverview() {
  await Promise.allSettled(apps.filter(a => a.id !== currentApp?.id).map(async a => {
    const version = (summaryVersions.get(a.id) || 0) + 1; summaryVersions.set(a.id, version);
    try {
      const [d, i] = await Promise.all([apiFor(a, '/api/admin/devices'), apiFor(a, '/api/admin/invites')]);
      if (summaryVersions.get(a.id) !== version) return;
      if (!Array.isArray(d.devices) || !Array.isArray(i.invites)) throw new Error('Date nevalide');
      storeSummary(a, d.devices, i.invites);
    } catch { if (summaryVersions.get(a.id) === version) summaries.set(a.id, { error: true }); }
  }));
  renderAppLists();
}
function selectApp(id, updateHash = true) {
  const selected = apps.find(a => a.id === id) || apps[0];
  if (!selected) return;
  if (selected === currentApp) { $('app-picker').close(); return; }
  currentApp = selected; selectionVersion++; formVersion++;
  $('invite-dialog').close(); $('app-picker').close();
  recent = [selected.id, ...recent.filter(x => x !== selected.id)].slice(0, 6); writeStored('console:recent', recent);
  if (updateHash && location.hash !== '#' + selected.id) location.hash = selected.id;
  $('app-title').textContent = selected.name; $('mobile-app-name').textContent = selected.name;
  $('app-avatar').innerHTML = appImage(selected);
  $('app-description').textContent = selected.description || 'Invitații și dispozitive';
  document.title = `${selected.name} · Consolă admin`;
  filters.invites = filters.devices = 'all'; queries.invites = queries.devices = '';
  renderAppLists(); setTab('invites'); loadSelected();
}
async function loadSelected() {
  if (!currentApp) return;
  const owner = currentApp, selectedVersion = selectionVersion;
  loadController?.abort(); loadController = new AbortController();
  const controller = loadController;
  summaryVersions.set(owner.id, (summaryVersions.get(owner.id) || 0) + 1);
  view = { app: owner, loading: true, devices: [], invites: [], ttl: 7 };
  $('list-error').hidden = true; $('refresh').disabled = true;
  renderRecords();
  try {
    const [d, i] = await Promise.all([apiFor(owner, '/api/admin/devices', { signal: controller.signal }), apiFor(owner, '/api/admin/invites', { signal: controller.signal })]);
    if (controller.signal.aborted || currentApp !== owner || selectionVersion !== selectedVersion) return;
    if (!Array.isArray(d.devices) || !Array.isArray(i.invites)) throw new Error('Lista primită de la aplicație nu este validă.');
    view = { app: owner, loading: false, devices: d.devices, invites: i.invites, ttl: i.ttl_days ?? 7 };
    storeSummary(owner, d.devices, i.invites); renderAppLists(); renderRecords();
  } catch (error) {
    if (controller.signal.aborted || currentApp !== owner || selectionVersion !== selectedVersion) return;
    view.loading = false; view.error = true; summaries.set(owner.id, { error: true });
    $('list-error-text').textContent = `${owner.name}: ${error.message}`; $('list-error').hidden = false;
    renderAppLists(); renderRecords();
  } finally { if (loadController === controller) $('refresh').disabled = false; }
}
function setTab(next) {
  tab = next;
  for (const key of ['invites', 'devices']) {
    const selected = key === tab;
    $('tab-' + key).setAttribute('aria-selected', String(selected));
    $('tab-' + key).tabIndex = selected ? 0 : -1;
    $(key).hidden = !selected;
  }
  const options = tab === 'invites' ? [['all', 'Toate invitațiile'], ['pending', 'Disponibile'], ['used', 'Folosite'], ['expired', 'Expirate'], ['revoked', 'Anulate']] : [['all', 'Toate dispozitivele'], ['active', 'Active'], ['revoked', 'Revocate'], ['expired', 'Acces expirat']];
  $('list-filter').innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  $('list-filter').value = filters[tab]; $('list-search').value = queries[tab];
  $('list-search').placeholder = tab === 'invites' ? 'Caută o invitație…' : 'Caută un dispozitiv…';
  $('list-search').setAttribute('aria-label', $('list-search').placeholder);
  renderRecords();
}
function emptyState(title, detail, type = 'invite') { return `<div class="empty-state">${icon(type)}<h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`; }
function permissionHtml(owner, record) {
  const permissions = Array.isArray(record.permissions) ? record.permissions : [record];
  return permissions.filter(p => p.role || p.classroom_label || p.child_label || p.access_expires_at).map(p => {
    const scope = p.child_label && p.classroom_label && !p.child_label.includes(p.classroom_label)
      ? `${p.classroom_label} — ${p.child_label}` : p.child_label || p.classroom_label || '';
    return `<div class="permission-line">${p.role ? `<span class="badge neutral">${esc(roleName(owner, p.role))}</span>` : ''}<span>${esc(scope)}</span>${p.access_expires_at ? `<span class="${expired(p.access_expires_at) ? 'error-message' : ''}">${expired(p.access_expires_at) ? 'Acces expirat' : 'Acces până la'} ${esc(dateLabel(p.access_expires_at, true))}</span>` : ''}</div>`;
  }).join('');
}
function menuHtml(label, buttons) { return `<details class="row-menu"><summary class="icon-button" aria-label="${esc(label)}">${icon('more')}</summary><div class="menu-items">${buttons}</div></details>`; }
function inviteHtml(owner, inv) {
  const state = inviteState(inv), live = state.key === 'pending' && !!inv.code;
  const usage = Number(inv.max_uses) > 1 ? `${Number(inv.use_count) || 0} din ${Number(inv.max_uses)} activări` : '';
  const expiry = state.key === 'pending' ? `Expiră ${remaining(inv.expires_at)}` : state.key === 'used' ? (inv.used_at ? `Folosită ${when(inv.used_at)}` : 'Toate activările folosite') : state.key === 'expired' ? `Expirată ${dateLabel(expired(inv.access_expires_at) ? inv.access_expires_at : inv.expires_at, expired(inv.access_expires_at))}` : 'Codul nu mai poate fi folosit';
  const menu = state.key === 'pending' ? menuHtml('Acțiuni pentru ' + (inv.label || 'invitație'), `<button type="button" data-action="cancel" data-id="${esc(inv.id)}" class="danger">Anulează invitația</button>`) : '';
  return `<article class="record" data-record-id="${esc(inv.id)}"><div class="record-main"><div class="record-icon">${icon('invite')}</div><div class="record-content"><div class="record-title"><h3>${esc(inv.label || 'Fără etichetă')}</h3>${badge(state)}</div><p class="record-meta">${esc(expiry)}${usage ? ` <span aria-hidden="true">·</span> ${esc(usage)}` : ''}</p>${permissionHtml(owner, inv)}</div><div class="record-actions">${live && inv.url ? `<button type="button" class="btn secondary small" data-action="message" data-id="${esc(inv.id)}">Copiază mesajul</button>` : ''}${menu}</div></div><div class="record-footer"><span>Creată ${esc(when(inv.created_at))} <span aria-hidden="true">·</span> #${esc(inv.id)}</span>${live ? `<button type="button" class="code-copy" data-action="code" data-id="${esc(inv.id)}" title="Copiază codul"><code>${esc(inv.code)}</code><span>Copiază</span></button>` : ''}</div></article>`;
}
function deviceHtml(owner, device) {
  const state = deviceState(device);
  const notifications = owner.push !== false && state.key === 'active' && !device.has_push ? '<span class="badge warning">Fără notificări</span>' : '';
  return `<article class="record" data-record-id="${esc(device.id)}"><div class="record-main"><div class="record-icon">${icon('device')}</div><div class="record-content"><div class="record-title"><h3>${esc(device.label || `Dispozitiv ${device.id}`)}</h3>${badge(state)}${notifications}</div><p class="record-meta">Ultima activitate: ${esc(when(device.last_seen))}</p>${permissionHtml(owner, device)}</div><div class="record-actions">${menuHtml('Acțiuni pentru ' + (device.label || 'dispozitiv'), `<button type="button" data-action="rename" data-id="${esc(device.id)}">Redenumește</button><button type="button" data-action="${device.revoked ? 'restore' : 'revoke'}" data-id="${esc(device.id)}">${device.revoked ? 'Restaurează accesul' : 'Revocă accesul'}</button><button type="button" class="danger" data-action="delete" data-id="${esc(device.id)}">Șterge dispozitivul</button>`)}</div></div><div class="record-footer"><span>Înregistrat ${esc(when(device.created_at))} <span aria-hidden="true">·</span> #${esc(device.id)}</span></div></article>`;
}
function renderRecords() {
  const container = $(tab);
  if (!view || view.app !== currentApp || view.loading) {
    container.innerHTML = '<div class="empty-state" role="status"><span class="loading-dot"></span><p>Se încarcă…</p></div>';
    $('results-caption').textContent = ''; return;
  }
  if (view.error) { container.innerHTML = ''; $('results-caption').textContent = ''; return; }
  const owner = currentApp, query = normalize(queries[tab]), all = view[tab];
  const stateOf = tab === 'invites' ? inviteState : deviceState;
  const records = all.filter(r => (filters[tab] === 'all' || stateOf(r).key === filters[tab]) && normalize([r.label, r.id, r.code, r.role, roleName(owner, r.role), r.classroom_label, r.child_label, ...(r.permissions || []).flatMap(p => [p.classroom_label, p.child_label, roleName(owner, p.role)])].join(' ')).includes(query));
  records.sort((a, b) => {
    const active = tab === 'invites' ? 'pending' : 'active';
    return Number(stateOf(b).key === active) - Number(stateOf(a).key === active) || (timestamp(b.created_at) || 0) - (timestamp(a.created_at) || 0);
  });
  $('results-caption').textContent = records.length === all.length ? plural(all.length, tab === 'invites' ? 'invitație' : 'dispozitiv', tab === 'invites' ? 'invitații' : 'dispozitive') : `${records.length} din ${all.length} rezultate`;
  if (!records.length) {
    container.innerHTML = all.length ? emptyState('Niciun rezultat', 'Încearcă alt nume sau schimbă filtrul.', 'search') : tab === 'invites' ? emptyState('Prima invitație începe aici', 'Creează o invitație și trimite accesul mai departe.') : emptyState('Niciun dispozitiv încă', 'Dispozitivele apar aici după activarea unei invitații.', 'device');
    return;
  }
  const kind = tab, snapshot = view;
  container.innerHTML = records.map(r => kind === 'invites' ? inviteHtml(owner, r) : deviceHtml(owner, r)).join('');
  container.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const record = snapshot[kind].find(r => String(r.id) === button.dataset.id);
    if (record) recordAction(owner, kind, record, button.dataset.action, button, snapshot.ttl);
  }));
  container.querySelectorAll('.row-menu').forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) container.querySelectorAll('.row-menu[open]').forEach(other => { if (other !== menu) other.open = false; });
  }));
}
async function recordAction(owner, kind, record, action, button, ttl) {
  if (button.disabled) return;
  if (action === 'code') return copyText(record.code, button);
  if (action === 'message') return copyText(messageFor(owner, record, ttl), button);
  const id = encodeURIComponent(record.id), path = `/api/admin/${kind}/${id}`;
  let endpoint = path, body, method = 'POST';
  if (action === 'rename') {
    const label = prompt(`Numele dispozitivului din ${owner.name}`, record.label || '');
    if (label === null) return;
    endpoint += '/label'; body = { label: label.trim() };
  } else if (action === 'cancel') {
    if (!confirm(`Anulezi invitația „${record.label || record.id}” din ${owner.name}? Codul nu va mai putea activa dispozitive.`)) return;
    endpoint += '/revoke';
  } else if (action === 'delete') {
    const note = owner.device_delete_note || 'Dispozitivul și datele asociate lui pot fi șterse definitiv de pe server. Va avea nevoie de acces nou.';
    if (!confirm(`Ștergi „${record.label || record.id}” din ${owner.name}? ${note}`)) return;
    method = 'DELETE';
  } else {
    if (action === 'revoke' && !confirm(`Revoci accesul pentru „${record.label || record.id}” din ${owner.name}? ${owner.device_revoke_note || (owner.push === false ? 'Dispozitivul pierde imediat accesul.' : 'Dispozitivul pierde accesul și nu mai primește notificări.')}`)) return;
    endpoint += '/revoke'; body = { revoked: action === 'revoke' };
  }
  button.disabled = true;
  try {
    await apiFor(owner, endpoint, { body, method });
    toast(`Modificare salvată în ${owner.name}.`);
    if (currentApp === owner) loadSelected();
    else { summaries.delete(owner.id); renderAppLists(); }
  } catch (error) { toast(`${owner.name}: ${error.message}`); }
  finally { button.disabled = false; button.closest('.row-menu')?.removeAttribute('open'); }
}
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function defaultExpiry(profile) {
  if (profile?.expiry_default !== 'school-year-end') return '';
  const today = new Date(), year = today.getMonth() >= 6 ? today.getFullYear() + 1 : today.getFullYear();
  return `${year}-06-30`;
}
function profileSelected() { return formApp?.invite_profiles?.find(p => p.value === $('invite-role').value); }
function normalizeOptions(options, owner) {
  if (owner.invite_scope !== 'classroom') return { classes: [], children: options.children || [] };
  const classes = [], children = [];
  for (const item of options.children || []) {
    if (String(item.id).startsWith('classroom:')) classes.push({ id: item.id.slice(10), name: item.name.replace(/ — întreaga clasă$/, '') });
    else {
      const match = String(item.id).match(/^child:([^:]+):(.+)$/);
      if (match) children.push({ id: match[2], classroomId: match[1], name: item.name });
    }
  }
  for (const child of children) {
    const prefix = classes.find(c => c.id === child.classroomId)?.name + ' — ';
    if (child.name.startsWith(prefix)) child.name = child.name.slice(prefix.length);
  }
  return { classes, children };
}
function updateChildren() {
  const previous = $('invite-child').value;
  const children = formOptions.children.filter(c => formApp.invite_scope !== 'classroom' || c.classroomId === $('invite-class').value);
  $('invite-child').innerHTML = '<option value="">Alege copilul</option>' + children.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (children.some(c => String(c.id) === previous)) $('invite-child').value = previous;
  updateProfile();
}
function updateProfile() {
  const profile = profileSelected(), child = !!profile?.requires_child, expiry = !!profile?.requires_expiry;
  $('invite-child-wrap').hidden = !child; $('invite-child').required = child; $('invite-child').disabled = !child || !optionsReady;
  $('invite-expiry-wrap').hidden = !expiry; $('invite-expiry').required = expiry; $('invite-expiry').disabled = !expiry;
  if (expiry && !$('invite-expiry').value) $('invite-expiry').value = defaultExpiry(profile);
  $('invite-expiry').min = localDate();
  $('invite-role-note').textContent = profile?.description || '';
  $('invite-form-note').textContent = noteFor(formApp, { role: profile?.value }, view?.app === formApp ? view.ttl : 7);
  const needsOptions = formApp.invite_scope === 'classroom' || child;
  $('invite-submit').disabled = submitting || (needsOptions && (!optionsReady || (formApp.invite_scope === 'classroom' && !formOptions.classes.length)));
}
async function openInvite() {
  if (!currentApp || submitting) return;
  const owner = currentApp, version = ++formVersion; formApp = owner;
  formOptions = { classes: [], children: [] }; optionsReady = false;
  $('form-invite').reset(); $('form-invite').hidden = false; $('invite-result').hidden = true;
  $('invite-err').hidden = true; $('invite-create-another').hidden = true;
  $('invite-dialog-app').textContent = owner.name;
  const profiles = owner.invite_profiles || [], scoped = owner.invite_scope === 'classroom';
  $('invite-access').hidden = !profiles.length && !scoped;
  $('invite-role-wrap').hidden = !profiles.length; $('invite-role').disabled = !profiles.length;
  $('invite-role').innerHTML = profiles.map(p => `<option value="${esc(p.value)}">${esc(p.label)}</option>`).join('');
  $('invite-class-wrap').hidden = !scoped; $('invite-class').required = scoped; $('invite-class').disabled = !scoped;
  $('invite-class').innerHTML = '<option value="">Se încarcă clasele…</option>';
  $('invite-child').innerHTML = ''; $('invite-expiry').value = '';
  updateProfile();
  if (!$('invite-dialog').open) $('invite-dialog').showModal();
  $('invite-label').focus();
  if (!scoped && !profiles.some(p => p.requires_child)) { optionsReady = true; updateProfile(); return; }
  try {
    const options = await apiFor(owner, owner.invite_options_endpoint || '/api/admin/invite-options');
    if (version !== formVersion || formApp !== owner || currentApp !== owner) return;
    formOptions = normalizeOptions(options, owner); optionsReady = true;
    $('invite-class').innerHTML = '<option value="">Alege clasa</option>' + formOptions.classes.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if (formOptions.classes.length === 1) $('invite-class').value = formOptions.classes[0].id;
    if (scoped && !formOptions.classes.length) throw new Error('Nicio clasă disponibilă pentru invitații.');
    updateChildren();
  } catch (error) {
    if (version !== formVersion || currentApp !== owner) return;
    optionsReady = false; updateProfile();
    $('invite-err').textContent = `Opțiunile nu au putut fi încărcate. ${error.message} Închide și redeschide formularul pentru a reîncerca.`; $('invite-err').hidden = false;
  }
}
function showInvite(owner, inv, ttl) {
  const msg = messageFor(owner, inv, ttl);
  $('form-invite').hidden = true; $('invite-result').hidden = false; $('invite-create-another').hidden = false;
  $('invite-result').innerHTML = `<div class="invite-success">${icon('check')}<div><h3>Invitația este gata</h3><p>Trimite accesul pentru ${esc(owner.name)}.</p></div></div><div class="result-field"><span>Cod de acces</span><div class="result-value"><code>${esc(inv.code)}</code><button type="button" class="btn secondary small" data-result-copy="code">Copiază</button></div></div>${inv.url ? `<div class="result-field"><span>Link de activare</span><div class="result-value"><span class="result-url">${esc(inv.url)}</span><button type="button" class="btn secondary small" data-result-copy="url">Copiază</button></div></div><div class="result-actions"><button type="button" class="btn primary" data-result-copy="message">Copiază mesajul complet</button><a class="btn secondary" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(msg)}">WhatsApp</a></div>` : ''}<p class="note">${esc(noteFor(owner, inv, ttl))}</p>`;
  $('invite-result').querySelectorAll('[data-result-copy]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.resultCopy === 'message' ? msg : inv[b.dataset.resultCopy], b)));
  $('invite-result').querySelector('button')?.focus();
}
$('form-invite').addEventListener('submit', async event => {
  event.preventDefault(); if (submitting || !formApp || !$('form-invite').reportValidity()) return;
  const owner = formApp, version = formVersion, profile = profileSelected(), ttl = view?.app === owner ? view.ttl : 7;
  const body = { label: $('invite-label').value.trim() };
  if (profile) body.role = profile.value;
  if (owner.invite_scope === 'classroom') body.classroomId = $('invite-class').value;
  if (profile?.requires_child) body.childId = $('invite-child').value;
  if (profile?.requires_expiry) body.accessExpiresAt = $('invite-expiry').value;
  submitting = true; $('invite-submit').disabled = true; $('close-invite').disabled = true;
  $('invite-submit').textContent = 'Se creează…'; $('invite-err').hidden = true;
  try {
    const inv = await apiFor(owner, '/api/admin/invites', { body });
    if (currentApp === owner && formVersion === version) showInvite(owner, { ...body, ...inv }, ttl);
    else toast(`Invitație creată în ${owner.name}. O găsești în lista aplicației.`);
    if (currentApp === owner) loadSelected();
  } catch (error) {
    if (currentApp === owner && formVersion === version) { $('invite-err').textContent = error.message; $('invite-err').hidden = false; }
    else toast(`${owner.name}: ${error.message}`);
  } finally {
    submitting = false; $('invite-submit').textContent = 'Creează invitație'; $('close-invite').disabled = false;
    if (formVersion === version) updateProfile();
  }
});
for (const listId of ['app-list', 'mobile-app-list']) $(listId).addEventListener('click', e => { const b = e.target.closest('[data-app]'); if (b) selectApp(b.dataset.app); });
for (const id of ['app-search', 'mobile-app-search']) $(id).addEventListener('input', renderAppLists);
$('open-picker').addEventListener('click', () => { $('mobile-app-search').value = ''; renderAppLists(); $('app-picker').showModal(); $('mobile-app-search').focus(); });
$('close-picker').addEventListener('click', () => $('app-picker').close());
$('new-invite').addEventListener('click', openInvite);
$('invite-create-another').addEventListener('click', openInvite);
$('close-invite').addEventListener('click', () => { if (!submitting) $('invite-dialog').close(); });
$('invite-dialog').addEventListener('cancel', e => { if (submitting) e.preventDefault(); });
$('invite-dialog').addEventListener('close', () => { formVersion++; });
$('invite-class').addEventListener('change', () => { $('invite-child').value = ''; updateChildren(); });
$('invite-role').addEventListener('change', updateProfile);
$('refresh').addEventListener('click', loadSelected);
$('retry-load').addEventListener('click', () => { if (apps.length) loadSelected(); else boot(); });
for (const name of ['invites', 'devices']) {
  $('tab-' + name).addEventListener('click', () => setTab(name));
  $('tab-' + name).addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const next = e.key === 'Home' ? 'invites' : e.key === 'End' ? 'devices' : tab === 'invites' ? 'devices' : 'invites';
      setTab(next); $('tab-' + next).focus();
    }
  });
}
$('list-search').addEventListener('input', () => { queries[tab] = $('list-search').value; renderRecords(); });
$('list-filter').addEventListener('change', () => { filters[tab] = $('list-filter').value; renderRecords(); });
document.addEventListener('click', e => { if (!e.target.closest('.row-menu')) document.querySelectorAll('.row-menu[open]').forEach(el => { el.open = false; }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.row-menu[open]').forEach(el => { el.open = false; el.querySelector('summary').focus(); }); });
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (apps.some(a => a.id === id)) selectApp(id, false);
});
async function boot() {
  $('new-invite').disabled = true; $('refresh').disabled = true;
  try {
    const response = await fetch('apps.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Lista aplicațiilor nu a putut fi încărcată.');
    const data = await response.json();
    if (!Array.isArray(data) || !data.length || data.some(a => !a.id || !a.name || typeof a.api !== 'string')) throw new Error('Lista aplicațiilor lipsește sau nu este validă.');
    apps = data; $('new-invite').disabled = false;
    selectApp(location.hash.slice(1) || recent[0] || apps[0].id); loadOverview();
  } catch (error) {
    $('list-error-text').textContent = error.message; $('list-error').hidden = false;
    $('app-title').textContent = 'Aplicațiile nu sunt disponibile';
    $('app-description').textContent = 'Reîncearcă încărcarea consolei.';
    $('invites').innerHTML = ''; $('devices').innerHTML = '';
  }
}
boot();
