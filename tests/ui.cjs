const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await chromium.launch({headless:true});let count=0;const pass=label=>{count++;console.log(`PASS ${label}`);};
  try{
    const page=await browser.newPage({viewport:{width:800,height:800}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{let demo;Object.defineProperty(window,'AntiDemo',{get:()=>demo,set:value=>{const send=value.send.bind(value);value.send=async message=>{if(window.failAction===message.type){window.failAction=null;throw new Error('Simulated API failure');}const result=await send(message);if(message.type==='state'&&window.holdNext){window.holdNext=false;return new Promise(resolve=>{window.held={result,resolve};});}return result;};demo=value;}});});
    await page.goto(pathToFileURL(path.resolve(__dirname,'../anti-red-tag/controller.html')).href);await page.waitForFunction(()=>!document.getElementById('controls').inert);
    assert.equal(await page.locator('#theme svg').getAttribute('data-icon'),'sun');await page.locator('#theme').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');assert.equal(await page.locator('#theme svg').getAttribute('data-icon'),'moon');
    await page.locator('#theme').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');pass('sun and moon icons match their theme action');
    await page.locator('#protect').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#protect').getAttribute('aria-pressed')==='true');
    await page.locator('#choose-tab').click();await page.locator('#tab-search').fill('Project');await page.getByRole('button',{name:'Project notes',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tab-title').textContent==='Project notes');assert.equal(await page.locator('#protect').getAttribute('aria-pressed'),'true');pass('keyboard power control and single-tab picker work');
    await page.locator('#choose-tab').click();await page.locator('#tab-search').fill('does not exist');await page.getByText('No matching tabs.',{exact:true}).waitFor();await page.locator('#close-picker').click();pass('empty search gives clear feedback');
    await page.evaluate(()=>{window.holdNext=true;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>!!window.held);await page.locator('#theme').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.evaluate(()=>window.held.resolve(window.held.result));await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');pass('stale refresh cannot undo a newer action');
    await page.evaluate(()=>{window.failAction='protect';});await page.locator('#protect').click();await page.locator('#feedback.error').filter({hasText:'Simulated API failure'}).waitFor();assert.equal(await page.locator('#protect').isEnabled(),true);await page.locator('#protect').click();await page.waitForFunction(()=>document.querySelector('#protect').getAttribute('aria-pressed')==='false');pass('failed protection action reports an error and can be retried');
    await page.locator('#help').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#help-dialog').evaluate(d=>d.open),false);
    for(const width of [300,320,370,600]){await page.setViewportSize({width,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    await page.setViewportSize({width:800,height:800});await page.screenshot({path:'test-results/anti-red-tag-preview.png',fullPage:true});
    for(const button of await page.locator('main button').all()){assert.ok(await button.getAttribute('aria-label'));assert.equal(await button.evaluate(e=>getComputedStyle(e).appearance),'none');assert.ok(await button.locator('svg').count()>0);for(const svg of await button.locator('svg').all())assert.equal(await svg.getAttribute('stroke-width'),'1.75');}
    pass('all controls use labeled consistent icons and fit narrow widths');
    await page.addInitScript(()=>{window.failAction='state';});await page.reload();await page.locator('#retry-load').waitFor();assert.equal(await page.locator('#kill').isEnabled(),true);await page.locator('#retry-load').click();await page.waitForFunction(()=>!document.querySelector('#choose-tab').disabled);pass('startup failure keeps emergency stop available and has an accessible retry');
    const stalled=await browser.newPage();stalled.setDefaultTimeout(5000);stalled.on('pageerror',e=>errors.push(e.message));
    await stalled.addInitScript(()=>{let demo;Object.defineProperty(window,'AntiDemo',{get:()=>demo,set:value=>{
      const send=value.send.bind(value);let first=true;
      value.send=async message=>{if(message.type==='state'&&first){first=false;await send({type:'protect',enabled:true});const old=await send(message);return new Promise(resolve=>{window.releaseInitial=()=>resolve(old);});}return send(message);};demo=value;
    }});});
    await stalled.goto(pathToFileURL(path.resolve(__dirname,'../anti-red-tag/controller.html')).href);
    await stalled.waitForFunction(()=>typeof window.releaseInitial==='function');
    assert.equal(await stalled.locator('#kill').isEnabled(),true);await stalled.locator('#kill').click();
    await stalled.waitForFunction(()=>document.querySelector('#protection-status').textContent==='Protection off');
    await stalled.evaluate(()=>window.releaseInitial());await stalled.waitForTimeout(50);
    assert.equal(await stalled.locator('#protect').getAttribute('aria-pressed'),'false','A late initial load must not undo emergency stop');
    await stalled.close();pass('emergency stop remains authoritative over a delayed initial load');
    assert.deepEqual(errors,[]);pass('no uncaught UI errors');console.log(`\n${count} Anti Red-Tag UI checks passed.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
