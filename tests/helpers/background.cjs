const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../anti-red-tag');
const copy = value => value === undefined ? undefined : structuredClone(value);
function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.map(fn => fn(...args)), listeners };
}
function fixture(saved = {}) {
  const local = { ...copy(saved.local) };
  const session = { ...copy(saved.session) };
  const windows = new Map([[10, { id: 10, type: 'normal', left: 0, top: 0, width: 1200, height: 800, state: 'normal' }]]);
  const tabs = new Map([1, 2, 3, 4].map((id, index) => [id, {
    id, index, windowId: 10, active: id === 1, pinned: false, incognito: false,
    title: `Tab ${id}`, url: `https://site${id}.example/`, lastAccessed: 10 - id
  }]));
  const hooks = {};
  const calls = [];
  const grants = new Set();
  const injected = new Set();
  let nextWindow = 20;
  let nextTab = 100;
  const call = async (name, value) => { calls.push({ name, value: copy(value) }); if (hooks[name]) await hooks[name](value); };
  const siblings = windowId => [...tabs.values()].filter(t => t.windowId === windowId).sort((a, b) => a.index - b.index);
  function reorder(windowId, moving, index) {
    const rest = siblings(windowId).filter(t => t.id !== moving.id);
    const at = index < 0 ? rest.length : Math.min(index, rest.length);
    rest.splice(at, 0, moving);
    rest.forEach((t, i) => { t.index = i; });
  }
  async function moveTab(id, value) {
    const tab = tabs.get(id);
    if (!tab) throw new Error('No tab with id');
    const old = tab.windowId;
    tab.windowId = value.windowId ?? old;
    if (!windows.has(tab.windowId)) throw new Error('No window');
    reorder(tab.windowId, tab, value.index);
    if (old !== tab.windowId) {
      siblings(old).forEach((t, i) => { t.index = i; });
      if (!siblings(old).length) windows.delete(old);
    }
    return copy(tab);
  }
  const area = (data, name) => ({
    get: async key => { await call(`${name}.get`, key); return { [key]: copy(data[key]) }; },
    set: async value => { await call(`${name}.set`, value); Object.assign(data, copy(value)); }
  });
  const chrome = {
    runtime: { id: 'test-extension', getURL: value => `chrome-extension://test-extension/${value}`, onMessage: event(), onStartup: event() },
    storage: { local: area(local, 'local'), session: area(session, 'session') },
    action: { setBadgeText: async value => call('badge.text', value), setBadgeBackgroundColor: async value => call('badge.color', value) },
    tabs: {
      get: async id => { await call('tabs.get', id); if (!tabs.has(id)) throw new Error('No tab'); return copy(tabs.get(id)); },
      query: async query => { await call('tabs.query', query); return [...tabs.values()].filter(t => Object.entries(query).every(([key, value]) => key === 'windowType' ? windows.get(t.windowId)?.type === value : t[key] === value)).map(copy); },
      move: async (id, value) => { await call('tabs.move', { id, ...value }); return moveTab(id, value); },
      update: async (id, value) => { await call('tabs.update', { id, ...value }); const tab = tabs.get(id); if (!tab) throw new Error('No tab'); Object.assign(tab, value); return copy(tab); },
      reload: async id => { await call('tabs.reload',id); if(!tabs.has(id))throw new Error('No tab'); injected.delete(id); tabs.get(id).documentVersion=(tabs.get(id).documentVersion||0)+1; },
      create: async value => {
        await call('tabs.create', value);
        const windowId = value.windowId ?? 10;
        if (!windows.has(windowId)) throw new Error('No window');
        const tab = { id: nextTab++, index: siblings(windowId).length, windowId, title: 'New tab', url: value.url || 'about:blank', active: value.active ?? true };
        tabs.set(tab.id, tab); reorder(windowId, tab, value.index ?? -1); return copy(tab);
      },
      onRemoved: event(), onReplaced: event(), onUpdated: event()
    },
    windows: {
      remove: async id => { await call('windows.remove', id); windows.delete(id); for (const tab of siblings(id)) tabs.delete(tab.id); },
      get: async id => { await call('windows.get', id); if (!windows.has(id)) throw new Error('No window'); return copy(windows.get(id)); },
      getLastFocused: async () => { await call('windows.last', {}); const win = [...windows.values()].find(w => w.type === 'normal'); if (!win) throw new Error('No normal window'); return copy(win); },
      create: async value => {
        await call('windows.create', value);
        const win = { id: nextWindow++, type: value.type || 'normal', left: 0, top: 0, width: 900, height: 700, state: 'normal', ...value };
        delete win.tabId; delete win.url;
        windows.set(win.id, win);
        if (value.tabId) await moveTab(value.tabId, { windowId: win.id, index: 0 });
        else await chrome.tabs.create({ windowId: win.id, url: value.url || 'about:blank', active: true });
        return { ...copy(win), tabs: siblings(win.id).map(copy) };
      },
      update: async (id, value) => { await call('windows.update', { id, ...value }); const win = windows.get(id); if (!win) throw new Error('No window'); Object.assign(win, value); return copy(win); }
    },
    permissions: { contains: async value => value.origins.every(o => grants.has(o)), getAll: async () => ({ origins: [...grants] }), remove: async value => { for (const origin of value.origins) grants.delete(origin); return true; }, onRemoved: event() },
    scripting: { executeScript: async value => {
      await call('script', { tabId: value.target.tabId, enabled: value.args?.[0] });
      if (!value.args) return [{ result: { left: 0, top: 0, width: 1600, height: 900 } }];
      if (value.args?.[0] === true) injected.add(value.target.tabId);
      if (value.args?.[0] === false) injected.delete(value.target.tabId);
      return [{ result: { applied: value.args?.[0] === true, clean: value.args?.[0] === false }, documentId: `document-${value.target.tabId}` }];
    } },
    webNavigation: { getAllFrames: async ({tabId}) => { await call('frames',tabId); return tabs.has(tabId) ? [{frameId:0,url:tabs.get(tabId).url,documentId:`document-${tabId}${tabs.get(tabId).documentVersion?'-r'+tabs.get(tabId).documentVersion:''}`}] : []; }, onCommitted: event() }, commands: { onCommand: event() }
  };
  function boot() {
    const context = vm.createContext({ chrome, console, URL, structuredClone, setTimeout, clearTimeout });
    context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  }
  boot();
  async function send(message, sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('controller.html') }) {
    const fn = chrome.runtime.onMessage.listeners.at(-1);
    return new Promise((resolve, reject) => {
      const accepted = fn(message, sender, response => response.ok ? resolve(copy(response.data)) : reject(new Error(response.error)));
      if (!accepted) reject(new Error('Sender rejected'));
    });
  }
  async function emit(source, ...args) {
    source.emit(...args);
    return send({ type: 'state' });
  }
  return { chrome, hooks, calls, local, session, tabs, windows, grants, injected, send, emit, boot, moveTab };
}
module.exports = { fixture };
