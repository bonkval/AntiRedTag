const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../anti-red-tag/core.js');
test('current window active tab takes precedence over other recently used tabs', () => {
  const tabs = [{id:1,windowId:10,active:true,lastAccessed:2},{id:2,windowId:20,active:true,lastAccessed:20}];
  assert.equal(C.candidate(tabs,10).id,1);
  assert.equal(C.candidate(tabs).id,2);
  assert.equal(C.candidate([]),null);
});
test('only HTTP/HTTPS pages receive host patterns and credentials/paths are excluded', () => {
  assert.equal(C.origin('https://user:pass@example.com/a?b=1'), 'https://example.com/*');
  for (const url of ['about:blank','opera://settings','file:///x','chrome-extension://x/a','invalid']) assert.equal(C.origin(url),null);
});
test('preferences tolerate corrupt input', () => {
  for (const value of [null,undefined,{},'wrong',55]) assert.deepEqual(C.preferences(value),{theme:'dark'});
  assert.deepEqual(C.preferences({theme:'light'}),{theme:'light'});
});
test('stored errors redact page URLs', () => { assert.equal(C.errorText(new Error('Cannot access https://private.example/path?secret=1')), 'Cannot access [page]'); });
