/* Self-contained: Chrome serializes this function into each permitted frame. */
function antiRedTagProtection(enabled) {
  const key = '__antiRedTagProtectionV2';
  const previous = window[key];
  if (!enabled) {
    let restored = false;
    for (const name of [key, '__gxSplitFocusShieldV1']) {
      const record = window[name];
      if (!record) continue;
      if (typeof record.restore !== 'function') throw new Error('Protection state changed. Reload this page.');
      record.restore(); restored = true;
      if (window[name]) throw new Error('Protection could not be cleared. Reload this page.');
    }
    if (restored) {
      // The website may have cached the focused/visible state while its native
      // notifications were suppressed. Let it read the restored native APIs.
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      if ('webkitHidden' in document) document.dispatchEvent(new Event('webkitvisibilitychange', { bubbles: true }));
      window.dispatchEvent(new FocusEvent(document.hasFocus() ? 'focus' : 'blur'));
    }
    return { applied: false, clean: true, restored };
  }
  if (previous) return { applied: previous.probe() };
  const properties = [];
  const listeners = [];
  function restore() {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener, true);
    let failure;
    for (const [property, descriptor] of [...properties].reverse()) {
      try {
        if (descriptor) Object.defineProperty(document, property, descriptor);
        else delete document[property];
      } catch (error) { failure = error; }
    }
    if (failure) throw failure;
    delete window[key];
  }
  function override(property, descriptor) {
    const original = Object.getOwnPropertyDescriptor(document, property);
    Object.defineProperty(document, property, { ...descriptor, configurable: true });
    properties.push([property, original]);
  }
  try {
    override('hidden', { get: () => false });
    override('visibilityState', { get: () => 'visible' });
    override('hasFocus', { value: () => true, writable: true });
    if ('webkitHidden' in document) override('webkitHidden', { get: () => false });
    if ('webkitVisibilityState' in document) override('webkitVisibilityState', { get: () => 'visible' });
    const block = event => {
      if ((['blur', 'focusout'].includes(event.type) && [window, document].includes(event.target)) ||
          (event.type.includes('visibilitychange') && event.target === document)) event.stopImmediatePropagation();
    };
    for (const type of ['blur', 'focusout', 'visibilitychange', 'webkitvisibilitychange']) {
      window.addEventListener(type, block, true);
      listeners.push([window, type, block]);
    }
    window.addEventListener('pagehide', restore, true);
    listeners.push([window, 'pagehide', restore]);
    const probe = () => document.hidden === false && document.visibilityState === 'visible' && document.hasFocus() === true;
    Object.defineProperty(window, key, { configurable: true, value: { probe, restore } });
    return { applied: probe() };
  } catch (error) {
    restore();
    throw error;
  }
}
if (typeof module !== 'undefined') module.exports = antiRedTagProtection;
