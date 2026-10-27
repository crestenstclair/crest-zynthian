// SPDX-License-Identifier: GPL-2.0-or-later
// Bundle the worksheet without network requests or file:// module imports.
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gamepadActions, keyActions} from '../controller-node/web/input.mjs';

const here = new URL('./', import.meta.url);
const labels = {
  up:'Navigate up / move cursor up', down:'Navigate down / move cursor down',
  left:'Navigate left / decrease selected parameter', right:'Navigate right / increase selected parameter',
  pageUp:'Previous page / move eight phrases or sixteen steps back',
  pageDown:'Next page / move eight phrases or sixteen steps forward',
  select:'Activate selected item / act on sequencer cell', back:'Back / dismiss context menu',
  bold:'Selected item options / edit selected note or clip', home:'Main Menu', mixer:'Mixer',
  snapshots:'Snapshots', menu:'Toggle sequencer context menu', launcher:'Clip launcher',
  block:'Block selection in the note editor', play:'Play / stop selected sequence', record:'Toggle note-editor recording',
  focus:'Toggle sequencer canvas / context menu', lengthLess:'Shorten note', lengthMore:'Lengthen note',
  velocityLess:'Lower note velocity / CC value', velocityMore:'Raise note velocity / CC value', panic:'All sounds off'
};
const buttons = [
  ['a','A / South','Face buttons'],['b','B / East','Face buttons'],['x','X / West','Face buttons'],['y','Y / North','Face buttons'],
  ['lb','LB / L1','Shoulders & triggers'],['rb','RB / R1','Shoulders & triggers'],
  ['lt','LT / L2','Shoulders & triggers'],['rt','RT / R2','Shoulders & triggers'],
  ['view','View / Select','System buttons'],['start','Menu / Start','System buttons'],
  ['l3','Left stick click / L3','Sticks'],['r3','Right stick click / R3','Sticks'],
  ['up','D-pad up','D-pad'],['down','D-pad down','D-pad'],['left','D-pad left','D-pad'],['right','D-pad right','D-pad'],
  ['guide','Guide / Home button','System buttons']
];
function samplePad(button, axis, value, modified=false) {
  const pad = {buttons:Array.from({length:17},()=>({pressed:false})),axes:[0,0,0,0]};
  if (button !== null) pad.buttons[button].pressed = true;
  if (axis !== null) pad.axes[axis] = value;
  if (modified) pad.buttons[4].pressed = true;
  return [...gamepadActions(pad).actions].map(action=>labels[action] || action).join('; ') || 'Unassigned';
}
function gamepadControl([id,label,group], index) {
  return {id:'pad:'+id,label,group,device:'gamepad',
    current:index===4 ? 'Hold for fine adjustment; LB + X records; LB + Y opens the sequencer menu' : samplePad(index,null,0),
    shifted:index===4 ? '' : samplePad(index,null,0,true),
    input:{type:'button',index}, availability:index===16 ? 'Often reserved by the browser or OS.' : 'Standard browser gamepad input.'};
}
function stickControls(axis) {
  const stick = axis < 2 ? 'Left' : 'Right';
  const directions = axis%2 ? ['up','down'] : ['left','right'];
  return directions.map((direction,index)=>({id:`pad:${stick.toLowerCase()}-${direction}`,label:`${stick} stick ${direction}`,
    group:'Sticks',device:'gamepad',input:{type:'axis',index:axis,direction:index===0?-1:1},
    current:samplePad(null,axis,index===0?-1:1),shifted:samplePad(null,axis,index===0?-1:1,true),
    availability:'Digital direction above a 0.55 axis threshold; held directions repeat.'}));
}
function keyControl([key, action]) {
  const label = key === ' ' ? 'Space' : key === 'Tab' ? 'Tab' : key;
  return {id:'key:'+label,label,group:'Keyboard',device:'keyboard',input:{type:'key',key},current:labels[action],
    shifted:'Shift gives fine adjustment where the action supports it.',
    availability:key==='Tab' ? 'Context toggle in sequencers; normal Tab navigation elsewhere.' : 'Shortcuts do not intercept typing in text fields or browser modifier shortcuts.'};
}
const extras = [
  ['l4','L4 back button'],['l5','L5 back button'],['r4','R4 back button'],['r5','R5 back button'],
  ['left-pad','Left trackpad / gestures'],['left-pad-click','Left trackpad click'],
  ['right-pad','Right trackpad / gestures'],['right-pad-click','Right trackpad click'],
  ['touch','Touchscreen / gestures'],['gyro','Gyroscope / tilt'],['steam','Steam button'],['quick','Quick Access / …']
].map(([id,label])=>({id:'deck:'+id,label,group:'Deck & touch',device:'deck',current:'No dedicated controller mapping',shifted:'',
  availability:'Describe your intent. Availability depends on Steam Input / host exposure; not verified on hardware.'}));
const titleOverrides = {root:'Root / mixer alias',none:'Empty screen',control_xy:'X/Y pad',pattern_editor:'Piano roll',pated_cc:'CC editor',
  launcher:'Clip launcher',zs3:'ZS3',zs3_options:'ZS3 options',midi_recorder:'MIDI Player / Recorder',alsa_mixer:'Audio Levels',tts:'Text to speech'};
const source = await readFile(new URL('../zyngui/zynthian_gui.py',here),'utf8');
const registry = source.slice(source.indexOf('    def create_screens('),source.indexOf('        # Initialize switches'));
const screenIds = [...new Set([...registry.matchAll(/^\s*self\.screens\['([a-z0-9_]+)'\]\s*=/gm)].map(match=>match[1]))];
if (screenIds.length !== 51) throw Error(`Expected 51 registered screens; review the worksheet catalog (${screenIds.length} found).`);
const screens = screenIds.map(id=>({id,label:titleOverrides[id] || id.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}));
screens.sort((a,b)=>a.label.localeCompare(b.label));
const controls = [...buttons.map(gamepadControl),...[0,1,2,3].flatMap(stickControls),...Object.entries(keyActions).map(keyControl),
  {id:'key:Shift',label:'Shift',group:'Keyboard',device:'keyboard',current:'Hold for fine parameter adjustment',shifted:'',availability:'Modifier; describe any alternate layers here.'},...extras];
const catalog = {version:1,repository:'crestenstclair/crest-zynthian',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(here),encoding:'utf8'}).trim(),
  sourceFiles:['controller-node/web/input.mjs','controller-node/web/model.mjs','zynwebview/sequencer.py','zyngui/zynthian_gui.py'],
  controls,contexts:[{id:'global',label:'Default / all screens'},...screens]};
const [page,css,model,editor] = await Promise.all(['page.html','editor.css','bundle.mjs','editor.mjs'].map(name=>readFile(new URL(name,here),'utf8')));
const script = `const catalog = ${JSON.stringify(catalog).replaceAll('<','\\u003c')};\n`+
  model.replaceAll(/^export /gm,'')+'\n'+editor;
if (/<\/script/i.test(script)) throw Error('Unexpected script closing tag in source');
const html = page.replace('<!-- STYLE -->',()=>`<style>${css}</style>`).replace('<!-- SCRIPT -->',()=>`<script type="module">${script}</script>`);
const output = new URL('../../../docs/zynthian-control-mapping.html',here);
await writeFile(output,html);
console.log(`Built ${fileURLToPath(output)}: ${controls.length} controls, ${screens.length} screens.`);
