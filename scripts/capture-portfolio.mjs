/* Portfolio capture of the deployed console. API calls are GET-only, sensitive
   values are anonymized in intercepted responses before rendering, and the
   anonymized text is blurred before any screenshot is written. No raw screenshots,
   traces, HARs, invitation creation, or device mutations are used. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const origin = process.env.CONSOLE_ORIGIN;
if (!origin) throw new Error('Set CONSOLE_ORIGIN to the console\'s private origin.');
const output = path.resolve(process.argv[2] || 'portfolio');
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
await fs.mkdir(output, { recursive: true });
let browser;
try { browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222'); }
catch (error) {
  if (!error.message.includes('ECONNREFUSED')) throw error;
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
}
const contexts = [], pages = [];
const totals = { apiReads: 0, blockedMutations: 0, blockedExternal: 0 };
const failures = [], rawCredentials = new Set();
let pending = 0;
const captions = [];
const privacyStyles = `
  .portfolio-private { filter: blur(6px) !important; user-select: none !important; }
  #invite-class, #invite-child { color: transparent !important; text-shadow: 0 0 7px var(--text) !important; }
  #toast { display: none !important; }
  * { caret-color: transparent !important; transition-property: none !important; animation: none !important; }
`;

function redactRecord(record, type, index) {
  const result = { ...record };
  // The screenshot never contains pixels derived from an actual private name.
  result.label = `${type === 'device' ? 'Dispozitiv' : 'Destinatar'} confidențial ${String(index + 1).padStart(2, '0')}`;
  if (record.classroom_label) result.classroom_label = 'Clasă confidențială';
  if (record.child_label) result.child_label = 'Date de acces confidențiale';
  if (record.code) { rawCredentials.add(record.code); result.code = 'XXXX-XXXX-XXXX-XXXX'; }
  if (record.url) { rawCredentials.add(record.url); result.url = 'https://example.invalid/?invite=REDACTED'; }
  if (record.permissions) result.permissions = record.permissions.map(permission => ({
    ...permission,
    classroom_label: permission.classroom_label ? 'Clasă confidențială' : null,
    child_label: permission.child_label ? 'Date de acces confidențiale' : null,
  }));
  return result;
}
function redactOptions(data) {
  const classes = new Map();
  for (const child of data.children || []) {
    const match = String(child.id).match(/^classroom:(.+)$/);
    if (match) classes.set(match[1], `Clasă confidențială ${String(classes.size + 1).padStart(2, '0')}`);
  }
  return { ...data, children: (data.children || []).map((child, index) => {
    const wholeClass = String(child.id).match(/^classroom:(.+)$/);
    if (wholeClass) return { ...child, name: `${classes.get(wholeClass[1])} — întreaga clasă` };
    const scopedChild = String(child.id).match(/^child:([^:]+):(.+)$/);
    return { ...child, name: `${scopedChild ? `${classes.get(scopedChild[1])} — ` : ''}Copil confidențial ${String(index + 1).padStart(2, '0')}` };
  }) };
}
async function makePage(viewport, scheme, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme,
    serviceWorkers: 'block', locale: 'ro-RO', timezoneId: 'Europe/Bucharest', reducedMotion: 'reduce',
    isMobile: mobile, hasTouch: mobile,
  });
  contexts.push(context);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { totals.blockedExternal++; return route.abort(); }
    if (request.method() !== 'GET') { totals.blockedMutations++; return route.abort(); }
    if (url.pathname === '/invites/portfolio-redactions.css') return route.fulfill({ contentType: 'text/css', body: privacyStyles });
    if (!url.pathname.includes('/api/')) return route.continue();
    pending++; totals.apiReads++;
    try {
      const response = await route.fetch();
      if (!response.ok()) {
        failures.push({ path: url.pathname, status: response.status() });
        return route.fulfill({ status: response.status(), json: { error: 'Aplicația nu este disponibilă.' } });
      }
      let data = await response.json();
      if (url.pathname.endsWith('/invite-options')) data = redactOptions(data);
      else if (Array.isArray(data.devices)) data = { ...data, devices: data.devices.map((record, i) => redactRecord(record, 'device', i)) };
      else if (Array.isArray(data.invites)) data = { ...data, invites: data.invites.map((record, i) => redactRecord(record, 'invite', i)) };
      else throw new Error('Unexpected API response type');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    } finally { pending--; }
  });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push({ browserError: error.name }));
  pages.push(page);
  await page.goto(origin + '/invites/#casierul-clasei');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled && document.querySelector('#app-list [data-app]'));
  // A same-origin stylesheet respects the live site's CSP; nothing is deployed.
  await page.addStyleTag({ url: origin + '/invites/portfolio-redactions.css' });
  return page;
}
async function settle(page) {
  const deadline = Date.now() + 20000;
  while (pending > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(pending, 0, 'All read-only API requests settled');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('#list-error').isVisible(), false);
  assert.equal(await page.locator('#invite-err').isVisible(), false);
}
async function selectApp(page, id) {
  if (await page.locator('#app-list').isVisible()) await page.locator(`#app-list [data-app="${id}"]`).click();
  else {
    await page.locator('#open-picker').click();
    await page.locator(`#mobile-app-list [data-app="${id}"]`).click();
  }
  await settle(page);
}
async function parentForm(page) {
  await page.locator('#new-invite').click();
  await page.waitForFunction(() => !document.getElementById('invite-submit').disabled);
  const classValue = await page.locator('#invite-class option').evaluateAll(options => options.find(o => o.value)?.value);
  assert(classValue, 'A real class is available, with anonymized display label');
  await page.selectOption('#invite-class', classValue);
  await page.selectOption('#invite-role', 'parent');
  const childValue = await page.locator('#invite-child option').evaluateAll(options => options.find(o => o.value)?.value);
  if (childValue) await page.selectOption('#invite-child', childValue);
  await settle(page);
}
async function capture(page, file, title, description) {
  await settle(page);
  const inspection = await page.evaluate(() => {
    const names = [...document.querySelectorAll('.record-title h3')];
    for (const name of names) {
      if (!/^(Dispozitiv|Destinatar) confidențial \d+$/.test(name.textContent)) throw new Error('Unredacted record label');
      name.classList.add('portfolio-private');
    }
    for (const line of document.querySelectorAll('.permission-line')) {
      const scope = line.querySelector('span:not(.badge)');
      if (scope?.textContent) {
        if (!scope.textContent.includes('confidențial')) throw new Error('Unredacted access scope');
        scope.classList.add('portfolio-private');
      }
    }
    for (const code of document.querySelectorAll('.code-copy code')) {
      if (code.textContent !== 'XXXX-XXXX-XXXX-XXXX') throw new Error('Unredacted invitation code');
      code.classList.add('portfolio-private');
    }
    for (const select of document.querySelectorAll('#invite-class, #invite-child')) {
      if ([...select.options].some(option => option.value && !option.text.includes('confidențial'))) throw new Error('Unredacted form option');
    }
    document.activeElement?.blur();
    document.getElementById('app-list').scrollTop = 0;
    document.getElementById('mobile-app-list').scrollTop = 0;
    for (const dialog of document.querySelectorAll('dialog')) dialog.scrollTop = 0;
    window.scrollTo(0, 0);
    return {
      blurredLabels: names.length,
      blurredFields: document.querySelectorAll('.portfolio-private').length,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      labelsProtected: names.filter(el => el.getClientRects().length).every(el => getComputedStyle(el).filter === 'blur(6px)'),
      visibleBlurredLabels: names.filter(el => el.getClientRects().length).length,
    };
  });
  assert(inspection.labelsProtected, 'Every visible record label is blurred');
  assert(inspection.documentWidth <= inspection.viewportWidth + 1, 'No horizontal overflow');
  const markup = await page.content();
  for (const credential of rawCredentials) assert(!markup.includes(credential), 'No live invitation credential in captured DOM');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(output, file), fullPage: false, animations: 'disabled' });
  captions.push({ file, title, description, viewport: page.viewportSize(), scale: 2, ...inspection });
  console.log(JSON.stringify({ captured: file, blurredFields: inspection.blurredFields }));
}
try {
  const desktop = await makePage({ width: 1440, height: 1120 }, 'light');
  await settle(desktop);
  await desktop.locator('#tab-devices').click();
  await capture(desktop, '01-desktop-devices-light.png', 'Desktop · dispozitive', 'Navigare între aplicații și permisiuni pentru dispozitive.');

  await selectApp(desktop, 'stencil-cnc');
  await capture(desktop, '02-desktop-invitations-light.png', 'Desktop · invitații', 'Stări, filtre și acțiuni pentru invitații.');

  await selectApp(desktop, 'casierul-clasei');
  await parentForm(desktop);
  await capture(desktop, '03-desktop-parent-invitation.png', 'Desktop · opțiuni specifice', 'Clasă, rol, copil și expirarea accesului în Casierul clasei.');
  await desktop.locator('#close-invite').click();

  await selectApp(desktop, 'magpie');
  await desktop.emulateMedia({ colorScheme: 'dark' });
  await desktop.locator('#new-invite').click();
  await capture(desktop, '04-desktop-account-invitation-dark.png', 'Desktop · temă întunecată', 'Formular simplu pentru aplicațiile cu invitații pentru conturi.');

  const mobile = await makePage({ width: 430, height: 932 }, 'light', true);
  await settle(mobile);
  await mobile.locator('#tab-devices').click();
  await capture(mobile, '05-mobile-devices-light.png', 'Mobil · dispozitive', 'Lista de dispozitive adaptată pentru telefon.');

  await mobile.emulateMedia({ colorScheme: 'dark' });
  await mobile.locator('#open-picker').click();
  await capture(mobile, '06-mobile-app-picker-dark.png', 'Mobil · selector de aplicații', 'Aplicațiile publice, cu pictograme și căutare, în selectorul mobil.');
  await mobile.locator('#close-picker').click();

  await mobile.emulateMedia({ colorScheme: 'light' });
  await parentForm(mobile);
  await capture(mobile, '07-mobile-parent-invitation.png', 'Mobil · invitație contextuală', 'Opțiunile pentru părinte într-un formular adaptat telefonului.');

  assert.deepEqual(failures, [], 'No failed API requests or browser errors');
  assert.equal(totals.blockedMutations, 0, 'No mutation requests attempted');
  assert.equal(totals.blockedExternal, 0, 'No external requests attempted');
  const manifest = { capturedAt: new Date().toISOString(), screenshots: captions, privacy: 'Names, invitation recipients, class/child labels and invite credentials were anonymized before rendering, then visually blurred. App names, counts and ordinary status/date metadata are retained. No live records were changed.', checks: totals };
  await fs.writeFile(path.join(output, 'screenshots.json'), JSON.stringify(manifest, null, 2) + '\n');
  const cards = captions.map(shot => `<a class="shot" href="${shot.file}"><div class="preview ${shot.viewport.width < 600 ? 'phone' : ''}"><img src="${shot.file}" alt="${shot.title}" loading="lazy"></div><h2>${shot.title}</h2><p>${shot.description}</p><small>${shot.viewport.width * 2} × ${shot.viewport.height * 2} PNG</small></a>`).join('');
  await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Consolă admin · Portfolio</title><style>*{box-sizing:border-box}body{margin:0;padding:48px;background:#f3f5f3;color:#203127;font:15px/1.5 system-ui,sans-serif}main{max-width:1440px;margin:auto}h1{margin:0;font-size:34px;letter-spacing:-1px}header>p{color:#5a6f61;max-width:780px}section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;margin-top:32px}.shot{padding:16px;border:1px solid #d5dfd7;border-radius:16px;background:#fff;color:inherit;text-decoration:none}.preview{display:flex;align-items:center;justify-content:center;aspect-ratio:1.5;background:#e8eee9;border-radius:9px;overflow:hidden}.preview img{max-width:100%;max-height:100%;object-fit:contain}.phone img{height:100%;width:auto}h2{font-size:17px;margin:15px 0 6px}.shot p{margin:0;color:#5a6f61;font-size:13px}small{display:block;margin-top:10px;color:#7a8a7e}footer{margin-top:30px;color:#5a6f61;font-size:13px}@media(max-width:700px){body{padding:22px}section{grid-template-columns:1fr}}</style><main><header><h1>Consolă admin</h1><p>O singură interfață pentru invitații și dispozitive în 12 aplicații PWA. Capturi reale ale consolei, cu datele personale și codurile de acces anonimizate și estompate.</p></header><section>${cards}</section><footer>7 capturi PNG la rezoluție 2× · Desktop și mobil · Teme luminoasă și întunecată</footer></main></html>`);
  console.log(JSON.stringify({ output, screenshots: captions.length, ...totals }));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
