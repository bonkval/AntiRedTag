/* Runs in the extension's isolated world, not the website's JavaScript world. */
function antiRedTagLifecycle() {
  const key = '__antiRedTagLifecycleV2';
  if (window[key]) return;
  window[key] = true;
  window.addEventListener('pageshow', () => {
    // A cached document can resume after the user stopped protection or chose
    // another tab. Ask the extension to reconcile this exact document.
    try { chrome.runtime.sendMessage({ type: 'document-resumed' }).catch(() => {}); }
    catch { /* The extension may have been unloaded while this page was cached. */ }
  }, true);
}
