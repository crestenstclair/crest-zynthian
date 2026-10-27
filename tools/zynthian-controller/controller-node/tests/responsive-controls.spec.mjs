// SPDX-License-Identifier: GPL-2.0-or-later
import {test,expect} from '@playwright/test';
import {connect,ready,state,navigation,loadSnapshot,capture} from './live-helpers.mjs';

test('cursor stays local and DOM stays mounted through delayed edits; Circle never plays',async({page})=>{
  const commands=[];let delay=0;
  await page.routeWebSocket(/\/control\?/,socket=>{
    const server=socket.connectToServer();
    socket.onMessage(message=>{commands.push(JSON.parse(message));server.send(message);});
    server.onMessage(message=>{if(delay)setTimeout(()=>socket.send(message),delay);else socket.send(message);});
  });
  await page.addInitScript(()=>{
    window.testPad={id:'Pro Controller test',index:0,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false})),axes:[0,0,0,0]};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
  });
  await connect(page);await loadSnapshot(page);await navigation(page,'launcher');
  await page.locator('.clip[aria-label*="FluidSynth"]').first().click();await ready(page);
  await page.getByRole('button',{name:/Instrument, step 1, pitch,/}).first().click();
  await page.evaluate(()=>{window.originalTracker=document.querySelector('.tracker-view');});
  commands.length=0;
  for(let i=0;i<10;i++) await page.keyboard.press('ArrowDown');
  expect((await state(page)).sequence.selected[0]).toBe(10);
  expect(commands).toEqual([]);
  expect(await page.evaluate(()=>window.originalTracker===document.querySelector('.tracker-view'))).toBe(true);
  await expect(page.locator('#connection')).toHaveText('Connected');
  // Edit the current note, then move before its reply. Selection is independent.
  delay=650;
  await page.keyboard.down('x');await page.keyboard.press('ArrowRight');await page.keyboard.up('x');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  expect((await state(page)).sequence.selected[0]).toBe(12);
  expect((await state(page)).busy).toBe(true);
  expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({action:'editCell',first:10});
  await expect(page.locator('#connection')).toHaveText('Connected');
  expect(await page.evaluate(()=>window.originalTracker===document.querySelector('.tracker-view'))).toBe(true);
  await ready(page);expect((await state(page)).sequence.selected[0]).toBe(12);delay=0;
  // A focused Play button must not affect Circle's meaning.
  await page.getByRole('button',{name:'▶ Play',exact:true}).focus();
  commands.length=0;
  await page.evaluate(()=>window.testPad.buttons[1].pressed=true);
  await expect(page.locator('#input-held')).toContainText('SHIFT');
  await page.waitForTimeout(450);
  expect(commands).toEqual([]);
  await capture(page,'responsive-circle-held');
  await page.evaluate(()=>window.testPad.buttons[12].pressed=true);
  await expect.poll(()=>commands.map(command=>command.action)).toEqual(['details']);
  await ready(page);
  await page.evaluate(()=>{window.testPad.buttons[12].pressed=false;window.testPad.buttons[1].pressed=false;});
  await expect(page.locator('#input-held')).toBeEmpty();
  expect(commands.some(command=>command.action==='play')).toBe(false);
  await page.keyboard.press('Shift+ArrowDown');await ready(page);
  await capture(page,'responsive-controls');
});

test('piano cursor moves in mounted SVG without backend navigation',async({page})=>{
  const commands=[];
  await page.routeWebSocket(/\/control\?/,socket=>{
    const server=socket.connectToServer();
    socket.onMessage(message=>{commands.push(JSON.parse(message));server.send(message);});
  });
  await connect(page);await loadSnapshot(page);await navigation(page,'launcher');
  await page.locator('.clip[aria-label*="FluidSynth"]').first().click();await ready(page);
  await page.getByRole('button',{name:'Piano roll',exact:true}).click();
  const row=(await state(page)).sequence.rows[2].id;
  await page.getByRole('button',{name:`Select step 1, row ${row}`,exact:true}).first().click();
  await page.evaluate(()=>{window.originalRoll=document.querySelector('.piano-roll');});
  const cursor=page.locator('.roll-cursor'),x=Number(await cursor.getAttribute('x')),y=Number(await cursor.getAttribute('y'));
  commands.length=0;
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  expect((await state(page)).sequence.selected).toEqual([1,row-1]);
  expect(Number(await cursor.getAttribute('x'))).toBeGreaterThan(x);
  expect(Number(await cursor.getAttribute('y'))).toBeGreaterThan(y);
  expect(commands).toEqual([]);
  expect(await page.evaluate(()=>window.originalRoll===document.querySelector('.piano-roll'))).toBe(true);
  await capture(page,'responsive-piano-controls');
});
