import {test,expect} from '@playwright/test';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connect,state,ready,capture,choose,home,navigation,options,loadSnapshot,nameText,setParameter,processor,watchAudio} from './live-helpers.mjs';
const data=process.env.CONTROLLER_DATA;
test.beforeEach(async({page})=>connect(page));

async function screenAction(page,name) {
  await page.locator('#screen-actions').getByRole('button',{name,exact:true}).click();await ready(page);
}
async function midiSource() {
  const token=(await readFile(join(data,'access-token'),'utf8')).trim();
  const url=new URL(process.env.CONTROLLER_TEST_URL || 'http://127.0.0.1:8768');
  const socket=new WebSocket(`ws://${url.host}/stream?token=${token}`,{headers:{Origin:url.origin}});
  await once(socket,'message');
  return socket;
}
async function soundNotes(socket) {
  for(const note of [60,64,67,72]) {
    socket.send(JSON.stringify([0x90,note,100]));
    await new Promise(resolve=>setTimeout(resolve,350));
    socket.send(JSON.stringify([0x80,note,0]));
  }
  await new Promise(resolve=>setTimeout(resolve,250));
}
function recordedAudio(buffer) {
  expect(buffer.subarray(0,4).toString()).toBe('RIFF');
  expect(buffer.subarray(8,12).toString()).toBe('WAVE');
  let pcm,rate,channels;
  for(let offset=12;offset+8<=buffer.length;) {
    const size=buffer.readUInt32LE(offset+4),start=offset+8;
    expect(start+size).toBeLessThanOrEqual(buffer.length);
    const id=buffer.subarray(offset,offset+4).toString();
    if(id==='fmt ') {
      expect(buffer.readUInt16LE(start)).toBe(1);
      expect(buffer.readUInt16LE(start+14)).toBe(16);
      channels=buffer.readUInt16LE(start+2);rate=buffer.readUInt32LE(start+4);
    }
    if(id==='data') pcm=buffer.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  expect(pcm).toBeTruthy();expect(rate).toBe(48000);expect(channels).toBe(2);
  let sum=0,peak=0;
  for(let i=0;i<pcm.length;i+=2) {const value=pcm.readInt16LE(i)/32768;sum+=value*value;peak=Math.max(peak,Math.abs(value));}
  const result={samples:pcm.length/2,rms:Math.sqrt(sum/(pcm.length/2)),peak,rate,channels};
  expect(result.samples).toBeGreaterThan(48000);expect(result.rms).toBeGreaterThan(0.0001);expect(peak).toBeLessThan(1);
  return result;
}

test('parity: chains routing and processor menus',async({page})=>{
  await loadSnapshot(page);await processor(page);
  await page.getByRole('button',{name:'Increase volume',exact:true}).click();await ready(page);
  await expect(page.getByRole('button',{name:'Increase volume',exact:true})).toBeFocused();
  await options(page,'FluidSynth');await choose(page,'Insert Audio Processor');
  await choose(page,'Category · Reverb');await choose(page,'Calf Reverb');await choose(page,'Ambience');
  await options(page,'Calf Reverb');expect((await state(page)).screen).toBe('processor_options');
  await choose(page,'Bypass');await expect(page.locator('#items')).toContainText('☒ Bypass');
  await choose(page,'Bypass');await choose(page,/^Move/);
  expect((await state(page)).screen).toBe('chain_manager');
  await screenAction(page,'Move right');await capture(page,'parity-01-processor-move');
  const nodes=(await state(page)).items.map(item=>item.label);
  expect(nodes.findIndex(label=>label.includes('Calf Reverb'))).toBeGreaterThan(nodes.findIndex(label=>label==='1 · Mixer'));
  await screenAction(page,'Finish moving');
  await navigation(page,'Chain Control');await options(page,'Calf Reverb');
  await choose(page,/^Remove/);await choose(page,'Confirm');
  await page.keyboard.press('F2');await ready(page);
  const chain=(await state(page)).items.find(item=>item.id.startsWith('chain:') && item.label.includes('FluidSynth'));
  expect(chain).toBeTruthy();
  await page.locator(`[data-focus-key="item:${chain.id}"]`).click();await ready(page);
  await expect(page.locator('#items')).not.toContainText('Calf Reverb');
  await choose(page,'Audio output');await capture(page,'parity-02-audio-routing');
  const route=(await state(page)).items.find(item=>item.id.startsWith('list:') && item.label.includes('Main') && item.enabled);
  expect(route).toBeTruthy();
  await page.locator(`[data-focus-key="item:${route.id}"]`).click();await ready(page);
  expect((await state(page)).items.find(item=>item.id===route.id).label).not.toBe(route.label);
  await page.locator(`[data-focus-key="item:${route.id}"]`).click();await ready(page);
  expect((await state(page)).items.find(item=>item.id===route.id).label).toBe(route.label);
  await choose(page,'MIDI input');await capture(page,'parity-03-chain-midi-routing');
  const midiRoute=(await state(page)).items.find(item=>item.id.startsWith('list:') && item.label.endsWith('♣ midi'));
  expect(midiRoute).toBeTruthy();
  await page.locator(`[data-focus-key="item:${midiRoute.id}"]`).click();await ready(page);
  expect((await state(page)).items.find(item=>item.id===midiRoute.id).label).not.toBe(midiRoute.label);
  await page.locator(`[data-focus-key="item:${midiRoute.id}"]`).click();await ready(page);
  expect((await state(page)).items.find(item=>item.id===midiRoute.id).label).toBe(midiRoute.label);
});

test('parity: MIDI learn and ZS3 persistence',async({page})=>{
  await loadSnapshot(page);await processor(page);
  await options(page,'volume');await choose(page,'Chain learn...');
  await expect(page.locator('#screen-actions')).toContainText('Cancel MIDI learn');
  const socket=await midiSource();
  try {
    socket.send(JSON.stringify([0xb0,21,45]));
    await expect(page.locator('#screen-actions')).not.toContainText('Cancel MIDI learn');
    socket.send(JSON.stringify([0xb0,21,47]));
    await expect.poll(async()=> (await state(page)).items.find(item=>item.label==='volume')?.value).toBe(47);
  } finally {socket.close();await once(socket,'close');}
  await setParameter(page,'volume',30);
  await navigation(page,'ZS3');await choose(page,'Save as new ZS3');
  await options(page,'ZS3-1');await choose(page,/^Rename/);await nameText(page,'verse');
  await processor(page);await setParameter(page,'volume',70);
  await navigation(page,'ZS3');await choose(page,'Save as new ZS3');
  await options(page,'ZS3-2');await choose(page,/^Rename/);await nameText(page,'chorus');
  await navigation(page,'ZS3');await options(page,'chorus');await choose(page,/^Move/);
  await screenAction(page,'Move up');await screenAction(page,'Finish moving');
  const titles=(await state(page)).items.map(item=>item.label);
  expect(titles.indexOf('chorus')).toBeLessThan(titles.indexOf('verse'));
  await screenAction(page,'Learn program change');await expect(page.locator('#screen-actions')).toContainText('Stop program learn');
  await screenAction(page,'Stop program learn');await capture(page,'parity-04-zs3');
  await choose(page,'verse');await processor(page);
  expect((await state(page)).items.find(item=>item.label==='volume').value).toBe(30);
  await navigation(page,'ZS3');await choose(page,'chorus');await processor(page);
  expect((await state(page)).items.find(item=>item.label==='volume').value).toBe(70);
  await navigation(page,'snapshots');
  await choose(page,'Save as new snapshot');await nameText(page,'parity-session');
  await capture(page,'parity-05-saved');
});

test('parity: audio and MIDI recording files',async({page})=>{
  await loadSnapshot(page);await home(page);
  const captureDir=join(data,'user-data/capture'),before=new Set(await readdir(captureDir));
  await choose(page,'Start Audio Recording');await home(page);await choose(page,'Start MIDI Recording');
  await expect.poll(async()=> (await state(page)).transport).toMatchObject({audioRecording:true,midiRecording:true});
  await capture(page,'parity-06-recording');
  const socket=await midiSource();
  try {await soundNotes(socket);} finally {socket.close();await once(socket,'close');}
  await home(page);await choose(page,'Stop MIDI Recording');await home(page);await choose(page,'Stop Audio Recording');
  await expect.poll(async()=> (await state(page)).transport).toMatchObject({audioRecording:false,midiRecording:false});
  const files=(await readdir(captureDir)).filter(name=>!before.has(name));
  const wav=files.find(name=>name.endsWith('.wav')),mid=files.find(name=>name.endsWith('.mid'));
  expect(wav).toBeTruthy();expect(mid).toBeTruthy();
  const pcm=await readFile(join(captureDir,wav)),midi=await readFile(join(captureDir,mid));
  const recorded=recordedAudio(pcm);
  expect(midi.subarray(0,4).toString()).toBe('MThd');expect(midi.length).toBeGreaterThan(64);
  for(const note of [60,64,67,72]) {
    expect(midi.includes(Buffer.from([0x90,note,100]))).toBe(true);
    expect(midi.includes(Buffer.from([0x80,note,0]))).toBe(true);
  }
  await navigation(page,'MIDI Player');
  await choose(page,mid.slice(0,-4));await expect(page.locator('#screen-actions')).toContainText('Stop MIDI playback');
  await screenAction(page,'Stop MIDI playback');await options(page,(await state(page)).items.find(item=>item.label.includes(mid.slice(0,-4))).label);
  await choose(page,'Rename');await nameText(page,'parity-midi');await capture(page,'parity-07-midi-file');
  expect(await readdir(captureDir)).toContain('parity-midi.mid');
  await options(page,(await state(page)).items.find(item=>item.label.startsWith('parity-midi (')).label);
  await choose(page,'Delete');await choose(page,'Cancel');
  expect(await readdir(captureDir)).toContain('parity-midi.mid');
  await navigation(page,'Audio Player');await screenAction(page,'Files / recordings');await capture(page,'parity-08-audio-files');
  await choose(page,wav.slice(0,-4).replaceAll('_',' '));
  expect((await state(page)).items.find(item=>item.label==='transport')).toBeTruthy();
  const playback=watchAudio(page);
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();
  await expect(page.locator('#audio-status')).toHaveText('Audio on');
  await choose(page,'transport');
  await expect.poll(()=>playback().rms).toBeGreaterThan(0.0001);
  await expect.poll(()=>playback().samples).toBeGreaterThan(48000);
  await capture(page,'parity-08a-audio-playback');
  await expect.poll(async()=>(await state(page)).items.find(item=>item.label==='transport')?.value).toBe(0);
  await page.getByRole('button',{name:'Disable audio',exact:true}).click();
  await writeFile(join(data,'recording-files.json'),JSON.stringify({wav,mid:'parity-midi.mid',wavBytes:pcm.length,midiBytes:midi.length,recorded,playback:playback()},null,2));
});

test('fresh parity snapshot recall',async({page})=>{
  await loadSnapshot(page,'002-parity-session');
  await navigation(page,'ZS3');await choose(page,'verse');await processor(page);
  expect((await state(page)).items.find(item=>item.label==='volume').value).toBe(30);
  await navigation(page,'ZS3');await choose(page,'chorus');await processor(page);
  expect((await state(page)).items.find(item=>item.label==='volume').value).toBe(70);
  await options(page,'volume');await expect(page.locator('#items')).toContainText('CC21');
  await processor(page);
  const socket=await midiSource();
  try {
    socket.send(JSON.stringify([0xb0,21,47]));
    await expect.poll(async()=>(await state(page)).items.find(item=>item.label==='volume')?.value).toBe(47);
  } finally {socket.close();await once(socket,'close');}
  await capture(page,'parity-09-recalled');
});
