(() => {
  const validId = value => Number.isInteger(value) && value >= 0;
  const preferences = value => ({ theme: value?.theme === 'light' ? 'light' : 'dark' });
  function origin(url) {
    try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin + '/*' : null; }
    catch { return null; }
  }
  function reserved(tab) {
    try { return tab.index === 0 && new URL(tab.url).hostname === 'gxcorner.games'; } catch { return false; }
  }
  function candidate(tabs, windowId) {
    return tabs.find(tab => tab.windowId === windowId && tab.active) ||
      tabs.filter(tab => tab.active).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || tabs[0] || null;
  }
  const errorText = error => String(error?.message ?? error).replace(/\b(?:https?|file|chrome|opera|chrome-extension):\/\/[^\s"'<>]+/gi, '[page]').slice(0, 1000);
  const api = { validId, preferences, origin, reserved, candidate, errorText };
  globalThis.AntiCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
