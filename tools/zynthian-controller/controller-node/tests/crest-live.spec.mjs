// SPDX-License-Identifier: GPL-2.0-or-later
import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {connect,ready,state,choose,capture,watchAudio} from './live-helpers.mjs';
test.beforeEach(async({page})=>connect(page));
async function route(page,action) {
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.locator(`[data-route="${action}"]`).click();await ready(page);
}
async function phrase(page) {
  await page.locator('.contexts [data-action="launcher"]').click();await ready(page);
  await page.locator('.clip[aria-label*="FluidSynth"]').first().click();await ready(page);
  expect((await state(page)).screen).toBe('pattern_editor');
}
async function audioProof(page) {
  const measure=watchAudio(page);
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();
  await expect(page.locator('#audio-status')).toHaveText('Audio on');
  await page.keyboard.press('Space');await ready(page);
  await expect.poll(()=>measure().rms,{timeout:12000}).toBeGreaterThan(.0001);
  await page.keyboard.press('Space');await ready(page);
  await page.getByRole('button',{name:'Disable audio',exact:true}).click();
  expect(measure().peak).toBeLessThan(1);
  return measure();
}

test('Crest live: instruments, native notes, tracker, mixer, audio and snapshot save',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await route(page,'addChain');await choose(page,'Instrument');await choose(page,'Category · Sampler');
  await choose(page,'FluidSynth: SF2, SF3');await choose(page,/MIDI CHANNEL 1\b/);await choose(page,'FluidR3');
  await page.locator('#items .item:not(:disabled)').first().click();await ready(page);
  expect((await state(page)).instrument.processors.some(p=>p.name.includes('FluidSynth'))).toBe(true);
  await capture(page,'crest-01-instrument');
  await page.locator('.contexts [data-action="chainManager"]').click();await ready(page);
  await expect(page.locator('#title')).toHaveText('LOADED SOUNDS');
  await capture(page,'crest-02-library');
  await phrase(page);
  await page.getByRole('button',{name:'Piano roll',exact:true}).click();
  for(const [step,note] of [[0,60],[4,64],[8,67],[12,64]]) {
    const s=(await state(page)).sequence;
    // Tracker buttons select any visible-step keymap row, including pitches outside the roll window.
    // Move the native cursor through the existing cell action for the first note.
    if(step===0) {
      const row=s.rows.find(row=>row.note===note) || s.rows[0];
      await page.getByRole('button',{name:`Select step 1, row ${row.id}`,exact:true}).first().click();await ready(page);
    } else {
      // Native arrow input moves the cursor, proving controller navigation as well as touch.
      for(let i=0;i<4;i++){await page.keyboard.press('ArrowRight');await ready(page);}
    }
    await page.getByRole('button',{name:'± Note',exact:true}).click();await ready(page);
    await page.keyboard.press(']');await ready(page);
  }
  const before=(await state(page)).sequence;
  expect(before.events.filter(e=>e.step>=0)).toHaveLength(4);
  await capture(page,'crest-03-piano');
  await page.getByRole('button',{name:'Tracker',exact:true}).click();
  await expect(page.locator('.tracker-view')).toBeVisible();
  expect((await state(page)).sequence.events).toEqual(before.events);
  await capture(page,'crest-04-tracker');
  await page.getByRole('button',{name:/Instrument, step 1, pitch,/}).first().click();await ready(page);
  const velocity=(await state(page)).sequence.noteValues.Velocity;
  await page.keyboard.press('=');await ready(page);
  expect((await state(page)).sequence.noteValues.Velocity).toBeGreaterThan(velocity);
  await page.getByRole('button',{name:'☰ Menu',exact:true}).click();
  await choose(page,'Undo');
  expect((await state(page)).sequence.noteValues.Velocity).toBe(velocity);
  const audio=await audioProof(page);
  await page.locator('.contexts [data-action="mixer"]').click();await ready(page);
  const mixer=(await state(page)).mixer.find(strip=>strip.name.includes('FluidSynth'));
  const value=(await state(page)).items.find(item=>item.id===`mix:${mixer.id}:level`);
  await page.getByLabel('Set '+value.label,{exact:true}).fill('0.61');await page.keyboard.press('Tab');await ready(page);
  expect((await state(page)).items.find(item=>item.id===value.id).value).toBeCloseTo(.61,2);
  await capture(page,'crest-05-mixer');
  await route(page,'snapshots');await choose(page,'Save as new snapshot');await choose(page,/^Save/);await ready(page);
  await capture(page,'crest-06-saved');
  await writeFile(process.env.CONTROLLER_DATA+'/crest-proof.json',JSON.stringify({audio,events:before.events,mixerLevel:.61},null,2));
  expect(errors).toEqual([]);
});

test('Crest recall: native snapshot survives a backend restart',async({page})=>{
  await route(page,'snapshots');await choose(page,'001-New Snapshot');await choose(page,'Load');await ready(page);
  await phrase(page);
  expect((await state(page)).sequence.events).toHaveLength(4);
  const audio=await audioProof(page);
  await capture(page,'crest-07-recalled');
  await writeFile(process.env.CONTROLLER_DATA+'/crest-recall-audio.json',JSON.stringify(audio,null,2));
});

test('Crest navigation: keyboard menu, live layouts and tracker cursor remain usable',async({page})=>{
  await route(page,'snapshots');await choose(page,'001-New Snapshot');await choose(page,'Load');await ready(page);
  await page.keyboard.press('y');
  await expect(page.getByRole('dialog',{name:'QUICK JUMP',exact:true})).toBeVisible();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await ready(page);
  expect((await state(page)).screen).toBe('chain_manager');
  await expect(page.locator('#navigation-panel')).not.toBeVisible();
  await capture(page,'crest-final-instruments');
  await choose(page,'FluidSynth');
  await capture(page,'crest-final-instrument');
  await route(page,'mixer');await capture(page,'crest-final-mixer');
  await route(page,'launcher');await capture(page,'crest-final-song');
  await phrase(page);await page.getByRole('button',{name:'Piano roll',exact:true}).click();await capture(page,'crest-final-piano');
  await page.getByRole('button',{name:'Tracker',exact:true}).click();
  const step=(await state(page)).sequence.selected[0];
  await page.keyboard.press('ArrowDown');await ready(page);
  expect((await state(page)).sequence.selected[0]).toBe(step+1);
  const selected=await page.locator('.tracker-selected').boundingBox();
  const view=await page.locator('.tracker-view').boundingBox();
  expect(selected.y).toBeGreaterThanOrEqual(view.y);
  expect(selected.y+selected.height).toBeLessThanOrEqual(view.y+view.height);
  await capture(page,'crest-final-tracker');
  await page.keyboard.press('y');await page.keyboard.press('Escape');
  await expect(page.locator('#navigation-panel')).not.toBeVisible();
  expect((await state(page)).screen).toBe('pattern_editor');
});
