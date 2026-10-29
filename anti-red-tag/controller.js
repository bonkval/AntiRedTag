(() => {
  const $ = id => document.getElementById(id);
  const real = !!globalThis.chrome?.runtime?.id;
  const detached = new URLSearchParams(location.search).has('detached');
  document.body.classList.toggle('detached', detached);
  document.body.classList.toggle('preview', !real);
  $('demo-banner').hidden = real;
  $('detach').hidden = detached;
  for (const element of document.querySelectorAll('[data-icon]')) element.append(AntiIcons.draw(element.dataset.icon));
  let state;
  let busy = false;
  let generation = 0;
  let windowId;
  let timer;
  let error = '';
  const selected = () => state?.tabs.find(tab => tab.id === state.session.tabId);
  function icon(id, name, label) {
    $(id).replaceChildren(AntiIcons.draw(name));
    if (label) { $(id).setAttribute('aria-label', label); $(id).title = label; }
  }
  function feedback(id, text) { $(id).textContent = text; $(id).hidden = !text; }
  async function request(message) {
    if (!real) return AntiDemo.send(message);
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'No response. Reload the extension and try again.');
    return response.data;
  }
  function render() {
    if (!state) return;
    const { session, settings } = state;
    const value = selected();
    $('controls').inert = false;
    document.documentElement.dataset.theme = settings.theme;
    icon('theme', settings.theme === 'dark' ? 'sun' : 'moon', `Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`);
    $('protect').setAttribute('aria-pressed', String(session.enabled));
    $('protect').dataset.status = session.status;
    const label = session.enabled ? 'Stop protecting selected tab' : 'Protect selected tab';
    $('protect').setAttribute('aria-label', label); $('protect').title = label;
    $('protect').disabled = busy || session.stoppingWork || ['cleanup','stopping'].includes(session.status) || (!session.enabled && !value?.supported);
    const headings = { off: 'Protection off', protected: 'Protected', permission: 'Access needed', error: 'Needs attention', waiting: 'Waiting for tab', closed: 'Tab closed', unsupported: 'Page unavailable', stopping: 'Stopping…', cleanup: 'Reload needed' };
    $('protection-status').textContent = headings[session.status] || 'Protection off';
    $('state-label').textContent = ['cleanup','stopping'].includes(session.status) ? 'Automatic protection disabled' : busy ? 'Updating…' : session.status === 'protected' ? 'Focus & visibility signals blocked' : value?.supported ? 'Ready' : 'Choose a website tab';
    $('state-label').dataset.status = session.status;
    $('tab-title').textContent = value?.title || (session.tabId !== null ? 'Tab closed — choose another' : 'Choose a tab');
    $('tab-title').title = value?.title || '';
    for (const id of ['choose-tab', 'theme', 'help', 'detect', 'detach', 'grant', 'revoke']) $(id).disabled = busy;
    $('focus').disabled = busy || !value;
    document.querySelectorAll('.tab-option').forEach(button => { button.disabled = busy || button.dataset.supported !== 'true'; });
    $('grant').hidden = !session.enabled || !['permission', 'waiting', 'error'].includes(session.status);
    $('retry-load').hidden = true;
    $('kill').disabled = false;
    const offerReset = ['cleanup','stopping'].includes(session.status) || (session.status === 'off' && session.notice?.startsWith('Emergency stop complete'));
    $('reload-affected').hidden = !offerReset;
    $('reload-affected').disabled = false;
    let message = error || session.detail || session.notice;
    if (offerReset && !/unsaved/i.test(message)) message += session.status === 'off' ? ' Use the reload icon to reset site-cached state. Unsaved edits may be lost.' : ' Reloading affected tabs may lose unsaved edits.';
    feedback('feedback', message);
    $('feedback').classList.toggle('error', !!error || ['error', 'permission'].includes(session.status));
    $('coverage').textContent = session.status === 'protected' ? `Applied to ${session.documents.length} accessible document${session.documents.length === 1 ? '' : 's'}` : headings[session.status] || 'Off';
    document.body.classList.toggle('busy', busy);
  }
  async function grant(value) {
    const pattern = AntiCore.origin(value?.url);
    if (!pattern) throw new Error('Choose an HTTP or HTTPS page.');
    if (real && !await chrome.permissions.request({ origins: [pattern] })) throw new Error('Access declined. Allow this website to enable protection.');
  }
  async function action(message, prepare) {
    if (busy) return false;
    busy = true; const ticket = ++generation; error = ''; feedback('picker-feedback', ''); render();
    try {
      if (prepare) await prepare();
      if (ticket !== generation) return false;
      const next = await request(message);
      if (ticket !== generation) return false;
      state = next;
      return true;
    } catch (problem) {
      if (ticket !== generation) return false;
      error = problem.message;
      if ($('tab-dialog').open) feedback('picker-feedback', error);
      try { const next = await request({ type: 'state', windowId }); if (ticket === generation) state = next; } catch { /* Keep the original error. */ }
      return false;
    } finally { if (ticket === generation) { busy = false; render(); } }
  }
  async function emergency(type = 'kill') {
    const ticket = ++generation;
    busy = true; error = '';
    if ($('tab-dialog').open) $('tab-dialog').close();
    if (state) { state.session.enabled = false; state.session.status = 'stopping'; state.session.detail = 'Stopping all protection…'; render(); }
    try {
      const next = await request({ type });
      if (ticket === generation) state = next;
    } catch (problem) {
      if (ticket === generation) {
        error = `Could not verify complete cleanup: ${problem.message}`;
        if (state) { state.session.enabled = false; state.session.status = 'cleanup'; }
        feedback('feedback', error);
      }
    } finally { if (ticket === generation) { busy = false; render(); if (state) watch(); } }
  }
  function options() {
    const query = $('tab-search').value.trim().toLocaleLowerCase();
    $('tab-options').replaceChildren();
    for (const value of state.tabs.filter(tab => tab.title.toLocaleLowerCase().includes(query))) {
      const button = document.createElement('button');
      button.className = 'tab-option'; button.type = 'button'; button.dataset.supported = String(value.supported);
      button.disabled = !value.supported;
      button.setAttribute('aria-pressed', String(value.id === state.session.tabId));
      button.title = value.supported ? value.title : 'This browser page cannot be protected';
      const title = document.createElement('span'); title.textContent = value.title;
      button.append(AntiIcons.draw('tab', 18), title);
      if (value.id === state.session.tabId) button.append(AntiIcons.draw('check', 18));
      button.addEventListener('click', async () => {
        const enabled = state.session.enabled;
        const ok = await action({ type: 'select', tabId: value.id, expectedTabId: state.session.tabId }, enabled ? () => grant(value) : null);
        if (ok) $('tab-dialog').close(); else { options(); render(); }
      });
      $('tab-options').append(button);
    }
    if (!$('tab-options').children.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching tabs.'; $('tab-options').append(empty);
    }
  }
  $('choose-tab').addEventListener('click', async () => {
    if (busy) return;
    busy = true; const ticket = ++generation; $('tab-search').value = ''; feedback('picker-feedback', '');
    $('tab-options').textContent = 'Loading…'; $('tab-dialog').showModal(); render();
    try { const next = await request({ type: 'state', windowId }); if (ticket === generation) { state = next; options(); } }
    catch (problem) { if (ticket === generation) feedback('picker-feedback', problem.message); }
    finally { if (ticket === generation) { busy = false; render(); if ($('tab-dialog').open) $('tab-search').focus(); } }
  });
  $('tab-search').addEventListener('input', () => { if (!busy) options(); });
  $('close-picker').addEventListener('click', () => $('tab-dialog').close());
  $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('protect').addEventListener('click', () => {
    const enabled = !state.session.enabled;
    action({ type: 'protect', tabId: state.session.tabId, enabled }, enabled ? () => grant(selected()) : null);
  });
  $('kill').addEventListener('click', () => emergency());
  $('reload-affected').addEventListener('click', () => emergency('reload-affected'));
  $('grant').addEventListener('click', () => action({ type: 'protect', tabId: state.session.tabId, enabled: true }, () => grant(selected())));
  $('theme').addEventListener('click', () => action({ type: 'theme', settings: { theme: state.settings.theme === 'dark' ? 'light' : 'dark' } }));
  $('focus').addEventListener('click', () => action({ type: 'focus', tabId: state.session.tabId }));
  $('detect').addEventListener('click', () => action({ type: 'detect', tabId: state.session.tabId, windowId }));
  $('detach').addEventListener('click', () => action({ type: 'controller' }));
  $('revoke').addEventListener('click', async () => {
    const ok = await action({ type: 'revoke', tabId: state.session.tabId });
    feedback('help-feedback', ok ? 'Protection stopped. Website access removed.' : error);
  });
  async function refresh() {
    if (busy || $('tab-dialog').open || !document.hasFocus()) return;
    const ticket = ++generation;
    try {
      const next = await request({ type: 'state', windowId });
      if (ticket !== generation || busy || $('tab-dialog').open) return;
      if (next.session.status === 'off' && ['cleanup','stopping'].includes(state?.session.status)) error = '';
      state = next; render();
    } catch (problem) { if (ticket === generation && !busy) feedback('feedback', problem.message); }
  }
  async function load() {
    if (busy) return;
    busy = true; const ticket = ++generation; $('controls').inert = true;
    for (const id of ['theme','help']) $(id).disabled = true;
    try {
      if (real) {
        const current = await chrome.windows.getCurrent();
        windowId = current.type === 'normal' ? current.id : (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null))?.id;
      }
      const next = await request({ type: 'state', windowId });
      if (ticket !== generation) return;
      state = next; error = ''; busy = false; render(); watch();
    } catch (problem) {
      if (ticket !== generation) return;
      $('controls').inert = true;
      document.querySelectorAll('main button').forEach(button => { button.disabled = button.id !== 'kill'; });
      feedback('feedback', problem.message); $('feedback').classList.add('error');
      $('retry-load').hidden = false; $('retry-load').disabled = false;
    } finally { if (ticket === generation) busy = false; }
  }
  function watch() {
    if (timer) return;
    timer = setInterval(refresh, 1400); window.addEventListener('focus', refresh);
    if (real) chrome.storage.onChanged.addListener(refresh);
  }
  $('retry-load').addEventListener('click', load);
  load();
})();
