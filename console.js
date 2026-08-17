/* One console for the three invite-gated apps. Served only on the tailnet
   listener, which is what injects X-Admin on the way to each API -- this page
   carries no credential of its own and would get 404s from any public URL.

   All three servers sit behind the same listener under different prefixes, so
   one origin reaches all of them and nothing here needs CORS. */
'use strict';

/* Every app this console fronts, loaded rather than compiled in: adding one is
   an entry in apps.json plus a route on the listener, with no code change
   here. An app qualifies by exposing the invite endpoints the others do --
   see README. */
let APPS = [];

/* {link} is the invite url, {days} its lifetime. Everything else in the
   message is that app's own words. */
const fillMessage = (tpl, inv, ttl) => String(tpl)
  .replaceAll('{link}', inv.url || '')
  .replaceAll('{days}', String(inv.expires_in_days ?? ttl));


const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let app = APPS[0];
let ttlDays = 7;
let invites = [];

/* `method` is explicit for anything that is not a GET. It used to be inferred
   from whether a body was present, so a POST with nothing to send -- revoking
   an invite -- went out as a GET and came back 405. */
const api = (path, body, method) =>
  fetch(app.api + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `Cererea a eșuat (${r.status})`);
    return data;
  });

/* Plain HTTP on the tailnet is not a secure context, so navigator.clipboard
   does not exist here; execCommand is the only path left. */
async function copy(text, btn) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { ok = false; }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
  }
  if (btn) {
    const was = btn.textContent;
    btn.textContent = ok ? 'Copiat' : 'Selectează manual';
    setTimeout(() => { btn.textContent = was; }, 1600);
  }
}

/* Romanian counts: one form for 1, another for 2..19, and "de" from 20 up.
   Rendering "1 dispozitive" is the sort of thing that makes a tool feel
   unfinished. */
const plural = (n, one, few) =>
  `${n} ${n === 1 ? one : n % 100 >= 20 || n % 100 === 0 ? `de ${few}` : few}`;

/* Wraps a click handler so a failed request says so. Without this the promise
   rejects into nothing and the button simply appears inert, which is exactly
   how the revoke above went unnoticed. */
const act = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (ex) {
    alert(ex.message || 'Cererea a eșuat.');
  }
};

const when = (iso) => {
  if (!iso) return 'niciodată';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'chiar acum';
  if (mins < 60) return `acum ${mins} min`;
  if (mins < 60 * 24) return `acum ${Math.round(mins / 60)} h`;
  return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
};

const until = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'a expirat';
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'în mai puțin de o oră';
  if (hours < 48) return `în ${hours} h`;
  return `în ${Math.round(hours / 24)} zile`;
};

/* -------------------------------------------------------------- overview -- */
/* Counts for every app, carried in the picker itself: a card each took most of
   a phone screen before the first device row, and this is a tool for glancing
   at one app and acting on it. One app being down must not take the others
   with it, hence the per-app catch. */
const summaries = new Map();

async function loadOverview() {
  await Promise.all(APPS.map(async (a) => {
    try {
      const [d, i] = await Promise.all([
        fetch(`${a.api}/api/admin/devices`).then((r) => r.json()),
        fetch(`${a.api}/api/admin/invites`).then((r) => r.json()),
      ]);
      const now = Date.now();
      const pending = i.invites.filter(
        (x) => !x.used_at && new Date(x.expires_at).getTime() > now).length;
      const active = d.devices.filter((x) => !x.revoked).length;
      summaries.set(a.id, {
        short: `${active} · ${pending}`,
        long: `${plural(active, 'dispozitiv', 'dispozitive')} · ${pending
          ? plural(pending, 'invitație în așteptare', 'invitații în așteptare')
          : 'nicio invitație în așteptare'}`,
      });
    } catch {
      summaries.set(a.id, { short: '!', long: 'nu răspunde' });
    }
  }));
  renderPicker();
}

/* One line: the app, and what is waiting on it. */
function renderPicker() {
  const sel = $('appsel');
  sel.innerHTML = APPS.map((a) => {
    const s = summaries.get(a.id);
    return `<option value="${esc(a.id)}"${a.id === app.id ? ' selected' : ''}>${
      esc(a.name)}${s ? ` — ${s.short}` : ''}</option>`;
  }).join('');
  const mine = summaries.get(app.id);
  $('appsub').textContent = mine ? mine.long : 'se încarcă…';
  $('appsub').classList.toggle('down', !!mine && mine.long === 'nu răspunde');
}

