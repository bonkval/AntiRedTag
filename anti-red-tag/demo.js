(() => {
  if (globalThis.chrome?.runtime?.id) return;
  const state = { session: { tabId: 1, initialized: true, enabled: false, status: 'off', detail: '', documents: [], notice: '' }, settings: { theme: 'dark' }, tabs: [
    { id: 1, title: 'Research workspace', url: 'https://example.com/research', supported: true },
    { id: 2, title: 'Project notes', url: 'https://example.com/notes', supported: true },
    { id: 3, title: 'New tab', url: 'about:blank', supported: false }
  ] };
  globalThis.AntiDemo = { async send(message) {
    const s = state.session;
    switch (message.type) {
      case 'select': s.tabId = message.tabId; s.notice = 'Tab selected.'; break;
      case 'detect': s.tabId = 1; s.notice = 'Current tab selected.'; break;
      case 'protect': s.enabled = message.enabled; s.status = message.enabled ? 'protected' : 'off'; s.documents = message.enabled ? [{ frameId: 0, documentId: 'preview' }] : []; s.notice = ''; break;
      case 'kill':
      case 'reload-affected': s.enabled = false; s.status = 'off'; s.documents = []; s.cleanupTabs = []; s.notice = 'Emergency stop complete. Protection is off.'; break;
      case 'theme': state.settings = AntiCore.preferences(message.settings); break;
      case 'focus': s.notice = 'Install Anti Red-Tag to go to the real tab.'; break;
      case 'controller': s.notice = 'Install Anti Red-Tag to open a control window.'; break;
      case 'revoke': s.enabled = false; s.status = 'off'; s.documents = []; s.notice = 'Website access removed.'; break;
    }
    return structuredClone(state);
  } };
})();
