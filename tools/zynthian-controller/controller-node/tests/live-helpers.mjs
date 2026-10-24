import {expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const data=process.env.CONTROLLER_DATA;
const evidence=join(data || '/tmp/controller-node-tests','evidence');
const base=process.env.CONTROLLER_TEST_URL || 'http://127.0.0.1:8768';
export async function connect(page) {
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>console.log('Browser error:',error.message));
  page.on('console',message=>{
    if (['error','warning'].includes(message.type())) console.log('Browser:',message.text().replace(/token=[^'\s]+/g,'token=[redacted]'));
  });
  if (!data) throw Error('CONTROLLER_DATA must point to disposable test session data');
  const token=(await readFile(join(data,'access-token'),'utf8')).trim();
  await page.addInitScript(token=>sessionStorage.setItem('zynthian-controller-token',token),token);
  await page.goto(base);
  await ready(page);
}
export async function state(page) {return page.evaluate(()=>JSON.parse(window.controller.state));}
export async function ready(page) {
  await page.waitForFunction(()=>window.controller?.connected && !JSON.parse(window.controller.state).busy,{},{timeout:40000});
  expect((await state(page)).error).toBe('');
}
export async function capture(page,name) {
  await ready(page);await mkdir(evidence,{recursive:true});
  await page.screenshot({path:join(evidence,name+'.png')});
  await writeFile(join(evidence,name+'.json'),JSON.stringify(await state(page),null,2));
}
export async function choose(page,label) {
  await page.locator('#items .item').filter({hasText:label}).first().click();await ready(page);
}
export async function home(page) {await page.keyboard.press('Home');await ready(page);}
export async function navigation(page,label) {
  await home(page);
  if ((await page.locator('#navigation-more').getAttribute('open')) === null) await page.locator('#navigation-more summary').click();
  await page.locator('#navigation-items button').filter({hasText:label}).first().click();await ready(page);
}
export async function back(page) {await page.keyboard.press('Escape');await ready(page);}
export async function options(page,label) {
  await page.getByRole('button',{name:`Options for ${label}`,exact:true}).click();await ready(page);
}
export function watchAudio(page) {
  let sum=0, samples=0, peak=0;
  page.on('websocket',socket=>{
    if(!socket.url().includes('/stream?')) return;
    socket.on('framereceived',({payload})=>{
      if(typeof payload==='string')return;
      for(let i=0;i+4<=payload.length;i+=4){const sample=payload.readFloatLE(i);sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));samples++;}
    });
  });
  return ()=>({samples,rms:samples ? Math.sqrt(sum/samples) : 0,peak});
}
export async function audibleSequence(page,name) {
  const measured=watchAudio(page);
  // Audio button is in the main header; return to the editor afterward.
  await home(page);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
  await expect(page.locator('#audio-status')).toHaveText('Audio on');
  await page.keyboard.press('F6');await ready(page);
  const s=await state(page), column=s.sequence.columns.find(c=>c.label.includes('FluidSynth'));
  expect(column).toBeTruthy();
  await page.locator('.clip[aria-label*="FluidSynth"]').first().click();await ready(page);
  await page.keyboard.press('F4');await ready(page);
  expect((await state(page)).screen).toBe('pattern_editor');
  await page.keyboard.press('Space');await ready(page);await page.waitForTimeout(4500);
  await page.keyboard.press('Space');await ready(page);
  const result=measured();
  await writeFile(join(evidence,name+'.json'),JSON.stringify(result,null,2));
  expect(result.samples).toBeGreaterThan(48000);expect(result.rms).toBeGreaterThan(0.0001);expect(result.peak).toBeLessThan(1);
  await home(page);await page.getByRole('button',{name:'Disable audio',exact:true}).click();
}

export async function loadSnapshot(page,label='001-New Snapshot') {
  await home(page);await page.locator('nav [data-action="snapshots"]').click();await ready(page);
  await choose(page,label);await choose(page,'Load');await ready(page);
}
export async function nameText(page,text) {
  expect((await state(page)).kind).toBe('keyboard');
  await choose(page,'Clear text');
  for (const character of text) {
    let key=(await state(page)).items.find(item=>item.id.startsWith('key:') && item.label===character);
    if (!key) {
      await choose(page,'Shift');
      key=(await state(page)).items.find(item=>item.id.startsWith('key:') && item.label===character);
    }
    expect(key,`Keyboard key ${character}`).toBeTruthy();
    await page.locator(`[data-focus-key="item:${key.id}"]`).click();await ready(page);
  }
  await choose(page,/^Save/);
}
export async function setParameter(page,label,value) {
  const input=page.getByRole('spinbutton',{name:'Set '+label,exact:true});
  await input.fill(String(value));await input.press('Tab');await ready(page);
  expect((await state(page)).items.find(item=>item.label===label).value).toBe(value);
}
export async function processor(page,name='FluidSynth') {
  await navigation(page,'Chain Control');
  const item=(await state(page)).items.find(item=>item.id.startsWith('processor:') && item.label===name);
  expect(item).toBeTruthy();
  await page.locator(`[data-focus-key="item:${item.id}"]`).click();await ready(page);
}