function renderTabs() {
  renderPicker();
  $('foot').textContent =
    `${APPS.length} aplicații · consola este singura interfață de administrare.`;
}

function select(id) {
  app = APPS.find((a) => a.id === id) || APPS[0];
  location.hash = app.id;
  $('invite-result').hidden = true;
  $('invite-err').hidden = true;
  renderTabs();
  load();
}

/* --------------------------------------------------------------- invites -- */
$('form-invite').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('invite-err');
  err.hidden = true;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Se creează…';
  try {
    const inv = await api('/api/admin/invites', { label: $('invite-label').value.trim() });
    $('invite-label').value = '';
    showInvite(inv);
    await load();
    loadOverview();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Creează invitație';
  }
});

function showInvite(inv) {
  const box = $('invite-result');
  const msg = fillMessage(app.message, inv, ttlDays);
  box.hidden = false;
  box.innerHTML = `
    ${inv.url ? `<div class="field">
      <label for="v-link">Link</label>
      <div class="val" id="v-link">${esc(inv.url)}</div>
      <button class="btn small" data-copy="${esc(inv.url)}">Copiază</button>
    </div>` : ''}
    <div class="field">
      <label for="v-code">Cod</label>
      <div class="val code-big" id="v-code">${esc(inv.code)}</div>
      <button class="btn small" data-copy="${esc(inv.code)}">Copiază</button>
    </div>
    ${inv.url ? `<div class="field">
      <label for="v-msg">Mesaj</label>
      <div class="val" id="v-msg">Mesaj complet pentru ${esc(app.name)}</div>
      <button class="btn small" data-copy-msg="1">Copiază mesajul</button>
      <a class="btn small ghost" target="_blank" rel="noopener"
         href="https://wa.me/?text=${encodeURIComponent(msg)}">WhatsApp</a>
    </div>` : ''}
    <p class="note">
      Un singur dispozitiv, expiră în ${esc(inv.expires_in_days ?? ttlDays)} zile.
      În prima oră de la folosire codul re-leagă <em>același</em> dispozitiv, nu
      înregistrează altul.
    </p>`;
  box.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => copy(b.dataset.copy, b)));
  box.querySelectorAll('[data-copy-msg]').forEach((b) =>
    b.addEventListener('click', () => copy(msg, b)));
}

/* -------------------------------------------------------------- listings -- */
async function load() {
  $('devices').innerHTML = '<p class="empty">Se încarcă…</p>';
  $('invites').innerHTML = '';
  try {
    const [d, i] = await Promise.all([
      api('/api/admin/devices'),
      api('/api/admin/invites'),
    ]);
    ttlDays = i.ttl_days ?? ttlDays;
    invites = i.invites;
    renderDevices(d.devices);
    renderInvites(i.invites);
  } catch (ex) {
    $('devices').innerHTML = `<p class="err">${esc(ex.message)}</p>`;
    $('invites').innerHTML = '';
  }
}

function renderDevices(devices) {
  if (!devices.length) {
    $('devices').innerHTML = '<p class="empty">Niciun dispozitiv înregistrat.</p>';
    return;
  }
  $('devices').innerHTML = devices.map((d) => `
    <div class="item${d.revoked ? ' off' : ''}">
      <div class="grow">
        <div class="name">${esc(d.label || `Dispozitiv ${d.id}`)}
          <span class="pill ${d.revoked ? 'bad' : 'ok'}">${d.revoked ? 'revocat' : 'activ'}</span>
          ${d.has_push ? '' : '<span class="pill warn">fără notificări</span>'}
        </div>
        <div class="meta">
          #${d.id} · înregistrat ${esc(when(d.created_at))}
          · văzut ultima dată ${esc(when(d.last_seen))}
        </div>
      </div>
      <button class="btn small ghost" data-rename="${d.id}">Redenumește</button>
      <button class="btn small ghost" data-revoke="${d.id}" data-to="${d.revoked ? 0 : 1}">
        ${d.revoked ? 'Restaurează' : 'Revocă'}
      </button>
      <button class="btn small danger" data-forget="${d.id}">Șterge</button>
    </div>`).join('');

  /* A device is named after the invite that registered it, which is whoever
     the invite was minted for rather than whoever redeemed it. */
  $('devices').querySelectorAll('[data-rename]').forEach((b) =>
    b.addEventListener('click', act(async () => {
      const row = b.closest('.item').querySelector('.name');
      const now = row ? row.firstChild.textContent.trim() : '';
      const label = prompt('Eticheta dispozitivului (ex. „Ana — iPhone”)', now);
      if (label === null) return;
      await api(`/api/admin/devices/${b.dataset.rename}/label`, { label });
      load();
    })));

  $('devices').querySelectorAll('[data-revoke]').forEach((b) =>
    b.addEventListener('click', act(async () => {
      const on = b.dataset.to === '1';
      if (on && !confirm(`Revoci acest dispozitiv din ${app.name}? `
                       + 'Pierde imediat accesul și nu mai primește notificări.')) return;
      await api(`/api/admin/devices/${b.dataset.revoke}/revoke`, { revoked: on });
      load(); loadOverview();
    })));

  $('devices').querySelectorAll('[data-forget]').forEach((b) =>
    b.addEventListener('click', act(async () => {
      if (!confirm(`Ștergi definitiv acest dispozitiv din ${app.name}? `
                 + 'Datele lui de pe server se pierd și va avea nevoie de o '
                 + 'invitație nouă.')) return;
      await api(`/api/admin/devices/${b.dataset.forget}`, null, 'DELETE');
      load(); loadOverview();
    })));
}

