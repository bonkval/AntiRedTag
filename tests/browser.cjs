const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const source = path.resolve(__dirname,'../anti-red-tag');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,predicate,label) { for(let i=0;i<60;i++){const value=await fn();if(predicate(value))return value;await sleep(80);}throw new Error(label); }
const send=(page,message)=>page.evaluate(async message=>{const response=await chrome.runtime.sendMessage(message);if(!response.ok)throw new Error(response.error);return response.data;},message);
(async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'anti-red-tag-test-'));
  await fs.mkdir(path.resolve(__dirname,'../test-results'),{recursive:true});
  let origin='';
  const server=http.createServer((req,res)=>{
    res.writeHead(200,{'Content-Type':'text/html'});
    const primary=req.url.split('?')[0]==='/Primary';
    res.end(`<!doctype html><title>${req.url.slice(1)}</title><input id="first"><input id="second">${primary?`<iframe src="/Child"></iframe><iframe src="${origin.replace('127.0.0.1','localhost')}/Foreign"></iframe>`:''}<script>window.originalListener=EventTarget.prototype.addEventListener;window.elementBlur=0;document.querySelector('#first').addEventListener('blur',()=>window.elementBlur++);window.cached=false;window.addEventListener('pageshow',e=>{window.cached=e.persisted;});</script>`);
  });
  await new Promise(resolve=>server.listen(0,resolve));origin=`http://127.0.0.1:${server.address().port}`;
  let context;
  let checks=0;
  const errors=[];
  const pass=label=>{checks++;console.log(`PASS ${label}`);};
  async function launch(directory,profile){
    const value=await chromium.launchPersistentContext(profile,{
      ...(process.env.GX_BROWSER_PATH?{executablePath:process.env.GX_BROWSER_PATH}:{channel:'chromium'}),
      headless:true,viewport:null,ignoreDefaultArgs:['--disable-back-forward-cache'],
      args:[`--disable-extensions-except=${directory}`,`--load-extension=${directory}`]
    });
    value.setDefaultTimeout(6000);
    value.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    const worker=value.serviceWorkers()[0]||await value.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;
    const controller=await value.newPage();await controller.goto(`chrome-extension://${id}/controller.html?detached=1`);
    await controller.waitForFunction(()=>!document.getElementById('controls').inert);
    return{context:value,controller,id};
  }
  try{
    let app=await launch(source,path.join(temporary,'production'));context=app.context;
    let controller=app.controller;
    let a=await context.newPage();await a.goto(origin+'/Primary');
    let b=await context.newPage();await b.goto(origin+'/Other');
    let state=await send(controller,{type:'state'});
    let idA=state.tabs.find(tab=>tab.url===origin+'/Primary').id;
    let idB=state.tabs.find(tab=>tab.url===origin+'/Other').id;
    await send(controller,{type:'select',tabId:idA});
    state=await send(controller,{type:'protect',tabId:idA,enabled:true});
    assert.equal(state.session.status,'permission');assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    await send(controller,{type:'protect',enabled:false});
    pass('production manifest needs explicit website access before injecting');
    await controller.bringToFront();await controller.reload();await controller.waitForFunction(()=>!document.getElementById('controls').inert);
    assert.equal(await controller.title(),'Anti Red-Tag');
    assert.equal(await controller.locator('#theme svg').getAttribute('data-icon'),'sun');
    await controller.getByRole('button',{name:'Switch to light mode',exact:true}).click();
    await controller.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    assert.equal(await controller.locator('#theme svg').getAttribute('data-icon'),'moon');
    await controller.screenshot({path:'test-results/anti-red-tag-light.png',fullPage:true});
    await controller.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
    await controller.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await controller.screenshot({path:'test-results/anti-red-tag-dark.png',fullPage:true});
    assert.equal(await controller.locator('button:not([aria-label]):not(.tab-option)').count(),0);
    pass('new brand and consistent labeled icons work in both themes');
    await a.close();await controller.bringToFront();
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='closed','Tab closure was not reflected');
    await controller.locator('#choose-tab').click();await controller.getByRole('button',{name:'Other',exact:true}).click();
    await controller.waitForFunction(()=>document.querySelector('#tab-title').textContent==='Other');
    assert.equal((await send(controller,{type:'state'})).session.status,'off');
    pass('closed selected tab can be replaced through the real picker');
    await context.close();context=null;

    const fixture=path.join(temporary,'granted-extension');await fs.cp(source,fixture,{recursive:true});
    const manifest=JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];
    await fs.writeFile(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
    const profile=path.join(temporary,'granted-profile');
    app=await launch(fixture,profile);context=app.context;controller=app.controller;
    a=await context.newPage();await a.goto(origin+'/Primary');b=await context.newPage();await b.goto(origin+'/Other');
    state=await send(controller,{type:'state'});idA=state.tabs.find(tab=>tab.url===origin+'/Primary').id;idB=state.tabs.find(tab=>tab.url===origin+'/Other').id;
    await send(controller,{type:'select',tabId:idA});await controller.bringToFront();await controller.reload();
    await controller.waitForFunction(()=>!document.getElementById('controls').inert);
    const boundsBefore=await controller.evaluate(()=>chrome.windows.getAll().then(windows=>windows.map(w=>({id:w.id,left:w.left,top:w.top,width:w.width,height:w.height}))));
    await controller.locator('#protect').click();
    state=await until(()=>send(controller,{type:'state'}),s=>s.session.status==='protected'&&s.session.documents.length>=2,'Protection was not applied to main page and child');
    assert.equal(await a.evaluate(()=>document.hidden),false);assert.equal(await a.evaluate(()=>document.visibilityState),'visible');assert.equal(await a.evaluate(()=>document.hasFocus()),true);
    assert.equal(await b.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    const child=a.frames().find(frame=>frame.url()===origin+'/Child');
    const foreign=a.frames().find(frame=>frame.url().includes('/Foreign'));
    assert.equal(await child.evaluate(()=>Object.hasOwn(document,'hidden')),true);
    assert.equal(await foreign.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    assert.deepEqual(await controller.evaluate(()=>chrome.windows.getAll().then(windows=>windows.map(w=>({id:w.id,left:w.left,top:w.top,width:w.width,height:w.height})))),boundsBefore);
    pass('power control protects exactly one tab and permitted child frames without arranging windows');
    assert.equal(await a.evaluate(()=>EventTarget.prototype.addEventListener===window.originalListener),true);
    await a.locator('#first').focus();await a.locator('#second').focus();assert.equal(await a.evaluate(()=>window.elementBlur),1);
    assert.equal(await a.evaluate(()=>{let count=0;window.addEventListener('blur',()=>count++);window.addEventListener('focusout',()=>count++);document.addEventListener('visibilitychange',()=>count++);window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focusout'));document.dispatchEvent(new Event('visibilitychange'));return count;}),0);
    pass('document/window focus signals are blocked while ordinary form behavior remains native');
    await a.evaluate(()=>{window.offEvents={visibility:0,blur:0};document.addEventListener('visibilitychange',()=>window.offEvents.visibility++);window.addEventListener('blur',()=>window.offEvents.blur++);});
    await controller.bringToFront();
    await controller.locator('#protect').click();
    await controller.waitForFunction(()=>document.querySelector('#protect').getAttribute('aria-pressed')==='false'&&document.querySelector('#protection-status').textContent==='Protection off');
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    assert.equal(await child.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    assert.ok(await a.evaluate(()=>window.offEvents.visibility>0),'Off must notify the page of its restored native visibility');
    if(!await a.evaluate(()=>document.hasFocus()))assert.ok(await a.evaluate(()=>window.offEvents.blur>0),'Off must resynchronize a page whose native blur was blocked');
    await a.reload();
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    await controller.bringToFront();await controller.locator('#protect').click();
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='protected','Could not restart explicitly after off');
    pass('real power-off removes overrides and navigation cannot silently re-enable them');
    const liveChild=a.frames().find(frame=>frame.url()===origin+'/Child');
    await a.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/Dynamic';document.body.append(frame);});
    await until(async()=>{const frame=a.frames().find(item=>item.url()===origin+'/Dynamic');return frame&&await frame.evaluate(()=>Object.hasOwn(document,'hidden'));},Boolean,'New frame was not protected');
    pass('new permitted frames receive protection as they load');
    await controller.bringToFront();await controller.locator('#choose-tab').click();await controller.getByRole('button',{name:'Other',exact:true}).click();
    state=await until(()=>send(controller,{type:'state'}),s=>s.session.tabId===idB&&s.session.status==='protected','Protection transfer failed');
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);assert.equal(await liveChild.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    assert.equal(await b.evaluate(()=>Object.hasOwn(document,'hidden')),true);
    pass('choosing another tab transfers protection and clears the previous tab and its frames');
    for(let i=0;i<3;i++){await send(controller,{type:'protect',enabled:false});await send(controller,{type:'protect',enabled:true});}
    await b.reload();await until(()=>b.evaluate(()=>Object.hasOwn(document,'hidden')),Boolean,'Reload did not reapply');
    pass('repeated toggles and reload preserve protection on the same tab ID');
    for(let i=0;i<5;i++){
      await send(controller,{type:'protect',enabled:true});
      await b.goto(origin+'/Navigated-'+i);await until(()=>b.evaluate(()=>Object.hasOwn(document,'hidden')),Boolean,'Destination was not protected');
      await send(controller,{type:'protect',enabled:false});await b.goBack({waitUntil:'commit'});
      await until(()=>b.evaluate(()=>Object.hasOwn(document,'hidden')),v=>!v,'Cached document revived old overrides');
    }
    console.log(`INFO cached page restored: ${await b.evaluate(()=>window.cached)}`);
    pass('cached documents cannot revive protection after it is stopped');
    await send(controller,{type:'protect',enabled:true});await b.goto(origin.replace('127.0.0.1','localhost')+'/New-origin');
    state=await until(()=>send(controller,{type:'state'}),s=>s.session.status==='permission','Cross-origin access was not checked');
    assert.equal(state.session.tabId,idB);assert.equal(await b.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    await send(controller,{type:'protect',enabled:false});await b.goto(origin+'/Other');
    pass('URL changes keep the same tab selected and new sites require access');
    const second=await context.newPage();await second.goto(controller.url());await second.waitForFunction(()=>!document.getElementById('controls').inert);
    await controller.bringToFront();await controller.locator('#choose-tab').click();await controller.getByRole('button',{name:'Primary',exact:true}).waitFor();
    await send(second,{type:'select',tabId:idA});
    await controller.getByRole('button',{name:'Primary',exact:true}).click();
    await controller.locator('#picker-feedback').filter({hasText:'selected tab changed'}).waitFor();
    assert.equal((await send(controller,{type:'state'})).session.tabId,idA);await controller.locator('#close-picker').click();
    pass('stale controllers show a picker error instead of overriding another selection');
    const vanished=await context.newPage();await vanished.goto(origin+'/Closing-choice');
    await controller.bringToFront();await controller.locator('#choose-tab').click();await controller.getByRole('button',{name:'Closing-choice',exact:true}).waitFor();
    await vanished.close();await controller.getByRole('button',{name:'Closing-choice',exact:true}).click();
    await controller.locator('#picker-feedback').filter({hasText:'unavailable'}).waitFor();await controller.locator('#close-picker').click();
    pass('a choice closing while the picker is open produces visible feedback');
    await send(controller,{type:'protect',enabled:true});
    await a.evaluate(()=>{window.cachedFocus=document.hasFocus;});
    await controller.evaluate(async tabId=>{
      await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
        Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
        window.__antiRedTagProtectionV2={restore(){delete document.hidden;delete window.__antiRedTagProtectionV2;}};
      }});
    },idB);
    await controller.bringToFront();await controller.locator('#kill').click();
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='off','Global emergency stop did not complete');
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);assert.equal(await b.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    assert.equal(await a.evaluate(()=>typeof window.cachedFocus),'function');
    await controller.locator('#reload-affected').click();
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='off'&&!s.session.stoppingWork,'Hard reset did not finish');
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    assert.equal(await a.evaluate(()=>typeof window.cachedFocus),'undefined');
    pass('emergency icon cleans selected and untracked tabs, with hard reset for site-cached references');
    const worker=context.serviceWorkers().find(worker=>worker.url().includes(app.id));
    await worker.evaluate(()=>{
      globalThis.originalScript=chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript=async details=>{
        if(details.world==='MAIN'&&details.args?.[0]===true){await new Promise(resolve=>{globalThis.releasePendingInjection=resolve;});}
        return globalThis.originalScript(details);
      };
    });
    await controller.locator('#protect').click();
    await until(()=>worker.evaluate(()=>typeof globalThis.releasePendingInjection==='function'),Boolean,'Pending injection not captured');
    assert.equal(await controller.locator('#kill').isEnabled(),true);
    await controller.locator('#kill').click();
    await controller.waitForFunction(()=>document.querySelector('#protect').getAttribute('aria-pressed')==='false');
    await worker.evaluate(()=>{chrome.scripting.executeScript=globalThis.originalScript;globalThis.releasePendingInjection();});
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='off','Late injection escaped emergency stop');
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    pass('kill remains clickable while another action is stalled and cancels the late result');
    await send(controller,{type:'protect',enabled:true});
    // The fixture grant is required, so emulate a browser access revocation
    // while exercising the real tab reload and native document replacement.
    await worker.evaluate(()=>{globalThis.originalContains=chrome.permissions.contains.bind(chrome.permissions);chrome.permissions.contains=async()=>false;});
    await controller.bringToFront();await controller.locator('#kill').click();
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='cleanup','Revoked access did not surface cleanup recovery');
    assert.equal(await controller.locator('#protect').getAttribute('aria-pressed'),'false');
    await controller.locator('#reload-affected').click();
    await until(()=>send(controller,{type:'state'}),s=>s.session.status==='off','Explicit reload failed to finish cleanup');
    assert.equal(await a.evaluate(()=>Object.hasOwn(document,'hidden')),false);
    await worker.evaluate(()=>{chrome.permissions.contains=globalThis.originalContains;});
    pass('simulated access revocation cannot keep automation on and real reload clears remaining overrides');
    await send(controller,{type:'theme',settings:{theme:'light'}});
    const cdp=await context.newCDPSession(controller);const versions=[];cdp.on('ServiceWorker.workerVersionUpdated',({versions:update})=>versions.push(...update));await cdp.send('ServiceWorker.enable');
    const version=await until(async()=>versions.find(v=>v.scriptURL.includes(app.id)&&v.runningStatus==='running'),Boolean,'Worker was not found');
    await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
    state=await send(controller,{type:'state'});assert.equal(state.session.tabId,idA);assert.equal(state.settings.theme,'light');await cdp.detach();
    pass('worker reactivation retains the single selection and settings');
    state=await send(controller,{type:'controller'});assert.ok(state.session.controllerId);assert.equal((await send(controller,{type:'controller'})).session.controllerId,state.session.controllerId);
    pass('control window reuses its existing instance');
    await context.close();context=null;app=await launch(fixture,profile);context=app.context;controller=app.controller;
    state=await send(controller,{type:'state'});assert.equal(state.session.enabled,false);assert.equal(state.settings.theme,'light');
    pass('full browser restart starts unprotected while keeping appearance');
    assert.deepEqual(errors,[]);pass('no uncaught errors in tested controller pages');
    console.log(`\n${checks} Anti Red-Tag browser checks passed.`);
  }finally{
    if(context)await context.close();await new Promise(resolve=>server.close(resolve));
    const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('anti-red-tag-test-'))throw new Error('Unexpected test directory');
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
