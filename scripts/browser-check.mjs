/* Synthetic browser integration checks. Every browser request is intercepted;
   the harness never reads or changes an app's live administration data.

   Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
        node scripts/browser-check.mjs
   Optional: CDP_URL, SCREENSHOT_DIR. Without CDP_URL, uses localhost:9222.
   With BROWSER_LAUNCH=1, starts its own headless Chromium instead. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotDir = process.env.SCREENSHOT_DIR || '/tmp';
let playwright;
if (process.env.PLAYWRIGHT_MODULE) {
  playwright = await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href);
} else {
  try { playwright = await import('playwright'); }
  catch {
    playwright = await import(pathToFileURL(path.resolve(root, '../stencil-cnc/node_modules/playwright/index.mjs')).href);
  }
}
const { chromium } = playwright;
const browser = process.env.BROWSER_LAUNCH === '1'
  ? await chromium.launch({ headless: true })
  : await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const origin = 'http://console-test.test';
const apps = JSON.parse(await fs.readFile(path.join(root, 'apps.json'), 'utf8'));
assert(apps.some(app => app.id === 'casierul-clasei'), 'Casierul configuration is available');
const now = Date.now();
const iso = days => new Date(now + days * 86400000).toISOString();
const schoolYearEnd = `${new Date(now).getUTCFullYear() + 1}-06-30T23:59:59.999Z`;
const sqlLastSeen = new Date(now - 3600000).toISOString().slice(0, 19).replace('T', ' ');
const secondClass = '11111111-1111-4111-8111-111111111111';
const classNames = ['Școala Horizon · III A · 2026–2027', 'Școala Horizon · V B · 2026–2027'];
const options = { children: [
  { id: 'classroom:default', name: `${classNames[0]} — întreaga clasă` },
  { id: 'child:default:ana', name: `${classNames[0]} — Pop Ana` },
  { id: 'child:default:ioana', name: `${classNames[0]} — Stan Ioana` },
  { id: `classroom:${secondClass}`, name: `${classNames[1]} — întreaga clasă` },
  { id: `child:${secondClass}:matei`, name: `${classNames[1]} — Ionescu Matei` },
] };
const inv = (id, label, extra = {}) => ({
  id, label, code: `DEMO-${String(id).padStart(4, '0')}-TEST-CODE`, url: `https://example.test/?invite=DEMO-${String(id).padStart(4, '0')}-TEST-CODE`,
  created_at: iso(-2), expires_at: iso(5), used_at: null, revoked: false, ...extra,
});
const device = (id, label, extra = {}) => ({
  id, label, created_at: iso(-20), last_seen: iso(-0.01), revoked: false, has_push: true, ...extra,
});
const data = new Map(apps.map(app => [app.id, {
  invites: [inv(1, `${app.name} — Elena`), inv(2, `${app.name} — Radu`, { used_at: iso(-1), code: null, url: null, device_id: 1 })],
  devices: [device(1, `${app.name} — telefon demo`), device(2, `${app.name} — laptop demo`, { has_push: false, last_seen: iso(-3) })],
}]));
data.set('casierul-clasei', {
  invites: [
    inv(11, 'Părinte — Ana', { role: 'parent', classroom_id: 'default', classroom_label: classNames[0], child_label: 'Pop Ana', access_expires_at: iso(180), use_count: 1, max_uses: 2 }),
    inv(12, 'Invitație anulată', { revoked: true, use_count: 0, max_uses: 2 }),
    inv(13, 'Invitație epuizată', { use_count: 2, max_uses: 2 }),
    inv(14, 'Acces expirat', { role: 'auditor', access_expires_at: iso(-1), use_count: 0, max_uses: 2 }),
    inv(15, 'Cod expirat', { expires_at: iso(-1), use_count: 0, max_uses: 2 }),
    inv(16, 'Casier — clasa V B', { role: 'treasurer', classroom_id: secondClass, classroom_label: classNames[1], use_count: 0, max_uses: 2 }),
  ],
  devices: [
    device(11, 'Elena — telefon și acces în două clase', { has_push: false, last_seen: sqlLastSeen, permissions: [
      { classroom_id: 'default', classroom_label: classNames[0], role: 'parent', child_label: 'Pop Ana', access_expires_at: schoolYearEnd },
      { classroom_id: secondClass, classroom_label: classNames[1], role: 'treasurer' },
    ] }),
    device(12, 'Auditor — acces încheiat', { has_push: false, permissions: [
      { classroom_id: 'default', classroom_label: classNames[0], role: 'auditor', access_expires_at: iso(-1) },
    ] }),
    device(13, 'Dispozitiv revocat', { revoked: true, role: 'treasurer' }),
  ],
});

const requests = [];
const mutations = [];
const pageErrors = [];
const rejectedRequests = [];
const failedApps = new Set();
const holds = new Map();
let missingConfig = false;
let nextId = 100;
let pendingRoutes = 0;
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 }, colorScheme: 'light', serviceWorkers: 'block', timezoneId: 'Europe/Bucharest',
});
context.setDefaultTimeout(8000);
context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  // No request may leave this synthetic origin, even if configuration changes.
  if (url.origin !== origin) {
    rejectedRequests.push(request.url());
    return route.abort();
  }
  const apiAt = url.pathname.indexOf('/api/');
  if (apiAt >= 0) {
    const app = apps.find(candidate => candidate.api === url.pathname.slice(0, apiAt));
    if (!app) return route.fulfill({ status: 404, json: { error: 'Unknown synthetic application' } });
    const endpoint = url.pathname.slice(apiAt);
    const method = request.method();
    requests.push({ app: app.id, endpoint, method });
    pendingRoutes++;
    try {
      const hold = holds.get(app.id);
      if (hold && method === 'GET') {
        hold.requests++;
        await hold.promise;
      }
      if (failedApps.has(app.id) && method === 'GET') {
        return await route.fulfill({ status: 503, json: { error: 'Eroare de test: aplicația nu răspunde.' } });
      }
      const records = data.get(app.id);
      if (method === 'GET' && endpoint === '/api/admin/invite-options') return await route.fulfill({ json: options });
      if (method === 'GET' && endpoint === '/api/admin/invites') return await route.fulfill({ json: { ttl_days: 7, invites: records.invites } });
      if (method === 'GET' && endpoint === '/api/admin/devices') return await route.fulfill({ json: { devices: records.devices } });
      if (method !== 'GET') mutations.push({ app: app.id, endpoint, method, body: request.postDataJSON() });
      if (method === 'POST' && endpoint === '/api/admin/invites') {
        const body = request.postDataJSON();
        const created = inv(nextId++, body.label, {
          role: body.role, classroom_id: body.classroomId, child_id: body.childId,
          access_expires_at: body.accessExpiresAt ? `${body.accessExpiresAt}T23:59:59.999Z` : null,
          ...(app.id === 'casierul-clasei' ? { max_uses: 2, use_count: 0 } : {}),
        });
        records.invites.unshift(created);
        return await route.fulfill({ status: 201, json: created });
      }
      const cancel = endpoint.match(/^\/api\/admin\/invites\/(\d+)\/revoke$/);
      if (method === 'POST' && cancel) {
        const record = records.invites.find(item => item.id === Number(cancel[1]));
        if (record) record.revoked = true;
        return await route.fulfill({ json: { ok: true } });
      }
      const deviceAction = endpoint.match(/^\/api\/admin\/devices\/(\d+)(?:\/(label|revoke))?$/);
      if (deviceAction) {
        const id = Number(deviceAction[1]);
        const record = records.devices.find(item => item.id === id);
        if (method === 'POST' && record && deviceAction[2] === 'label') {
          record.label = request.postDataJSON().label;
          return await route.fulfill({ json: { ok: true } });
        }
        if (method === 'POST' && record && deviceAction[2] === 'revoke') {
          record.revoked = request.postDataJSON().revoked;
          return await route.fulfill({ json: { ok: true } });
        }
        if (method === 'DELETE' && !deviceAction[2]) {
          records.devices = records.devices.filter(item => item.id !== id);
          return await route.fulfill({ json: { ok: true } });
        }
      }
      return await route.fulfill({ status: 404, json: { error: `Unmocked endpoint: ${method} ${endpoint}` } });
    } catch (error) {
      // Aborted app-switch requests are expected. Real handler failures must surface.
      if (!/closed|canceled|cancelled|Invalid InterceptionId|already handled/i.test(error.message)) throw error;
    } finally { pendingRoutes--; }
  }
  const relative = url.pathname === '/invites/' ? 'index.html' : url.pathname.replace(/^\/invites\//, '');
  if (relative === 'apps.json') {
    return route.fulfill(missingConfig
      ? { status: 404, json: { error: 'Missing configuration' } }
      : { json: apps });
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) return route.fulfill({ status: 404, body: '' });
  try { return route.fulfill({ body: await fs.readFile(resolved), contentType: mime[path.extname(resolved)] || 'application/octet-stream' }); }
  catch { return route.fulfill({ status: 404, body: '' }); }
});

const passed = [];
const check = async (name, run) => { await run(); passed.push(name); console.log(`PASS ${name}`); };
const eventually = async (predicate, message) => {
  const deadline = Date.now() + 8000;
  while (!await predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
};
const visible = async (page, id, expected = true) => {
  await page.locator(`#${id}`).waitFor({ state: expected ? 'visible' : 'hidden' });
};
const screenshot = async (page, name) => {
  if (!name.startsWith('result-')) await page.locator('#toast').waitFor({ state: 'hidden' });
  return page.screenshot({ path: path.join(screenshotDir, `invite-console-new-${name}.png`), fullPage: true });
};
const rows = (page, panel) => page.locator(`#${panel} .record`);
const record = (page, label, panel = 'invites') => rows(page, panel).filter({ hasText: label });
const selectApp = async (page, id) => {
  if (await page.locator('#app-list').isVisible()) {
    await page.locator('#app-search').fill('');
    await page.locator(`#app-list [data-app="${id}"]`).click();
  } else {
    await page.locator('#open-picker').click();
    await page.locator('#mobile-app-search').fill('');
    await page.locator(`#mobile-app-list [data-app="${id}"]`).click();
    await visible(page, 'app-picker', false);
  }
  await eventually(() => page.evaluate(appId => location.hash === `#${appId}`, id), `Selected app should be ${id}`);
};
const noOverflow = async (page, label) => {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(dimensions.scroll <= dimensions.width + 1, `${label} overflows: ${JSON.stringify(dimensions)}`);
  const dialog = page.locator('dialog[open]');
  if (await dialog.count()) {
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= -1 && bounds.x + bounds.width <= dimensions.width + 1, `${label}: modal fits viewport`);
    const modalDimensions = await dialog.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert(modalDimensions.scroll <= modalDimensions.width + 1, `${label}: modal content fits horizontally`);
  }
};
const expiryDate = new Date(now + 180 * 86400000).toISOString().slice(0, 10);

try {
  await fs.mkdir(screenshotDir, { recursive: true });
  const page = await context.newPage();
  await page.goto(`${origin}/invites/#trains`);
  await record(page, 'Întârzieri — Elena').waitFor();
  await eventually(() => pendingRoutes === 0, 'Initial synthetic API calls settle');

  await check('simple invites show only applicable fields and send only the label', async () => {
    await page.locator('#new-invite').click();
    await visible(page, 'invite-dialog');
    await visible(page, 'invite-access', false);
    assert.equal(await page.locator('#invite-label').evaluate(element => element === document.activeElement), true, 'Recipient field receives focus');
    await page.locator('#invite-label').fill('Invitat simplu');
    await page.locator('#invite-submit').click();
    await visible(page, 'invite-result');
    assert.deepEqual(mutations.at(-1), { app: 'trains', endpoint: '/api/admin/invites', method: 'POST', body: { label: 'Invitat simplu' } });
    await eventually(() => page.locator('#close-invite').isEnabled(), 'Invitation creation finishes before dismissal');
    await page.keyboard.press('Escape');
    await visible(page, 'invite-dialog', false);
    assert.equal(await page.locator('#new-invite').evaluate(element => element === document.activeElement), true, 'Focus returns to invitation button');
  });

  await check('Casierul separates class, role, child and access expiry', async () => {
    await selectApp(page, 'casierul-clasei');
    await record(page, 'Părinte — Ana').waitFor();
    await page.locator('#new-invite').click();
    await visible(page, 'invite-class-wrap');
    await page.locator('#invite-class option[value="default"]').waitFor({ state: 'attached' });
    await page.locator('#invite-class').selectOption('default');
    await page.locator('#invite-role').selectOption('treasurer');
    await visible(page, 'invite-child-wrap', false);
    await visible(page, 'invite-expiry-wrap', false);
    await page.locator('#invite-role').selectOption('parent');
    await visible(page, 'invite-child-wrap');
    await visible(page, 'invite-expiry-wrap');
    assert.deepEqual(await page.locator('#invite-child option').evaluateAll(elements => elements.map(element => element.value).filter(Boolean)).then(values => values.sort()), ['ana', 'ioana']);
    await page.locator('#invite-class').selectOption(secondClass);
    assert.deepEqual(await page.locator('#invite-child option').evaluateAll(elements => elements.map(element => element.value).filter(Boolean)), ['matei']);
    await page.locator('#invite-child').selectOption('matei');
    await page.locator('#invite-label').fill('Familia Ionescu');
    await page.locator('#invite-expiry').fill(expiryDate);
    await screenshot(page, 'form');
    await page.locator('#invite-submit').click();
    await visible(page, 'invite-result');
    assert.deepEqual(mutations.at(-1).body, { label: 'Familia Ionescu', role: 'parent', classroomId: secondClass, childId: 'matei', accessExpiresAt: expiryDate });
    await eventually(() => page.locator('#close-invite').isEnabled(), 'Parent invitation creation completes');
    await page.locator('#invite-create-another').click();
    await page.locator('#invite-role').selectOption('auditor');
    await visible(page, 'invite-child-wrap', false);
    await visible(page, 'invite-expiry-wrap');
    await page.locator('#invite-class').selectOption('default');
    await page.locator('#invite-label').fill('Auditor demo');
    await page.locator('#invite-expiry').fill(expiryDate);
    await page.locator('#invite-submit').click();
    await visible(page, 'invite-result');
    assert.deepEqual(mutations.at(-1).body, { label: 'Auditor demo', role: 'auditor', classroomId: 'default', accessExpiresAt: expiryDate });
    await page.locator('#close-invite').click();
  });

  await check('switching back to a standard app clears role controls and payload', async () => {
    await selectApp(page, 'bp');
    await page.locator('#new-invite').click();
    await visible(page, 'invite-access', false);
    await page.locator('#invite-label').fill('Standard după Casierul');
    await page.locator('#invite-submit').click();
    await visible(page, 'invite-result');
    assert.deepEqual(mutations.at(-1).body, { label: 'Standard după Casierul' });
    await page.locator('#close-invite').click();
  });

  await check('pending filters exclude revoked, exhausted and expired access', async () => {
    await selectApp(page, 'casierul-clasei');
    await record(page, 'Părinte — Ana').waitFor();
    for (const label of ['Invitație anulată', 'Invitație epuizată', 'Acces expirat', 'Cod expirat']) {
      const row = record(page, label);
      assert.equal(await row.count(), 1, `${label} is listed in all states`);
      assert.equal(await row.locator('[data-action="code"], [data-action="message"]').count(), 0, `${label} cannot be copied`);
      assert.doesNotMatch(await row.innerText(), /în așteptare/i, `${label} is not pending`);
    }
    assert.match(await record(page, 'Părinte — Ana').innerText(), /1\s*(?:\/|din)\s*2/, 'Partial activation count is shown');
    assert(await record(page, 'Părinte — Ana').locator('[data-action="code"]').count(), 'Partially used invite remains copyable');
    await page.locator('#list-filter').selectOption('pending');
    assert.equal(await rows(page, 'invites').count(), 4, 'Two initial and two newly created invitations remain usable');
    await page.locator('#list-filter').selectOption('revoked');
    assert.equal(await rows(page, 'invites').count(), 1);
    await page.locator('#list-filter').selectOption('all');
    await page.locator('#list-search').fill('Ionescu');
    assert.equal(await rows(page, 'invites').count(), 1, 'Text search narrows invitation list');
    await page.locator('#list-search').fill('');
    await screenshot(page, 'desktop');
  });

  await check('canceling a usable invitation posts its revoke action and removes copy actions', async () => {
    const target = record(page, 'Casier — clasa V B');
    await target.locator('summary').click();
    page.once('dialog', dialog => dialog.accept());
    await target.locator('[data-action="cancel"]').click();
    await eventually(() => target.innerText().then(text => /Anulată/.test(text)), 'Canceled invite has a revoked status');
    assert.deepEqual(mutations.at(-1), { app: 'casierul-clasei', endpoint: '/api/admin/invites/16/revoke', method: 'POST', body: null });
    assert.equal(await target.locator('[data-action="code"], [data-action="message"]').count(), 0);
  });

  await check('devices preserve access across classes and hide unsupported push status', async () => {
    await page.locator('#tab-devices').click();
    const multi = record(page, 'Elena — telefon și acces în două clase', 'devices');
    assert.match(await multi.innerText(), /III A/);
    assert.match(await multi.innerText(), /V B/);
    assert.match(await multi.innerText(), /30 iun/, 'UTC school-year end keeps June 30 in Bucharest');
    assert.doesNotMatch(await multi.innerText(), /1 iul/, 'Expiry is not shifted to the next local day');
    assert.match(await multi.innerText(), /acum 1 h/, 'SQL UTC activity timestamps are interpreted as UTC');
    assert.doesNotMatch(await page.locator('#devices').innerText(), /fără notificări/i);
    await page.locator('#list-filter').selectOption('expired');
    assert.equal(await rows(page, 'devices').count(), 1, 'A device with only expired permissions is expired');
    assert.match(await rows(page, 'devices').innerText(), /Auditor — acces încheiat/);
    await page.locator('#list-filter').selectOption('active');
    assert.equal(await rows(page, 'devices').count(), 1, 'Revoked and expired devices are not active');
    await page.locator('#list-filter').selectOption('all');
  });

  await check('device rename, revoke, restore and delete use the selected app endpoints', async () => {
    await selectApp(page, 'bp');
    await page.locator('#tab-devices').click();
    const original = record(page, 'wBP Digitizer — telefon demo', 'devices');
    await original.locator('summary').click();
    page.once('dialog', dialog => dialog.accept('Telefon redenumit'));
    await original.locator('[data-action="rename"]').click();
    const renamed = record(page, 'Telefon redenumit', 'devices');
    await renamed.waitFor();
    assert.deepEqual(mutations.at(-1), { app: 'bp', endpoint: '/api/admin/devices/1/label', method: 'POST', body: { label: 'Telefon redenumit' } });

    await renamed.locator('summary').click();
    page.once('dialog', dialog => dialog.accept());
    await renamed.locator('[data-action="revoke"]').click();
    await renamed.locator('[data-action="restore"]').waitFor({ state: 'attached' });
    assert.deepEqual(mutations.at(-1), { app: 'bp', endpoint: '/api/admin/devices/1/revoke', method: 'POST', body: { revoked: true } });
    assert.match(await renamed.innerText(), /Revocat/);

    await renamed.locator('summary').click();
    await renamed.locator('[data-action="restore"]').click();
    await renamed.locator('[data-action="revoke"]').waitFor({ state: 'attached' });
    assert.deepEqual(mutations.at(-1), { app: 'bp', endpoint: '/api/admin/devices/1/revoke', method: 'POST', body: { revoked: false } });
    assert.match(await renamed.innerText(), /Activ/);

    const mutationCount = mutations.length;
    await renamed.locator('summary').click();
    page.once('dialog', dialog => dialog.dismiss());
    await renamed.locator('[data-action="delete"]').click();
    assert.equal(mutations.length, mutationCount, 'Dismissing deletion does not send a request');
    page.once('dialog', dialog => dialog.accept());
    await renamed.locator('[data-action="delete"]').click();
    await renamed.waitFor({ state: 'detached' });
    assert.deepEqual(mutations.at(-1), { app: 'bp', endpoint: '/api/admin/devices/1', method: 'DELETE', body: null });
    await record(page, 'wBP Digitizer — laptop demo', 'devices').waitFor();
    assert.equal(await rows(page, 'devices').count(), 1);
  });

  await check('skip navigation preserves the selected application', async () => {
    await selectApp(page, 'casierul-clasei');
    await record(page, 'Părinte — Ana').waitFor();
    await page.locator('.skip-link').focus();
    await page.locator('.skip-link').click();
    await page.waitForFunction(() => location.hash === '#workspace');
    assert.equal(await page.locator('#app-title').innerText(), 'Casierul clasei');
    assert.equal(await page.locator('#workspace').evaluate(element => element === document.activeElement), true);
  });

  await check('a delayed response cannot replace the newly selected app', async () => {
    await eventually(() => pendingRoutes === 0, 'Previous calls settle before race test');
    let release;
    const hold = { requests: 0, promise: new Promise(resolve => { release = resolve; }) };
    holds.set('trains', hold);
    await selectApp(page, 'trains');
    await eventually(() => hold.requests >= 2, 'Both old-app list requests started');
    await selectApp(page, 'magpie');
    await page.locator('#tab-devices').click();
    await record(page, 'Magpie — telefon demo', 'devices').waitFor();
    holds.delete('trains');
    release();
    await eventually(() => pendingRoutes === 0, 'Delayed routes settle');
    await page.waitForTimeout(120);
    assert.match(await page.locator('#devices').innerText(), /Magpie/);
    assert.doesNotMatch(await page.locator('#devices').innerText(), /Întârzieri/);
    await page.locator('#tab-invites').click();
    assert.match(await page.locator('#invites').innerText(), /Magpie/);
    assert.doesNotMatch(await page.locator('#invites').innerText(), /Întârzieri/);
  });

  await check('load failures are visible and the retry action recovers', async () => {
    failedApps.add('magpie');
    await page.locator('#refresh').click();
    await visible(page, 'list-error');
    assert.match(await page.locator('#list-error-text').innerText(), /Eroare de test/);
    failedApps.delete('magpie');
    await page.locator('#retry-load').click();
    await visible(page, 'list-error', false);
    await record(page, 'Magpie — Elena').waitFor();
  });

  await check('app search, mobile picker, keyboard dismissal and adaptive layouts', async () => {
    await page.locator('#app-search').fill('Casierul');
    assert.equal(await page.locator('#app-list [data-app]').count(), 1);
    await page.locator('#app-search').fill('');
    await selectApp(page, 'casierul-clasei');
    await record(page, 'Părinte — Ana').waitFor();
    await noOverflow(page, 'desktop');
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page, `${width}px workspace`);
      if (await page.locator('#open-picker').isVisible()) {
        await page.locator('#open-picker').click();
        await visible(page, 'app-picker');
        assert.equal(await page.locator('#mobile-app-search').evaluate(element => element === document.activeElement), true, 'Picker search receives focus');
        await page.locator('#mobile-app-search').fill('magpie');
        assert.equal(await page.locator('#mobile-app-list [data-app]').count(), 1);
        await noOverflow(page, `${width}px picker`);
        await page.keyboard.press('Escape');
        // Chromium search fields clear nonempty text on the first Escape.
        if (await page.locator('#app-picker').isVisible()) {
          assert.equal(await page.locator('#mobile-app-search').inputValue(), '', 'First Escape clears picker search');
          await page.keyboard.press('Escape');
        }
        await visible(page, 'app-picker', false);
        assert.equal(await page.locator('#open-picker').evaluate(element => element === document.activeElement), true, 'Picker returns focus');
      }
      await page.locator('#new-invite').click();
      await page.locator('#invite-role').selectOption('parent');
      await noOverflow(page, `${width}px invitation form`);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('#invite-dialog').contains(document.activeElement)), true, 'Focus stays inside invitation modal');
      await page.keyboard.press('Escape');
      await visible(page, 'invite-dialog', false);
      if (width === 390) await screenshot(page, 'mobile');
    }
    await selectApp(page, 'plate');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('#new-invite').click();
      await visible(page, 'invite-access', false);
      assert.match(await page.locator('#invite-dialog').innerText(), /cont nou/i, 'Account app retains account-specific invitation wording');
      await page.locator('#invite-label').fill(`Invitație cont ${width}`);
      await page.locator('#invite-submit').click();
      await visible(page, 'invite-result');
      assert.equal((await page.locator('#invite-result code').innerText()).length, 19, 'Synthetic access code uses the real 19-character format');
      await noOverflow(page, `${width}px invitation result`);
      await page.locator('[data-result-copy="code"]').click();
      await visible(page, 'toast');
      assert.equal(await page.locator('#toast').evaluate(element => !!element.closest('#invite-dialog')), true, 'Copy feedback remains in the modal');
      await screenshot(page, `result-${width}`);
      await page.keyboard.press('Escape');
      await visible(page, 'invite-dialog', false);
    }
    await selectApp(page, 'casierul-clasei');
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await noOverflow(page, 'dark desktop');
    await screenshot(page, 'dark');
  });

  await check('missing apps.json displays a recoverable error without a null crash', async () => {
    missingConfig = true;
    const broken = await context.newPage();
    await broken.goto(`${origin}/invites/#trains`);
    await visible(broken, 'list-error');
    assert.match(await broken.locator('#list-error-text').innerText(), /apps\.json|configur|aplica/i);
    assert.equal(await broken.locator('#new-invite').isDisabled(), true);
    missingConfig = false;
    await broken.locator('#retry-load').click();
    await record(broken, 'Întârzieri — Elena').waitFor();
    await broken.close();
  });

  assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
  assert.deepEqual(rejectedRequests.filter(url => new URL(url).pathname.includes('/api/')), [], 'No real administration API was requested');
  console.log(JSON.stringify({ passed: passed.length, syntheticApiRequests: requests.length, syntheticMutations: mutations.length, screenshots: screenshotDir, externalRequestsBlocked: rejectedRequests.length }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
