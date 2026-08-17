/* One console for the three invite-gated apps. Served only on the tailnet
   listener, which is what injects X-Admin on the way to each API -- this page
   carries no credential of its own and would get 404s from any public URL.

   All three servers sit behind the same listener under different prefixes, so
   one origin reaches all of them and nothing here needs CORS. */
'use strict';

const APPS = [
  {
    id: 'trains',
    name: 'Întârzieri',
    api: '',                       // mounted at the listener's root
    admin: '/admin/',
    message: (inv, ttl) => [
      'Salut! Îți trimit acces la Întârzieri — urmărește trenurile CFR și te',
      'anunță când întârzie.',
      '',
      '1) Deschide linkul:',
      inv.url,
      '',
      '2) Adaugă pagina pe ecranul principal:',
      '• Android (Chrome): butonul „Instalează” din banner, sau meniul ⋮ →',
      '  „Adaugă la ecranul principal”',
      '• iPhone (Safari): butonul de partajare → „Add to Home Screen”',
      '',
      '3) Deschide aplicația de pe ecranul principal și apasă linkul de mai sus',
      'din nou — codul se completează singur. Apasă „Activează”.',
      '',
      `Codul e valabil ${ttl} zile și înregistrează un singur telefon.`,
      'Notificările merg doar din aplicația instalată.',
    ].join('\n'),
  },
  {
    id: 'bp',
    name: 'wBP Digitizer',
    api: '/bp',
    admin: '/bp-admin/',
    message: (inv, ttl) => [
      'Salut! Îți trimit acces la wBP Digitizer — o aplicație pentru urmărirea',
      'tensiunii arteriale. Măsurătorile rămân pe telefonul tău, nu se trimit nicăieri.',
      '',
      '1) Deschide linkul:',
      inv.url,
      '',
      '2) Pagina îți cere să adaugi aplicația pe ecranul principal. Fă asta:',
      '• Android (Chrome): butonul „Instalează” din banner, sau meniul ⋮ →',
      '  „Adaugă la ecranul principal”',
      '• iPhone (Safari): butonul de partajare → „Add to Home Screen”',
      '',
      '3) Apasă linkul de mai sus din nou. Dacă se deschide direct în aplicație,',
      'gata — e activată.',
      '',
      '4) Dacă se deschide tot în browser (pe iPhone așa se întâmplă), apasă pe',
      'pagină „Copiază codul”, deschide aplicația de pe ecranul principal, apasă',
      'butonul camerei (cel cu lacăt) și lipește codul acolo.',
      '',
      'Linkul poate fi deschis de câte ori e nevoie — nu se consumă nimic până',
      `nu introduci codul în aplicație. Valabil ${ttl} zile, un singur telefon.`,
    ].join('\n'),
  },
  {
    id: 'thermo',
    name: 'Termometru',
    api: '/thermo',
    admin: '/thermo-admin/',
    message: (inv, ttl) => [
      'Salut! Îți trimit acces la Termometru — temperatura din casă, cu istoric',
      'și alerte când iese din interval.',
      '',
      '1) Deschide linkul:',
      inv.url,
      '',
      '2) Adaugă pagina pe ecranul principal:',
      '• Android (Chrome): butonul „Instalează” din banner, sau meniul ⋮ →',
      '  „Adaugă la ecranul principal”',
      '• iPhone (Safari): butonul de partajare → „Add to Home Screen”',
      '',
      '3) Deschide aplicația de pe ecranul principal și apasă linkul de mai sus',
      'din nou — codul se completează singur. Apasă „Activează”.',
      '',
      `Codul e valabil ${ttl} zile și înregistrează un singur telefon.`,
      'Notificările merg doar din aplicația instalată.',
    ].join('\n'),
  },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let app = APPS[0];
let ttlDays = 7;
let invites = [];

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
/* Counts for every app at once, so the console opens on the question it exists
   to answer: is anything waiting for me. One app being down must not take the
   others with it, hence the per-app catch. */
async function loadOverview() {
  const cards = await Promise.all(APPS.map(async (a) => {
    try {
      const [d, i] = await Promise.all([
        fetch(`${a.api}/api/admin/devices`).then((r) => r.json()),
        fetch(`${a.api}/api/admin/invites`).then((r) => r.json()),
      ]);
      const now = Date.now();
      const pending = i.invites.filter(
        (x) => !x.used_at && new Date(x.expires_at).getTime() > now).length;
      const active = d.devices.filter((x) => !x.revoked).length;
      return `<button class="ov-card" data-go="${a.id}">
          <span class="name">${esc(a.name)}</span>
          <span class="nums">${active} dispozitive · ${pending} invitații în așteptare</span>
        </button>`;
    } catch {
      return `<button class="ov-card down" data-go="${a.id}">
          <span class="name">${esc(a.name)}</span>
          <span class="nums">nu răspunde</span>
        </button>`;
    }
  }));
  $('overview').innerHTML = cards.join('');
  $('overview').querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => select(b.dataset.go)));
}

/* ------------------------------------------------------------------ tabs -- */
function renderTabs() {
  $('apptabs').innerHTML = APPS.map((a) =>
    `<button data-app="${a.id}" aria-pressed="${a.id === app.id}">${esc(a.name)}</button>`).join('');
  $('apptabs').querySelectorAll('[data-app]').forEach((b) =>
    b.addEventListener('click', () => select(b.dataset.app)));
  $('foot').innerHTML =
    `Pagina fiecărei aplicații: ${APPS.map((a) =>
      `<a href="${a.admin}">${esc(a.name)}</a>`).join(' · ')}`;
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
  const msg = app.message(inv, inv.expires_in_days ?? ttlDays);
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
      <button class="btn small ghost" data-revoke="${d.id}" data-to="${d.revoked ? 0 : 1}">
        ${d.revoked ? 'Restaurează' : 'Revocă'}
      </button>
      <button class="btn small danger" data-forget="${d.id}">Șterge</button>
    </div>`).join('');

  $('devices').querySelectorAll('[data-revoke]').forEach((b) =>
    b.addEventListener('click', async () => {
      const on = b.dataset.to === '1';
      if (on && !confirm(`Revoci acest dispozitiv din ${app.name}? `
                       + 'Pierde imediat accesul și nu mai primește notificări.')) return;
      await api(`/api/admin/devices/${b.dataset.revoke}/revoke`, { revoked: on });
      load(); loadOverview();
    }));

  $('devices').querySelectorAll('[data-forget]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Ștergi definitiv acest dispozitiv din ${app.name}? `
                 + 'Datele lui de pe server se pierd și va avea nevoie de o '
                 + 'invitație nouă.')) return;
      await api(`/api/admin/devices/${b.dataset.forget}`, null, 'DELETE');
      load(); loadOverview();
    }));
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
      copy(app.message(i, ttlDays), b);
    }));

  $('invites').querySelectorAll('[data-unvite]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Anulezi această invitație? Codul nu va mai putea fi folosit.')) return;
      await api(`/api/admin/invites/${b.dataset.unvite}/revoke`);
      load(); loadOverview();
    }));
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

select((location.hash || '').replace('#', '') || APPS[0].id);
loadOverview();