function renderInvites(list) {
  if (!list.length) {
    $('invites').innerHTML = '<p class="empty">Nicio invitație.</p>';
    return;
  }
  const now = Date.now();
  $('invites').innerHTML = list.map((i) => {
    const expired = !i.used_at && new Date(i.expires_at).getTime() < now;
    const state = i.used_at ? ['ok', `folosită ${when(i.used_at)}`]
      : expired ? ['bad', 'expirată']
      : ['warn', 'în așteptare'];
    // The plaintext exists only while the invite can still register something.
    const live = i.code && !i.used_at && !expired;
    return `
      <div class="item${i.used_at || expired ? ' off' : ''}">
        <div class="grow">
          <div class="name">${esc(i.label || 'fără etichetă')}
            <span class="pill ${state[0]}">${esc(state[1])}</span>
          </div>
          <div class="meta">
            #${i.id} · creată ${esc(when(i.created_at))}
            ${i.used_at
              // device_id is ON DELETE SET NULL, so a used invite whose device
              // was later deleted legitimately points at nothing.
              ? (i.device_id ? `· dispozitiv #${i.device_id}` : '· dispozitiv șters')
              : `· expiră ${esc(until(i.expires_at))}`}
            ${live ? `· <span class="code">${esc(i.code)}</span>` : ''}
          </div>
        </div>
        ${live && i.url ? `<button class="btn small ghost" data-msg="${i.id}">Mesaj</button>` : ''}
        ${live ? `<button class="btn small ghost" data-copy="${esc(i.code)}">Copiază</button>` : ''}
        ${!i.used_at ? `<button class="btn small danger" data-unvite="${i.id}">Anulează</button>` : ''}
      </div>`;
  }).join('');

  $('invites').querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => copy(b.dataset.copy, b)));

  $('invites').querySelectorAll('[data-msg]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = invites.find((x) => String(x.id) === b.dataset.msg);
      copy(fillMessage(app.message, i, ttlDays), b);
    }));

  $('invites').querySelectorAll('[data-unvite]').forEach((b) =>
    b.addEventListener('click', act(async () => {
      if (!confirm('Anulezi această invitație? Codul nu va mai putea fi folosit.')) return;
      await api(`/api/admin/invites/${b.dataset.unvite}/revoke`, null, 'POST');
      load(); loadOverview();
    })));
}

/* Registered relative to this file, so the worker's scope is the console's
   own directory and nothing else on the listener is touched. Needs a secure
   context: the tailnet is served over HTTPS by `tailscale serve`, and over
   plain HTTP this simply does nothing. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => { /* http, or the browser has no worker support */ });
}

(async function boot() {
  try {
    APPS = await (await fetch('apps.json', { cache: 'no-cache' })).json();
  } catch {
    $('overview').innerHTML = '<p class="err">apps.json nu a putut fi citit.</p>';
    return;
  }
  if (!APPS.length) {
    $('overview').innerHTML = '<p class="empty">Nicio aplicație configurată.</p>';
    return;
  }
  $('appsel').addEventListener('change', (e) => select(e.target.value));
  select((location.hash || '').replace('#', '') || APPS[0].id);
  loadOverview();
}());
