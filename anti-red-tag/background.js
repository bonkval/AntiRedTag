importScripts('core.js', 'protection.js', 'lifecycle.js');
const C = AntiCore;
const store = chrome.storage.session || chrome.storage.local;
const KEY = 'antiRedTagSessionV2';
const SAFETY = 'antiRedTagStopV2';
const empty = () => ({ tabId: null, initialized: false, enabled: false, status: 'off', detail: '', documents: [], touchedTabs: [], cleanupTabs: [], controllerId: null, notice: '' });
let session = empty();
let settings = C.preferences();
let initialization;
let queue = Promise.resolve();
let epoch = 0;
let halted = false;
let safetyWrite = Promise.resolve();
let emergencyTask;
let emergencyRuns = 0;
const inFlight = new Set();
function writeLatch(stopped) {
  const operation = safetyWrite.catch(() => {}).then(() => chrome.storage.local.set({ [SAFETY]: { stopped } }));
  safetyWrite = operation;
  operation.catch(() => {});
  return operation;
}
function halt() {
  halted = true; epoch++;
  session.enabled = false;
  session.status = 'stopping';
  session.detail = 'Stopping protection…';
  writeLatch(true);
}
async function load() {
  settings = C.preferences((await chrome.storage.local.get('settings')).settings);
  const saved = (await store.get(KEY))[KEY];
  if (saved && typeof saved === 'object' && (saved.tabId === null || C.validId(saved.tabId)) &&
      Array.isArray(saved.documents) && saved.documents.every(doc => doc && C.validId(doc.frameId) && (doc.documentId === null || typeof doc.documentId === 'string'))) {
    session = { ...empty(), tabId: saved.tabId, initialized: saved.initialized === true, enabled: saved.enabled === true,
      documents: saved.documents, controllerId: C.validId(saved.controllerId) ? saved.controllerId : null,
      touchedTabs: Array.isArray(saved.touchedTabs) ? saved.touchedTabs.filter(C.validId) : [],
      cleanupTabs: Array.isArray(saved.cleanupTabs) ? saved.cleanupTabs.filter(C.validId) : [],
      status: ['off','protected','permission','unsupported','waiting','closed','error','stopping','cleanup'].includes(saved.status) ? saved.status : 'off',
      detail: C.errorText(saved.detail || ''), notice: C.errorText(saved.notice || '') };
  } else if (saved !== undefined) session = { ...empty(), initialized: true, notice: 'Saved session could not be recovered. Choose a tab.' };
  const safety = (await chrome.storage.local.get(SAFETY))[SAFETY];
  if (halted || safety?.stopped === true) {
    halted = true; session.enabled = false;
    if (session.documents.length || session.cleanupTabs.length || session.touchedTabs.length) { session.status = 'cleanup'; session.detail = 'Automatic protection is off. Run emergency stop to finish cleanup.'; }
    else { session.status = session.status === 'closed' ? 'closed' : 'off'; session.detail = ''; }
  } else if (session.enabled) {
    const value = await tab();
    const pattern = C.origin(value?.url);
    if (pattern && !await chrome.permissions.contains({ origins: [pattern] }).catch(() => false)) {
      session.enabled = false;
      session.status = session.documents.length ? 'cleanup' : 'off';
      session.detail = session.documents.length ? 'Automatic protection is off. Use emergency stop to finish cleanup.' : '';
    }
  }
}
function ready() {
  if (!initialization) initialization = load().catch(error => { initialization = null; throw error; });
  return initialization;
}
function run(operation) {
  const result = queue.then(ready).then(operation);
  queue = result.catch(() => {});
  return result;
}
function event(operation) {
  return run(operation).catch(async error => { session.notice = C.errorText(error); if (initialization) await save().catch(() => {}); });
}
async function save() {
  await store.set({ [KEY]: session });
  await Promise.allSettled([
    Promise.resolve().then(() => chrome.action?.setBadgeText({ text: session.status === 'protected' && session.enabled && !halted ? 'ON' : session.status === 'stopping' ? '…' : session.status === 'cleanup' || session.enabled ? '!' : '' })),
    Promise.resolve().then(() => chrome.action?.setBadgeBackgroundColor({ color: session.status === 'protected' ? '#21856b' : '#d84659' }))
  ]);
}
async function persistStopped() {
  try { await save(); }
  catch {
    // A full/broken storage area must not stop physical cleanup. If the off
    // intent cannot be stored, remove host grants as an independent safeguard.
    try {
      const granted = await chrome.permissions.getAll();
      if (granted.origins?.length && !await chrome.permissions.remove({ origins: granted.origins })) throw new Error('Grant removal failed');
      session.notice = 'Protection stopped. Website access was removed because the off state could not be saved.';
    } catch { session.notice = 'Protection stopped for this session. Off could not be saved; disable the extension before restarting the browser.'; }
  }
}
async function tab(id = session.tabId) {
  if (!C.validId(id)) return null;
  try { return await chrome.tabs.get(id); }
  catch (error) { if (/no tab|invalid tab|not found|does not exist|closed/i.test(error.message)) return null; throw error; }
}
function eligible(value) { return !value.incognito && !C.reserved(value) && !value.url?.startsWith(chrome.runtime.getURL('')); }
async function tabs() { return (await chrome.tabs.query({ windowType: 'normal' })).filter(eligible); }
async function initialize(windowId) {
  if (session.initialized) return;
  const value = C.candidate(await tabs(), windowId);
  if (!value) return;
  session.tabId = value.id;
  session.initialized = true;
  await save();
}
async function snapshot() {
  return { session: { ...session, stoppingWork: emergencyRuns > 0 }, settings, tabs: (await tabs()).map(value => ({ id: value.id, title: value.title || 'Untitled tab', url: value.url || '', supported: !!C.origin(value.url), discarded: !!value.discarded })) };
}
async function frames(id) { return await chrome.webNavigation.getAllFrames({ tabId: id }) || []; }
async function inject(id, frameId, enabled) {
  const generation = epoch;
  const operation = (async () => {
    let target = { tabId: id, frameIds: [frameId] };
    if (enabled) {
      if (halted || !session.enabled) return null;
      const frame = await chrome.webNavigation.getFrame?.({ tabId: id, frameId });
      if (frame?.documentId) target = { tabId: id, documentIds: [frame.documentId] };
      if (halted || !session.enabled || generation !== epoch) return null;
      await chrome.scripting.executeScript({ target, world: 'ISOLATED', injectImmediately: true, func: antiRedTagLifecycle });
      if (halted || !session.enabled || generation !== epoch) return null;
    }
    const result = await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: antiRedTagProtection, args: [enabled] });
    if (enabled && (halted || !session.enabled || generation !== epoch)) {
      await chrome.scripting.executeScript({ target: { tabId: id, ...(result[0]?.documentId ? { documentIds: [result[0].documentId] } : { frameIds: [frameId] }) }, world: 'MAIN', injectImmediately: true, func: antiRedTagProtection, args: [false] });
      return null;
    }
    return result[0];
  })();
  inFlight.add(operation);
  try { return await operation; } finally { inFlight.delete(operation); }
}
async function resume(sender) {
  const generation = epoch;
  const enabled = sender.tab.id === session.tabId && session.enabled && !halted;
  const target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId] };
  const operation = chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: antiRedTagProtection, args: [enabled] });
  inFlight.add(operation);
  let result;
  try {
    result = await operation;
    if (enabled && (generation !== epoch || halted || !session.enabled)) {
      await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: antiRedTagProtection, args: [false] });
      return;
    }
  } finally { inFlight.delete(operation); }
  if (sender.tab.id === session.tabId) {
    if (enabled && result[0]?.result?.applied) {
      remember(sender.frameId, result[0]);
      if (sender.frameId === 0) { session.status = 'protected'; session.detail = ''; }
    } else if (!enabled) session.documents = session.documents.filter(doc => doc.frameId !== sender.frameId);
    await save();
  }
}
function remember(frameId, result) {
  session.documents = session.documents.filter(doc => doc.frameId !== frameId);
  session.documents.push({ frameId, documentId: result?.documentId || null });
}
async function apply() {
  if (!session.enabled || halted) return;
  const generation = epoch;
  const value = await tab();
  session.detail = '';
  if (!value) { session.status = 'closed'; session.documents = []; session.detail = 'Choose another tab.'; }
  else if (value.discarded) { session.status = 'waiting'; session.documents = []; session.detail = 'Open the selected tab to wake it.'; }
  else if (!C.origin(value.url)) { session.status = 'unsupported'; session.detail = 'Choose an HTTP or HTTPS page.'; }
  else {
    try {
      if (!await chrome.permissions.contains({ origins: [C.origin(value.url)] })) {
        session.status = 'permission'; session.detail = 'Allow access to protect this website.';
      } else {
        if (!session.touchedTabs.includes(value.id)) session.touchedTabs.push(value.id);
        await save();
        const result = await inject(value.id, 0, true);
        if (halted || !session.enabled || generation !== epoch) return;
        if (!result?.result?.applied) throw new Error('The page did not confirm protection. Reload it and retry.');
        remember(0, result);
        session.status = 'protected';
        // Cover permitted child documents without granting unrelated sites access.
        const current = await frames(value.id).catch(() => null);
        if (current) session.documents = session.documents.filter(doc => doc.frameId === 0 || current.some(frame => frame.frameId === doc.frameId && (!doc.documentId || frame.documentId === doc.documentId)));
        for (const frame of current || []) {
          if (halted || !session.enabled || generation !== epoch) break;
          if (frame.frameId === 0 || !C.origin(frame.url)) continue;
          if (!await chrome.permissions.contains({ origins: [C.origin(frame.url)] })) continue;
          try { const child = await inject(value.id, frame.frameId, true); if (child?.result?.applied) remember(frame.frameId, child); }
          catch { /* A child may navigate or close between enumeration and injection. */ }
        }
      }
    } catch (error) { if (!halted && generation === epoch) { session.status = 'error'; session.detail = C.errorText(error); } }
  }
  await save();
}
async function cleanTab(id) {
  const value = await tab(id);
  if (!value || value.discarded) return true;
  const current = await frames(id);
  if (C.origin(value.url) && !current.some(frame => frame.frameId === 0)) return false;
  let clean = true;
  // Inspect live frames even when session bookkeeping was lost.
  for (const frame of current) {
    const pattern = C.origin(frame.url);
    if (!pattern) continue;
    if (!await chrome.permissions.contains({ origins: [pattern] })) {
      if ((frame.frameId === 0 && session.touchedTabs.includes(id)) || (id === session.tabId && session.documents.some(doc => doc.frameId === frame.frameId && (!doc.documentId || doc.documentId === frame.documentId)))) clean = false;
      continue;
    }
    try { const result = await inject(id, frame.frameId, false); if (result?.result?.clean !== true) clean = false; }
    catch { clean = false; }
  }
  return clean;
}
async function stop({ transfer = false } = {}) {
  if (!transfer && !halted) halt();
  session.enabled = false;
  if (!transfer) await safetyWrite.catch(() => {});
  await save().catch(() => {});
  const id = session.tabId;
  let clean = true;
  try { if (C.validId(id)) clean = await cleanTab(id); }
  catch (error) {
    session.status = 'cleanup'; session.cleanupTabs = C.validId(id) ? [id] : [];
    session.detail = 'Automatic protection is off. Cleanup could not finish; retry emergency stop or reload the affected tab.';
    await persistStopped(); throw error;
  }
  if (!clean) {
    session.status = 'cleanup'; session.cleanupTabs = C.validId(id) ? [id] : [];
    session.detail = 'Automatic protection is off. Reload the affected tab to clear remaining changes.';
    await persistStopped(); throw new Error(session.detail);
  }
  session.status = 'off'; session.documents = []; session.detail = '';
  session.touchedTabs = session.touchedTabs.filter(value => value !== id);
  session.cleanupTabs = session.cleanupTabs.filter(value => value !== id);
  await persistStopped();
}
async function sweep() {
  const all = (await chrome.tabs.query({})).filter(eligible);
  const ids = new Set([...session.touchedTabs, ...session.cleanupTabs, ...(C.validId(session.tabId) ? [session.tabId] : [])]);
  for (const value of all) if (C.origin(value.url) && await chrome.permissions.contains({ origins: [C.origin(value.url)] })) ids.add(value.id);
  const failed = [];
  for (const id of ids) {
    try { if (!await cleanTab(id)) failed.push(id); } catch { failed.push(id); }
  }
  session.cleanupTabs = failed;
  return failed;
}
async function finishEmergency(generation) {
  await sweep();
  if (inFlight.size) await Promise.allSettled([...inFlight]);
  if (generation !== epoch || !halted) return;
  await sweep();
  if (generation !== epoch || !halted) return;
  session.enabled = false;
  session.status = session.cleanupTabs.length ? 'cleanup' : 'off';
  session.documents = [];
  if (!session.cleanupTabs.length) session.touchedTabs = [];
  session.detail = session.cleanupTabs.length ? 'Automatic protection is off. Reload affected tabs to remove remaining changes. Unsaved edits may be lost.' : '';
  session.notice = session.cleanupTabs.length ? '' : 'Emergency stop complete. Protection is off.';
  await persistStopped();
}
async function emergencyStop() {
  // Emergency cleanup must not depend on healthy saved settings. A live
  // permission-scoped sweep can find our page markers without session data.
  await ready().catch(() => {});
  session.enabled = false; session.status = 'stopping'; session.detail = 'Stopping all protection…';
  await safetyWrite.catch(() => {});
  await save().catch(() => {});
  const generation = epoch;
  emergencyRuns++;
  emergencyTask = finishEmergency(generation).catch(async error => {
    if (generation !== epoch) return;
    session.enabled = false; session.status = 'cleanup';
    if (C.validId(session.tabId) && !session.cleanupTabs.includes(session.tabId)) session.cleanupTabs.push(session.tabId);
    session.detail = `Protection is stopped. Cleanup needs attention: ${C.errorText(error)}`; await save().catch(() => {});
  }).finally(async () => { emergencyRuns--; await save().catch(() => {}); });
  return snapshot();
}
async function reloadAffected() {
  await ready().catch(() => {});
  const ids = [...new Set([...session.cleanupTabs, ...((inFlight.size || !session.cleanupTabs.length) && C.validId(session.tabId) ? [session.tabId] : [])])];
  const failed = [];
  for (const id of ids) {
    try {
      const value = await tab(id);
      if (value && C.origin(value.url)) {
        const before = (await frames(id)).find(frame => frame.frameId === 0)?.documentId;
        await chrome.tabs.reload(id);
        let replaced = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          const current = await tab(id);
          if (!current) { replaced = true; break; }
          const main = (await frames(id)).find(frame => frame.frameId === 0);
          if (main?.documentId && main.documentId !== before) { replaced = true; break; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!replaced) throw new Error('Reload did not finish.');
        session.touchedTabs = session.touchedTabs.filter(value => value !== id);
        if (id === session.tabId) session.documents = [];
      }
    }
    catch { failed.push(id); }
  }
  session.cleanupTabs = failed;
  return emergencyStop();
}
function expected(message) {
  if (Object.hasOwn(message, 'tabId') && message.tabId !== session.tabId) throw new Error('The selected tab changed in another controller. Try again.');
}
async function select(id) {
  const value = await tab(id);
  if (!value || !eligible(value)) throw new Error('That tab is unavailable. Choose another tab.');
  if (!C.origin(value.url)) throw new Error('Choose an HTTP or HTTPS page.');
  if (id === session.tabId) { session.notice = 'Tab selected.'; await save(); return; }
  const enabled = session.enabled && !halted;
  const generation = epoch;
  if (enabled || session.documents.length) await stop({ transfer: true });
  if (generation !== epoch) throw new Error('Protection was stopped. Select the tab again.');
  session.tabId = id;
  session.initialized = true;
  session.enabled = enabled;
  session.notice = 'Tab selected.';
  if (enabled) await apply();
  else { session.status = 'off'; session.detail = ''; session.documents = []; await save(); }
}
async function openController() {
  if (C.validId(session.controllerId)) {
    let win;
    try { win = await chrome.windows.get(session.controllerId); }
    catch (error) { if (!/no window|invalid window|not found|closed/i.test(error.message)) throw error; }
    if (win) { await chrome.windows.update(win.id, { focused: true }); return; }
  }
  const win = await chrome.windows.create({ type: 'popup', url: chrome.runtime.getURL('controller.html?detached=1'), width: 410, height: 540 });
  session.controllerId = win.id;
  await save();
}
async function dispatch(message) {
  if (!message || typeof message !== 'object') throw new Error('Invalid action.');
  switch (message.type) {
    case 'state': await initialize(message.windowId); return snapshot();
    case 'select':
      if (Object.hasOwn(message, 'expectedTabId') && message.expectedTabId !== session.tabId) throw new Error('The selected tab changed. Review it and try again.');
      await select(message.tabId); break;
    case 'detect': {
      expected(message);
      const value = C.candidate(await tabs(), message.windowId);
      if (!value) throw new Error('Open a website tab first.');
      await select(value.id); break;
    }
    case 'protect':
      if (typeof message.enabled !== 'boolean') throw new Error('Invalid protection setting.');
      if (message.enabled) {
        expected(message);
        if (message.controlEpoch !== undefined && message.controlEpoch !== epoch) throw new Error('Protection was stopped. Press power again to restart.');
        if (session.cleanupTabs.length || ['cleanup','stopping'].includes(session.status) || inFlight.size || emergencyRuns) throw new Error('Finish emergency cleanup before restarting protection.');
        const generation = epoch;
        await writeLatch(false);
        if (generation !== epoch) throw new Error('Protection was stopped. Press power again to restart.');
        halted = false; epoch++; session.enabled = true; session.notice = ''; await apply();
      }
      else { await stop(); session.notice = ''; await save(); }
      break;
    case 'theme': {
      const previous = settings;
      settings = C.preferences(message.settings);
      try { await chrome.storage.local.set({ settings }); } catch (error) { settings = previous; throw error; }
      break;
    }
    case 'focus': {
      expected(message);
      const value = await tab();
      if (!value) throw new Error('The selected tab closed. Choose another tab.');
      const win = await chrome.windows.get(value.windowId);
      await chrome.tabs.update(value.id, { active: true });
      await chrome.windows.update(value.windowId, { focused: true, ...(win.state === 'minimized' ? { state: 'normal' } : {}) });
      break;
    }
    case 'controller': await openController(); break;
    case 'revoke': {
      expected(message);
      await stop();
      const granted = await chrome.permissions.getAll();
      if (granted.origins?.length && !await chrome.permissions.remove({ origins: granted.origins })) throw new Error('Website access could not be removed. Check extension site settings.');
      session.notice = 'Website access removed.'; await save(); break;
    }
    default: throw new Error('Unknown action.');
  }
  return snapshot();
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'document-resumed' && sender.id === chrome.runtime.id && C.validId(sender.tab?.id) && C.validId(sender.frameId)) {
    run(() => resume(sender)).then(() => respond({ ok: true }), error => respond({ ok: false, error: C.errorText(error) }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (message?.type === 'kill' || message?.type === 'reload-affected') {
    halt();
    (message.type === 'kill' ? emergencyStop() : reloadAffected()).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: C.errorText(error) }));
    return true;
  }
  if (message?.type === 'protect' && message.enabled === false) halt();
  if (message?.type === 'protect' && message.enabled === true) message = { ...message, controlEpoch: epoch };
  run(() => dispatch(message)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: C.errorText(error) }));
  return true;
});
chrome.runtime.onStartup.addListener(() => event(async () => { session = empty(); await save(); }));
chrome.tabs.onRemoved.addListener(id => event(async () => {
  if (id !== session.tabId) return;
  session.enabled = false; session.documents = []; session.status = 'closed'; session.detail = 'Choose another tab.'; session.notice = ''; await save();
}));
chrome.tabs.onReplaced.addListener((added, removed) => event(async () => {
  if (removed !== session.tabId) return;
  session.tabId = added; session.documents = []; if (session.enabled) await apply(); else await save();
}));
chrome.tabs.onUpdated.addListener((id, change) => {
  if (!change.status && !change.url && change.discarded === undefined) return;
  event(async () => { if (id === session.tabId && session.enabled) await apply(); });
});
chrome.webNavigation.onCommitted.addListener(info => event(async () => {
  if (info.tabId !== session.tabId) return;
  if (info.frameId === 0 && info.documentId && session.documents.some(doc => doc.frameId === 0 && doc.documentId && doc.documentId !== info.documentId)) {
    // This is a different top-level document, not a permission revocation on
    // the still-protected document. The old document is handled on resume.
    session.touchedTabs = session.touchedTabs.filter(id => id !== info.tabId);
  }
  session.documents = session.documents.filter(doc => doc.frameId !== info.frameId || !info.documentId || doc.documentId === info.documentId);
  if (session.enabled) await apply();
}));
chrome.permissions.onRemoved.addListener(() => event(async () => { if (session.enabled) await apply(); }));
chrome.commands.onCommand.addListener(command => event(async () => {
  if (command !== 'toggle-protection') return;
  let win; try { win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch { /* The controller may be alone. */ }
  await initialize(win?.id);
  if (session.enabled) await stop(); else await dispatch({ type: 'protect', enabled: true });
}));
chrome.commands.onCommand.addListener(command => {
  if (command !== 'emergency-stop') return;
  halt(); emergencyStop().catch(() => {});
});
