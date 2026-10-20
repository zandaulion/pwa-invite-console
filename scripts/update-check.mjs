import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = (await readFile(new URL('../pwa-update.js', import.meta.url), 'utf8'))
  .replace(/^export (?=function installUpdates)/m, '');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options = {}) {
      const list = listeners.get(type) || [];
      list.push({ callback, once: options.once });
      listeners.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener.callback(event);
        if (listener.once) {
          listeners.set(type, listeners.get(type).filter(item => item !== listener));
        }
      }
    },
  };
}

function clock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setInterval(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay, next: now + delay });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    advance(milliseconds) {
      const end = now + milliseconds;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].next - b[1].next)[0];
        if (timer.next > end) break;
        now = timer.next;
        timer.callback();
        if (timers.has(id)) timer.next += timer.delay;
      }
      now = end;
    },
  };
}

async function harness(initialBusy) {
  let busy = initialBusy, reloads = 0;
  const acknowledgements = [], storage = new Map();
  const timer = clock();
  const document = { ...eventTarget(), readyState: 'complete', visibilityState: 'visible' };
  const controller = { postMessage: message => acknowledgements.push(['controller', message.type]) };
  const sourceWorker = { postMessage: message => acknowledgements.push(['source', message.type]) };
  const serviceWorker = {
    ...eventTarget(), controller,
    async register() { return { async update() {} }; },
  };
  const context = vm.createContext({
    document, navigator: { serviceWorker }, window: eventTarget(),
    location: { reload() { reloads++; } },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    setInterval: timer.setInterval, clearInterval: timer.clearInterval,
    console,
  });
  vm.runInContext(source, context, { filename: 'pwa-update.js' });
  context.installUpdates({ isBusy: () => busy, toast() {}, scriptUrl: 'sw.js' });
  // Finish the async registration before sending the worker's update event.
  await new Promise(resolve => setImmediate(resolve));
  return {
    acknowledgements, storage,
    get reloads() { return reloads; },
    setBusy(value) { busy = value; },
    update() { serviceWorker.dispatch('message', { data: { type: 'sw-updated' }, source: sourceWorker }); },
    hide() { document.visibilityState = 'hidden'; document.dispatch('visibilitychange'); },
    advance: timer.advance,
  };
}

test('a pending update preserves an open form even when the tab is hidden', async () => {
  const app = await harness(true);
  app.update();
  assert.deepEqual(app.acknowledgements, [
    ['source', 'sw-update-ack'], ['controller', 'sw-update-ack'],
  ]);
  assert.equal(app.reloads, 0);
  app.advance(6000);
  assert.equal(app.reloads, 0, 'an open form must survive update polling');

  app.hide();
  app.advance(6000);
  assert.equal(app.reloads, 0, 'hiding the tab must not discard the form');

  app.setBusy(false);
  app.advance(2000);
  assert.equal(app.reloads, 1, 'the update applies after the form closes');
  assert.equal(app.storage.get('pwa-kit:updated'), '1');
  app.advance(6000);
  assert.equal(app.reloads, 1, 'the completed update must not reload again');
});

test('an idle console acknowledges and applies an update immediately', async () => {
  const app = await harness(false);
  app.update();
  assert.deepEqual(app.acknowledgements, [
    ['source', 'sw-update-ack'], ['controller', 'sw-update-ack'],
  ]);
  assert.equal(app.reloads, 1);
  assert.equal(app.storage.get('pwa-kit:updated'), '1');
});
