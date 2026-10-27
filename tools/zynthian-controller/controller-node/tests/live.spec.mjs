import {test,expect} from '@playwright/test';
import {connect,state,ready,capture,choose,home,navigation,back,options,audibleSequence} from './live-helpers.mjs';
test.beforeEach(async({page})=>connect(page));

test('HTML screen workflows',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await home(page);await capture(page,'01-main-menu');
  await choose(page,'Add Chain');await capture(page,'02-add-chain');
  await choose(page,'Instrument');await choose(page,'Category · Sampler');await capture(page,'03-engine');
  await choose(page,'FluidSynth: SF2, SF3');await capture(page,'04-midi-channel');
  await choose(page,/MIDI CHANNEL 1\b/);await capture(page,'05-bank');
  await choose(page,'FluidR3');await capture(page,'06-preset');
  await page.locator('#items .item:not(:disabled)').first().click();await ready(page);
  expect((await state(page)).screen).toBe('chain_control');await capture(page,'07-chain-control');
  const volume=(await state(page)).items.find(item=>item.kind==='control' && /volume/i.test(item.label));
  expect(volume).toBeTruthy();
  const value=page.getByRole('spinbutton',{name:'Set '+volume.label,exact:true});
  await value.fill('90');await value.press('Tab');await ready(page);
  expect((await state(page)).items.find(item=>item.id===volume.id).value).toBe(90);
  await options(page,volume.label);await capture(page,'08-parameter-options');
  await choose(page,'CC Value Range');expect((await state(page)).screen).toBe('midi_cc_range');
  await capture(page,'08a-cc-value-range');await back(page);
  await options(page,volume.label);
  await choose(page,'X-axis');await back(page);
  const second=(await state(page)).items.find(item=>item.kind==='control' && item.id!==volume.id && !item.toggle && !item.path);
  await options(page,second.label);await choose(page,'Y-axis');await choose(page,'Show touchpad');
  expect((await state(page)).screen).toBe('control_xy');await capture(page,'09-xy');await back(page);
  await navigation(page,'Chain Control');await choose(page,'MIDI input');
  await choose(page,'Note Range & Transpose');expect((await state(page)).screen).toBe('midi_key_range');
  await capture(page,'10-key-range');
  await page.getByRole('button',{name:/Increase note low/i}).click();await ready(page);
  expect((await state(page)).content.low).toBe(1);await choose(page,'Done');
  await navigation(page,'Chain Control');await choose(page,'Audio output');await capture(page,'10a-audio-routing');
  await choose(page,'Chain options');await choose(page,'Remove chain');
  expect((await state(page)).kind).toBe('confirm');expect((await state(page)).selected).toBe(0);
  await capture(page,'10b-confirm-cancel');await choose(page,'Cancel');
  for(const [label,name] of [['Chain Manager','11-chain-manager'],['MIDI Input','12-midi-input'],['MIDI Output','13-midi-output'],
    ['Audio Player','14-audio-player'],['MIDI Player','15-midi-player'],['Tempo','16-tempo'],['ZS3','17-zs3'],['Administration','18-admin']]) {
    await navigation(page,label);await capture(page,name);
  }
  await choose(page,'Global Transpose');
  expect((await state(page)).inlineEditor).toBe(true);await capture(page,'18a-inline-setting');
  await back(page);
  await page.getByRole('button',{name:'Help',exact:true}).click();await ready(page);
  await choose(page,'Controller interface');await capture(page,'19-help');
  await navigation(page,'mixer');await capture(page,'20-mixer');
  await page.keyboard.press('F6');await ready(page);await capture(page,'21-launcher');
  await page.locator('.clip[aria-label*="FluidSynth"]').first().click();await ready(page);
  expect((await state(page)).screen).toBe('pattern_editor');
  await page.getByRole('button',{name:'± Note',exact:true}).click();await ready(page);
  await page.keyboard.press(']');await ready(page);await capture(page,'22-piano-roll');
  await page.getByRole('button',{name:'☰ Menu',exact:true}).click();await capture(page,'23-context-menu');
  await choose(page,'Edit CC');await page.getByRole('button',{name:'± Event',exact:true}).click();await ready(page);
  await capture(page,'24-cc-editor');
  await audibleSequence(page,'25-browser-audio');
  await navigation(page,'snapshots');await capture(page,'26-snapshots');
  await choose(page,'Save as new snapshot');await capture(page,'27-keyboard');await choose(page,/^Save/);
  await ready(page);await capture(page,'28-saved');
  expect(errors).toEqual([]);
});

test('snapshot recall after process restart',async({page})=>{
  await navigation(page,'snapshots');
  await choose(page,'001-New Snapshot');await choose(page,'Load');await ready(page);
  await capture(page,'29-recalled');
  await audibleSequence(page,'30-recalled-browser-audio');
});
