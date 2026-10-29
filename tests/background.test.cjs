const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/background.cjs');
async function chosen() { const f = fixture(); await f.send({type:'select',tabId:1}); return f; }
async function stopped(f) {
  for(let i=0;i<100;i++) {const state=await f.send({type:'state'});if(state.session.status!=='stopping'&&!state.session.stoppingWork)return state;await new Promise(resolve=>setTimeout(resolve,5));}
  throw new Error('Emergency cleanup did not finish');
}
test('protects exactly one chosen tab',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*');
  const state=await f.send({type:'protect',tabId:1,enabled:true});
  assert.equal(state.session.status,'protected'); assert.deepEqual([...f.injected],[1]);
  assert.equal(state.session.documents.length,1);
});
test('missing access is visible and can be disabled without pretending to inject',async()=>{
  const f=await chosen(); const state=await f.send({type:'protect',tabId:1,enabled:true});
  assert.equal(state.session.status,'permission'); assert.equal(f.injected.size,0);
  assert.equal((await f.send({type:'protect',enabled:false})).session.enabled,false);
});
test('transferring protection cleans the old tab before protecting the new tab',async()=>{
  const f=await chosen(); for(const id of [1,2]) f.grants.add(`https://site${id}.example/*`);
  await f.send({type:'protect',enabled:true});
  const state=await f.send({type:'select',tabId:2,expectedTabId:1});
  assert.equal(state.session.tabId,2); assert.deepEqual([...f.injected],[2]);
});
test('new website access is required on transfer without a grant',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*');
  await f.send({type:'protect',enabled:true});
  const state=await f.send({type:'select',tabId:2});
  assert.equal(state.session.status,'permission'); assert.equal(f.injected.size,0);
});
test('stale controllers cannot affect a different selected tab',async()=>{
  const f=await chosen(); await f.send({type:'select',tabId:2});
  await assert.rejects(f.send({type:'protect',tabId:1,enabled:true}),/changed/);
  await assert.rejects(f.send({type:'select',tabId:3,expectedTabId:1}),/changed/);
  assert.equal((await f.send({type:'state'})).session.tabId,2);
});
test('a closed selected tab is not silently replaced and choosing another clears the closed state',async()=>{
  const f=await chosen(); f.tabs.delete(1); await f.emit(f.chrome.tabs.onRemoved,1);
  assert.equal((await f.send({type:'state'})).session.tabId,1);
  const state=await f.send({type:'select',tabId:2});
  assert.equal(state.session.status,'off'); assert.equal(state.session.detail,'');
});
test('unsupported and private pages cannot be chosen for protection',async()=>{
  const f=await chosen(); f.tabs.get(2).url='about:blank'; f.tabs.get(3).incognito=true;
  await assert.rejects(f.send({type:'select',tabId:2}),/HTTP/);
  await assert.rejects(f.send({type:'select',tabId:3}),/unavailable/);
});
test('a removal error disables automatic protection and reports incomplete cleanup',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*'); await f.send({type:'protect',enabled:true});
  f.hooks.script=v=>{if(v.enabled===false) throw new Error('Access revoked');};
  await assert.rejects(f.send({type:'protect',enabled:false}),/Reload/);
  const state=await f.send({type:'state'}); assert.equal(state.session.enabled,false); assert.equal(state.session.status,'cleanup');
});
test('a browser API read failure stops automatic protection but does not falsely confirm cleanup',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*'); await f.send({type:'protect',enabled:true});
  f.hooks['tabs.get']=()=>{throw new Error('Browser temporarily unavailable');};
  await assert.rejects(f.send({type:'protect',enabled:false}),/temporarily unavailable/);
  assert.equal((await f.send({type:'state'})).session.enabled,false);
  assert.equal((await f.send({type:'state'})).session.status,'cleanup');
});
test('settings roll back if saving fails',async()=>{
  const f=await chosen(); f.hooks['local.set']=()=>{throw new Error('Storage full');};
  await assert.rejects(f.send({type:'theme',settings:{theme:'light'}}),/Storage full/);
  assert.equal((await f.send({type:'state'})).settings.theme,'dark');
});
test('initialization can retry a failed read',async()=>{
  const f=fixture(); let once=true; f.hooks['session.get']=()=>{if(once){once=false;throw new Error('Read failed');}};
  await assert.rejects(f.send({type:'state'}),/Read failed/); assert.ok((await f.send({type:'state'})).tabs.length);
});
test('badge failure cannot invalidate a successful selection',async()=>{
  const f=fixture(); f.hooks['badge.text']=()=>{throw new Error('Badge unavailable');};
  assert.equal((await f.send({type:'select',tabId:1})).session.tabId,1);
});
test('worker reactivation preserves selection while a full startup resets it',async()=>{
  const f=await chosen(); await f.send({type:'select',tabId:2}); f.boot();
  assert.equal((await f.send({type:'state'})).session.tabId,2);
  await f.emit(f.chrome.runtime.onStartup); assert.equal((await f.send({type:'state'})).session.enabled,false);
});
test('invalid saved session data does not block choosing a tab',async()=>{
  const f=fixture({session:{antiRedTagSessionV2:{tabId:'bad',documents:null}}});
  assert.match((await f.send({type:'state'})).session.notice,/recover/);
  assert.equal((await f.send({type:'select',tabId:2})).session.tabId,2);
});
test('a malformed saved document entry cannot break startup',async()=>{
  const f=fixture({session:{antiRedTagSessionV2:{tabId:1,documents:[null]}}});
  assert.match((await f.send({type:'state'})).session.notice,/recover/);
});
test('untrusted senders and malformed actions are rejected',async()=>{
  const f=await chosen(); await assert.rejects(f.send({type:'state'},{id:f.chrome.runtime.id,url:'https://site.example'}),/Sender rejected/);
  for(const message of [null,{}, {type:'protect',enabled:'false'}]) await assert.rejects(f.send(message));
});
test('navigation keeps tab identity and requires new-site access',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*'); await f.send({type:'protect',enabled:true});
  f.tabs.get(1).url='https://elsewhere.example/';
  const state=await f.emit(f.chrome.webNavigation.onCommitted,{tabId:1,frameId:0,documentId:'new-doc'});
  assert.equal(state.session.tabId,1); assert.equal(state.session.status,'permission');
});
test('keyboard command toggles the same single selected tab',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*');
  assert.equal((await f.emit(f.chrome.commands.onCommand,'toggle-protection')).session.status,'protected');
  assert.equal((await f.emit(f.chrome.commands.onCommand,'toggle-protection')).session.enabled,false);
});
test('no protection action moves tabs or resizes browser windows',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*'); await f.send({type:'protect',enabled:true}); await f.send({type:'protect',enabled:false});
  assert.equal(f.calls.some(call=>['tabs.move','windows.create','windows.update'].includes(call.name)),false);
});
test('a resumed cached document is cleaned even if late injection was not tracked when protection stopped',async()=>{
  const f=await chosen(); f.grants.add('https://site1.example/*');
  await f.send({type:'protect',enabled:true});await f.send({type:'protect',enabled:false});
  f.injected.add(1);
  await f.send({type:'document-resumed'},{id:f.chrome.runtime.id,url:'https://site1.example/',tab:{id:1},frameId:0,documentId:'document-1'});
  assert.equal(f.injected.has(1),false);
});
test('a cached previous tab cannot receive protection intended for the new selected tab',async()=>{
  const f=await chosen(); for(const id of [1,2]) f.grants.add(`https://site${id}.example/*`);
  await f.send({type:'protect',enabled:true});await f.send({type:'select',tabId:2});
  f.injected.add(1);
  await f.send({type:'document-resumed'},{id:f.chrome.runtime.id,url:'https://site1.example/',tab:{id:1},frameId:0,documentId:'document-1'});
  assert.deepEqual([...f.injected],[2]);
});
test('turning protection off disables intent even when script cleanup fails',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});
  f.hooks.script=value=>{if(value.enabled===false)throw new Error('Access revoked');};
  await f.send({type:'protect',enabled:false}).catch(()=>{});
  assert.equal((await f.send({type:'state'})).session.enabled,false,'Off must stop automatic reapplication even if page cleanup needs recovery');
});
test('off removes live protection even if its document record was lost',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});
  f.session.antiRedTagSessionV2.documents=[];f.boot();
  await f.send({type:'protect',enabled:false});
  assert.equal(f.injected.has(1),false,'Off must inspect current frames rather than trust only saved records');
});
test('kill switch clears current and untracked protection in other permitted tabs',async()=>{
  const f=await chosen();for(const id of [1,3])f.grants.add(`https://site${id}.example/*`);
  await f.send({type:'protect',enabled:true});f.injected.add(3);
  await f.send({type:'kill'});const state=await stopped(f);
  assert.equal(state.session.enabled,false);assert.equal(state.session.status,'off');assert.equal(f.injected.size,0);
});
test('kill switch preempts a stalled injection and removes its late result', {timeout:3000},async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});
  f.hooks.script=value=>{if(value.enabled===true){started();return new Promise(resolve=>{release=resolve;});}};
  const starting=f.send({type:'protect',enabled:true});await waiting;
  try{
    const state=await Promise.race([f.send({type:'kill'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Kill switch waited behind injection')),300))]);
    assert.equal(state.session.enabled,false);
  }finally{release();}
  await starting;const final=await stopped(f);assert.equal(final.session.status,'off');assert.equal(f.injected.size,0);
});
test('a persistent stop latch prevents old saved intent from reactivating after a worker reload',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});
  await f.send({type:'kill'});await stopped(f);
  f.session.antiRedTagSessionV2.enabled=true;f.session.antiRedTagSessionV2.status='protected';f.boot();
  assert.equal((await f.send({type:'state'})).session.enabled,false);
  const state=await f.emit(f.chrome.webNavigation.onCommitted,{tabId:1,frameId:0,documentId:'document-1'});
  assert.equal(state.session.enabled,false);assert.equal(f.injected.size,0);
});
test('revoked access keeps the latch off and explicit reload finishes cleanup',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});f.grants.clear();
  await f.send({type:'kill'});let state=await stopped(f);
  assert.equal(state.session.enabled,false);assert.equal(state.session.status,'cleanup');assert.deepEqual(state.session.cleanupTabs,[1]);
  await f.send({type:'reload-affected'});state=await stopped(f);
  assert.equal(state.session.status,'off');assert.equal(f.injected.has(1),false);
});
test('the dedicated emergency keyboard command is off-only',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});
  f.chrome.commands.onCommand.emit('emergency-stop');let state=await stopped(f);
  assert.equal(state.session.enabled,false);assert.equal(f.injected.size,0);
  f.chrome.commands.onCommand.emit('emergency-stop');state=await stopped(f);assert.equal(state.session.enabled,false);
});
test('storage failures cannot prevent emergency cleanup from removing live overrides',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});
  f.hooks['local.set']=()=>{throw new Error('Storage full');};f.hooks['session.set']=()=>{throw new Error('Storage full');};
  await f.send({type:'kill'});await stopped(f);
  assert.equal(f.injected.size,0);assert.equal((await f.send({type:'state'})).session.enabled,false);
  assert.equal(f.grants.size,0,'If off cannot be persisted, remove grants to prevent future automatic injection');
});
test('emergency cleanup still runs when saved settings cannot be read',async()=>{
  const f=await chosen();f.grants.add('https://site1.example/*');await f.send({type:'protect',enabled:true});
  f.hooks['local.get']=()=>{throw new Error('Settings unavailable');};f.boot();
  await f.send({type:'kill'});
  for(let i=0;i<100&&f.injected.size;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.injected.size,0);
  delete f.hooks['local.get'];assert.equal((await f.send({type:'state'})).session.enabled,false);
});
