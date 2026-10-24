/* SPDX-License-Identifier: GPL-2.0-or-later */
// Interactive design fixture. All edits stay in memory; no native backend, MIDI or audio.
"use strict";
const copy = value => JSON.parse(JSON.stringify(value));
const modes = {notes:"Piano roll",tracker:"Tracker",euclidean:"Euclidean",randomizer:"Randomizer"};
const noteNames = ["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
const scales = {"Harmonic minor":[0,2,3,5,7,8,11],"Natural minor":[0,2,3,5,7,8,10],Major:[0,2,4,5,7,9,11],Chromatic:[0,1,2,3,4,5,6,7,8,9,10,11]};
const noteName = n => `${noteNames[n%12]}${Math.floor(n/12)-1}`;
const midiChannels = Array.from({length:16},(_,i)=>i+1);
const initialEvents = [0,3,4,6,8,10,12,14].map((step,i)=>({step,pitch:[60,63,67,70,72,71,68,67][i],velocity:[108,79,98,87,112,75,94,86][i],duration:i===0?2:1,channel:1,chord:i===0?"Minor":"Single",fx:[i===6?"Chance 75%":"—","—","—"]}));
const mockup = {
 view:window.mockupStart?.view || "tracker", menu:window.mockupStart?.menu || null,
 config:{steps:16,division:16,tuplet:"Straight",swing:0,gate:75,tempo:120,root:0,scale:"Harmonic minor",direction:"Forward"},
 events:initialEvents, cursor:4,column:0,page:0,lane:0,playing:false,playhead:4,travel:1,
 euclidean:[{name:"Kick",pitch:36,hits:4,rotation:0,velocity:112,gate:60,muted:false,overrides:{}},{name:"Snare",pitch:38,hits:2,rotation:4,velocity:104,gate:50,muted:false,overrides:{}},{name:"Closed hat",pitch:42,hits:11,rotation:0,velocity:82,gate:35,muted:false,overrides:{}},{name:"Percussion",pitch:46,hits:5,rotation:2,velocity:90,gate:45,muted:false,overrides:{}}],
 random:{seed:42,density:70,low:60,high:84,velocityLow:64,velocityHigh:112,gateLow:35,gateHigh:95},
 randomEvents:[],locks:{},draft:null,history:[],future:[],notice:""
};
function checkpoint(){mockup.history.push(copy({config:mockup.config,events:mockup.events,euclidean:mockup.euclidean,random:mockup.random,randomEvents:mockup.randomEvents,locks:mockup.locks}));if(mockup.history.length>30)mockup.history.shift();mockup.future=[];}
function historyMove(from,to){if(!from.length)return;to.push(copy({config:mockup.config,events:mockup.events,euclidean:mockup.euclidean,random:mockup.random,randomEvents:mockup.randomEvents,locks:mockup.locks}));Object.assign(mockup,from.pop());mockup.cursor=Math.min(mockup.cursor,mockup.config.steps-1);mockup.page=Math.floor(mockup.cursor/16);closeMenu();}
function pulse(lane,step){if(Object.hasOwn(lane.overrides,step))return lane.overrides[step];const n=mockup.config.steps,k=Math.min(n,lane.hits),at=(step-lane.rotation+n)%n;return k>0&&(at*k)%n<k;}
function euclideanEvents(){return mockup.euclidean.flatMap(l=>l.muted?[]:Array.from({length:mockup.config.steps},(_,step)=>pulse(l,step)?{step,pitch:l.pitch,velocity:l.velocity,duration:l.gate/100,channel:1,chord:"Single",fx:["—","—","—"]}:null).filter(Boolean));}
function generateRandom(){
 const r=mockup.random, c=mockup.config, old=mockup.randomEvents;
 let seed=r.seed>>>0;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const pitches=Array.from({length:r.high-r.low+1},(_,i)=>r.low+i).filter(n=>scales[c.scale].includes((n-c.root+12)%12));
 mockup.randomEvents=[];
 for(let step=0;step<c.steps;step++){
  const hit=rand()*100<r.density,pitch=pitches[Math.floor(rand()*pitches.length)],velocity=Math.round(r.velocityLow+rand()*(r.velocityHigh-r.velocityLow)),duration=(r.gateLow+rand()*(r.gateHigh-r.gateLow))/100;
  if(mockup.locks[step]){const frozen=old.find(e=>e.step===step);if(frozen)mockup.randomEvents.push(copy(frozen));}
  else if(hit&&pitch!==undefined)mockup.randomEvents.push({step,pitch,velocity,duration,channel:1,chord:"Single",fx:["—","—","—"]});
 }
}
function eventsForView(){return mockup.view==="euclidean"?euclideanEvents():mockup.view==="randomizer"?mockup.randomEvents:mockup.events.filter(e=>e.step<mockup.config.steps);}
function switchMode(view){mockup.view=view;mockup.menu=null;mockup.draft=null;render();}
function closeMenu(){mockup.menu=null;mockup.draft=null;render();el("context-toggle")?.focus({preventScroll:true});}
function openMenu(name){mockup.menu=name;mockup.draft=name==="settings"?copy(mockup.config):name==="random"?copy(mockup.random):name==="lane"?copy(mockup.euclidean[mockup.lane]):name==="step"?copy(mockup.events.find(e=>e.step===mockup.cursor)||{step:mockup.cursor,pitch:60,velocity:100,duration:mockup.config.gate/100,channel:1,chord:"Single",fx:["—","—","—"]}):null;render();}
function toast(message){mockup.notice=message;render();}
const menuActions=()=>[
 ["type","Sequencer type"],["settings","Pattern settings"],
 ...(mockup.view==="euclidean"?[["lane","Edit selected lane"],["bake","Use preview as notes"]]:mockup.view==="randomizer"?[["random","Randomizer settings"],["regenerate","Generate variation"],["bake","Use preview as notes"]]:[["step","Edit step"],["toggle","Add / remove note"]]),
 ["undo","Undo"],["redo","Redo"],["help","Keyboard controls"]
];
function chooseAction(id){
 if(["type","settings","lane","random","step","help"].includes(id)){openMenu(id);return;}
 if(id==="undo"){historyMove(mockup.history,mockup.future);return;}
 if(id==="redo"){historyMove(mockup.future,mockup.history);return;}
 if(id==="regenerate"){checkpoint();mockup.random.seed=(mockup.random.seed+1)%1000000;generateRandom();}
 if(id==="bake"){checkpoint();mockup.events=copy(eventsForView());mockup.view="tracker";mockup.notice="Preview copied into the tracker. Undo restores the previous notes.";}
 if(id==="toggle"){checkpoint();const at=mockup.events.findIndex(e=>e.step===mockup.cursor);if(at>=0)mockup.events.splice(at,1);else mockup.events.push({step:mockup.cursor,pitch:60,velocity:100,duration:mockup.config.gate/100,channel:1,chord:"Single",fx:["—","—","—"]});}
 closeMenu();
}
function projection(){
 const c=mockup.config,events=eventsForView(),first=mockup.page*16,steps=Array.from({length:Math.min(16,c.steps-first)},(_,i)=>first+i);
 const focus=events.find(e=>e.step===mockup.cursor),pitch=focus?.pitch??60;
 const rowCount=mockup.view==="randomizer"?Math.min(36,mockup.random.high-mockup.random.low+1):12;
 const bottom=mockup.view==="randomizer"?Math.max(mockup.random.low,Math.min(mockup.random.high-rowCount+1,pitch-Math.floor(rowCount/2))):Math.max(0,Math.min(116,pitch-5));
 const rows=Array.from({length:rowCount},(_,i)=>{const n=bottom+rowCount-1-i;return {id:n,note:n,label:rowCount>24&&n%2?"":noteName(n)};});
 const cells=events.filter(e=>e.pitch>=bottom&&e.pitch<bottom+rowCount).flatMap(e=>steps.filter(step=>step>=e.step&&step<e.step+e.duration).map(step=>({row:e.pitch,step,start:e.step,offset:0,duration:e.duration,velocity:e.velocity})));
 return {connected:true,busy:false,kind:"sequencer",title:"Phrase 2 / Pattern 5",screen:"sequencer_mockup",message:"Interactive mockup · session changes only",error:"",canvasFocus:!mockup.menu,selected:0,columns:2,
 items:menuActions().map(([id,label])=>({id,label,enabled:(id!=="undo"||mockup.history.length>0)&&(id!=="redo"||mockup.future.length>0),kind:"action"})),
 sequence:{type:"notes",tempo:c.tempo,steps,stepsPerBeat:Math.max(1,c.division/4),rows,cells,selected:[mockup.cursor,pitch],editMode:0,playState:mockup.playing?1:0,playhead:-1,noteValues:{Velocity:focus?.velocity??100,Duration:focus?.duration??1}}};
}
backend={get state(){return JSON.stringify(projection());},choose:chooseAction,input(action){if(action==="focus"||action==="menu"){mockup.menu?closeMenu():openMenu("actions");}else if(action==="back")closeMenu();else if(action==="left"||action==="right")moveCursor(action==="left"?-1:1,0);},sequence(action,first){if(action==="cell"){mockup.cursor=first;render();}else if(action==="play")togglePreview();else if(action==="select")chooseAction("toggle");}};
const baseRender=render;
render=function(){
 if(pointerHeld)return;
 baseRender();
 const s=JSON.parse(backend.state),status=el("sequence").querySelector(".seq-status");status.replaceChildren();
 const type=button(`${modes[mockup.view]} ▾`,()=>openMenu("type"));type.id="sequencer-type";type.title="Sequencer type";
 const title=node("strong","seq-title","Phrase 2 / Pattern 5");
 const timing=button(`${mockup.config.steps} steps · 1/${mockup.config.division}${mockup.config.tuplet==="Triplet"?"T":mockup.config.tuplet==="Dotted"?"D":""}`,()=>openMenu("settings"));timing.id="pattern-settings";timing.title="Pattern settings: step count, length, swing, gate and scale";
 const play=button(mockup.playing?"■ Stop preview":"▶ Preview",togglePreview);play.id="preview-play";
 const menu=button("☰ Menu",()=>mockup.menu?closeMenu():openMenu("actions"));menu.id="context-toggle";menu.setAttribute("aria-expanded",!!mockup.menu);menu.setAttribute("aria-haspopup","dialog");menu.setAttribute("aria-controls","menu-panel");
 status.append(type,title,timing,play,menu);
 const surface=el("sequence").querySelector(".editor-surface");surface.setAttribute("aria-hidden",!!mockup.menu);
 if(mockup.menu)surface.setAttribute("inert","");else surface.removeAttribute("inert");
 if(mockup.view==="tracker"){surface.replaceChildren();renderTracker(surface);}
 else if(mockup.view==="euclidean"){surface.replaceChildren();renderEuclidean(surface);}
 else if(mockup.view==="randomizer"){surface.replaceChildren();renderRandomizer(surface,s);}
 else {surface.replaceChildren();surface.append(node("div","random-roll"));}
 renderPager(surface);
 const roll=surface.querySelector(".random-roll");if(roll){roll.replaceChildren();renderRoll(roll,s.sequence,s);}
 paintTransport();
 renderPanel();
 el("error").textContent=mockup.notice;el("error").onclick=()=>{mockup.notice="";render();};
};
function button(label,callback,cls="seq-button"){const b=node("button",cls,label);b.type="button";b.addEventListener("click",callback);return b;}
function renderPager(surface){
 const strip=node("div","mock-caption");
 strip.append(node("span","",mockup.view==="randomizer"?`Seed ${mockup.random.seed} · ${mockup.randomEvents.length} notes · ${Object.keys(mockup.locks).filter(k=>mockup.locks[k]).length} locked steps`:mockup.view==="euclidean"?"Select a lane to edit hits / rotation · tap a pulse to override":mockup.view==="tracker"?"Arrows select · Enter edits · Delete clears · Space previews":"Click a note to select · Enter edits · Space previews"));
 if(mockup.config.steps>16){const prev=button("‹",()=>{mockup.page--;mockup.cursor=mockup.page*16;render();});prev.disabled=mockup.page===0;const next=button("›",()=>{mockup.page++;mockup.cursor=mockup.page*16;render();});next.disabled=(mockup.page+1)*16>=mockup.config.steps;strip.append(prev,node("span","",`${mockup.page*16+1}–${Math.min((mockup.page+1)*16,mockup.config.steps)}`),next);}
 strip.append(node("span","mock-badge","MOCKUP · NO AUDIO"));surface.append(strip);
}
function renderTracker(host){
 const wrap=node("div","tracker-wrap"),table=node("div","tracker-table");table.setAttribute("role","grid");table.setAttribute("aria-label","Tracker steps");
 const headers=["Step","Note","MIDI Channel","Chord","Velocity","Length","FX 1","FX 2","FX 3"];
 const header=node("div","tracker-row tracker-head");headers.forEach(h=>header.append(node("span","",h)));table.append(header);
 const first=mockup.page*16;
 for(let step=first;step<Math.min(first+16,mockup.config.steps);step++){
  const notes=mockup.events.filter(e=>e.step===step),n=notes[0];
  const row=node("div",`tracker-row${step%4===0?" beat":""}${step===mockup.cursor?" active-row":""}${mockup.playing&&step===mockup.playhead?" playing-row":""}`);row.dataset.step=step;
  row.append(node("span","step-number",String(step+1).padStart(2,"0")));
  const values=n?[`${noteName(n.pitch)}${notes.length>1?" +"+(notes.length-1):""}`,n.channel,n.chord,n.velocity,`${Number(n.duration.toFixed(2))} step`,...n.fx]:Array(8).fill("—");
  values.forEach((value,col)=>{const b=button(value,()=>{mockup.cursor=step;mockup.column=col;openMenu("step");},`tracker-cell${mockup.cursor===step&&mockup.column===col?" cell-focus":""}${n?" has-note":""}`);b.setAttribute("aria-label",`Step ${step+1}, ${headers[col+1]}, ${value}`);row.append(b);});table.append(row);
 }
 wrap.append(table);host.append(wrap);
}
function renderEuclidean(host){
 const container=node("div","euclidean-lanes");
 mockup.euclidean.forEach((lane,index)=>{
  const row=node("section",`euclidean-lane${mockup.lane===index?" selected-lane":""}${lane.muted?" muted-lane":""}`);
  const head=node("div","lane-heading");const edit=()=>{mockup.lane=index;openMenu("lane");};
  head.append(button(`${index+1} · ${lane.name} · ${noteName(lane.pitch)}`,edit,"lane-name"),node("span","lane-summary",`${lane.hits} / ${mockup.config.steps} hits · rotate ${lane.rotation} · velocity ${lane.velocity} · gate ${lane.gate}%`),button("Edit…",edit),button(lane.muted?"Unmute":"Mute",()=>{checkpoint();lane.muted=!lane.muted;render();}));
  const steps=node("div","pulse-grid");const first=mockup.page*16,count=Math.min(16,mockup.config.steps-first);steps.style.gridTemplateColumns=`repeat(${count},minmax(0,1fr))`;
  for(let step=first;step<first+count;step++){
   const on=pulse(lane,step),over=Object.hasOwn(lane.overrides,step),b=button("",()=>{checkpoint();mockup.lane=index;mockup.cursor=step;lane.overrides[step]=!on;render();},`pulse${on?" on":""}${over?" override":""}${mockup.playing&&mockup.playhead===step?" play-position":""}`);
   b.setAttribute("aria-label",`${lane.name}, step ${step+1}, ${on?"hit":"rest"}${over?", manual override":""}`);b.setAttribute("aria-pressed",on);
   b.append(node("small","",String(step+1)),node("strong","",on?"●":"·"),node("span","",over?"manual":on?String(lane.velocity):""));steps.append(b);
  }
  row.append(head,steps);container.append(row);
 });host.append(container);
}
function renderRandomizer(host,state){
 const controls=node("div","generator-strip");controls.append(node("span","",`${mockup.config.scale} · ${noteName(mockup.random.low)}–${noteName(mockup.random.high)} · ${mockup.random.density}% density`),button("Rules…",()=>openMenu("random")),button("Generate variation",()=>chooseAction("regenerate")),button("Use preview",()=>chooseAction("bake")));host.append(controls);
 const roll=node("div","random-roll");host.append(roll);
 const locks=node("div","random-locks");locks.append(node("span","lock-label","LOCK STEP"));
 const first=mockup.page*16,count=Math.min(16,mockup.config.steps-first);locks.style.gridTemplateColumns=`56px repeat(${count},minmax(0,1fr))`;
 for(let step=first;step<first+count;step++){
  const e=mockup.randomEvents.find(e=>e.step===step),locked=!!mockup.locks[step];const b=button("",()=>{checkpoint();mockup.locks[step]=!locked;render();},`lock-step${locked?" locked":""}`);b.setAttribute("aria-label",`${locked?"Unlock":"Lock"} step ${step+1}`);b.setAttribute("aria-pressed",locked);b.append(node("small","",String(step+1)),node("strong","",e?noteName(e.pitch):"Rest"),node("span","",locked?"LOCKED":"open"));locks.append(b);
 }host.append(locks);
}
function field(form,label,key,options,extra={}){
 const row=node("label","setting-row"),text=node("span","",label);let input;
 if(Array.isArray(options)){input=node("select");options.forEach(v=>{const [value,title]=Array.isArray(v)?v:[v,v];const opt=node("option","",title);opt.value=value;input.append(opt);});}
 else{input=node("input");input.type="number";Object.assign(input,options);}
 input.id=`field-${key}`;input.name=key;input.value=mockup.draft[key];input.required=true;input.addEventListener("input",()=>{mockup.draft[key]=input.type==="number"?input.valueAsNumber:(["division","root","pitch","channel"].includes(key)?Number(input.value):input.value);el("config-duration")&&(el("config-duration").textContent=durationText(mockup.draft));});
 row.append(text,input);if(extra.help)row.append(node("small","",extra.help));form.append(row);return input;
}
function durationText(c){const mult=c.tuplet==="Triplet"?2/3:c.tuplet==="Dotted"?1.5:1;const beats=c.steps*4/c.division*mult;return Number.isFinite(beats)?`${c.steps} steps × 1/${c.division}${c.tuplet==="Straight"?"":" "+c.tuplet.toLowerCase()} = ${Number(beats.toFixed(3))} beats (${Number((beats/4).toFixed(3))} bars in 4/4)` : "Enter a step count.";}
function renderPanel(){
 const panel=el("menu-panel");panel.classList.toggle("form-panel",!!mockup.menu&&mockup.menu!=="actions");
 if(!mockup.menu)return;
 const titles={actions:`${modes[mockup.view]} actions`,type:"Sequencer type",settings:"Pattern settings",step:`Step ${mockup.cursor+1} · edit note`,lane:`${mockup.euclidean[mockup.lane].name} · Euclidean`,random:"Randomizer settings",help:"Keyboard controls"};
 el("context-title").textContent=titles[mockup.menu];
 el("context-description").textContent=mockup.menu==="type"?"Choose how to edit or generate this pattern.":mockup.menu==="settings"?"Step count sets the pattern size. Step length sets the musical duration of each step.":mockup.menu==="random"?"Generate a repeatable preview. Locked steps stay unchanged.":mockup.menu==="lane"?"Hits are evenly distributed across the pattern; rotation shifts their positions.":"";
 el("context-help").textContent="Esc / Back closes · changes stay in this mockup session";
 if(mockup.menu==="actions")return;
 const content=el("items");content.replaceChildren();
 if(mockup.menu==="type"){
  const descriptions={notes:"Position, pitch and note duration on a grid.",tracker:"Step rows with notes, MIDI channel, chord, velocity and FX.",euclidean:"Distribute hits evenly; adjust rotation for each lane.",randomizer:"Generate notes using density, scale, ranges and a seed."};
  for(const [value,label] of Object.entries(modes)){const b=button("",()=>switchMode(value),`mode-choice${mockup.view===value?" chosen":""}`);b.dataset.mode=value;b.setAttribute("aria-pressed",mockup.view===value);b.append(node("strong","",`${mockup.view===value?"✓ ":""}${label}`),node("span","",descriptions[value]));content.append(b);}content.append(node("p","form-note","Switching types preserves authored notes. Use preview explicitly copies generated notes into the tracker."));return;
 }
 if(mockup.menu==="help"){const p=node("p","help-copy","Arrows: move tracker cursor. Enter: edit selected step or lane. Delete: clear a tracker step. Space: visual transport. M / F5: context menu. Escape: close popover. Tab: focus controls. Click steps to edit or override; click randomizer locks to protect steps. Playback is a visual timing preview with no audio or MIDI.");content.append(p);return;}
 const form=node("form","settings-form");content.append(form);
 if(mockup.menu==="settings"){
  field(form,"Number of steps","steps",{min:1,max:64,step:1});
  const presets=node("div","length-presets");for(const n of [8,16,32,64])presets.append(button(String(n),()=>{mockup.draft.steps=n;el("field-steps").value=n;el("config-duration").textContent=durationText(mockup.draft);}));form.append(presets);
  field(form,"Step length","division",[4,8,16,32,64].map(n=>[n,`1/${n}`]));field(form,"Subdivision","tuplet",["Straight","Triplet","Dotted"]);
  const duration=node("p","form-note",durationText(mockup.draft));duration.id="config-duration";form.append(duration);
  field(form,"Tempo · BPM","tempo",{min:20,max:300,step:1});field(form,"Swing · %","swing",{min:0,max:75,step:1});field(form,"Default gate · %","gate",{min:1,max:100,step:1});field(form,"Direction","direction",["Forward","Reverse","Ping-pong"]);
  field(form,"Root","root",noteNames.map((n,i)=>[i,n]));field(form,"Scale","scale",Object.keys(scales));
  form.append(node("p","form-note","Shortening hides steps past the end; expanding restores them. Step length retimes the grid. Generators use the selected root and scale when regenerated."));
 }else if(mockup.menu==="random"){
  field(form,"Seed","seed",{min:0,max:999999,step:1});field(form,"Density · %","density",{min:0,max:100,step:1});
  const pitches=Array.from({length:128},(_,n)=>[n,noteName(n)]);field(form,"Lowest note","low",pitches);field(form,"Highest note","high",pitches);
  field(form,"Min velocity","velocityLow",{min:1,max:127,step:1});field(form,"Max velocity","velocityHigh",{min:1,max:127,step:1});field(form,"Min gate · %","gateLow",{min:1,max:100,step:1});field(form,"Max gate · %","gateHigh",{min:1,max:100,step:1});
  form.append(node("p","form-note",`Pitch choices follow ${noteNames[mockup.config.root]} ${mockup.config.scale.toLowerCase()}. A locked rest remains a rest.`));
 }else if(mockup.menu==="lane"){
  field(form,"Hits","hits",{min:0,max:mockup.config.steps,step:1});field(form,"Rotation · steps","rotation",{min:0,max:mockup.config.steps-1,step:1});field(form,"Note","pitch",Array.from({length:128},(_,n)=>[n,noteName(n)]));field(form,"Velocity","velocity",{min:1,max:127,step:1});field(form,"Gate · %","gate",{min:1,max:100,step:1});
  const clear=button("Clear manual overrides",()=>{mockup.draft.overrides={};clear.textContent="Overrides will be cleared on Apply";});form.append(clear);
 }else if(mockup.menu==="step"){
  field(form,"Note","pitch",Array.from({length:128},(_,n)=>[n,noteName(n)]));field(form,"MIDI Channel","channel",midiChannels);field(form,"Chord","chord",["Single","Minor","Major","Diminished","Minor 7","Major 7"]);field(form,"Velocity","velocity",{min:1,max:127,step:1});field(form,"Length · steps","duration",{min:.05,max:64,step:.05});
  for(let i=0;i<3;i++){mockup.draft[`fx${i}`]=mockup.draft.fx[i];field(form,`FX ${i+1}`,`fx${i}`,["—","Chance 75%","Chance 50%","Retrigger 2","Retrigger 4","Strum +10 ms","Octave +1","Octave −1"]);}
  form.append(node("p","form-note","Chord and FX fields can be edited here; audio interpretation belongs to the future sequencer integration."));
 }
 const error=node("p","form-error");error.id="form-error";error.setAttribute("role","alert");form.append(error);
 const actions=node("div","form-actions"),cancel=button("Cancel",closeMenu),apply=button(mockup.menu==="random"?"Apply & generate":"Apply",()=>{});apply.type="submit";apply.id="apply-settings";actions.append(cancel,apply);form.append(actions);
 form.addEventListener("submit",e=>{e.preventDefault();applyDraft();});
 // Numeric select fields retain numeric values as drafts.
 for(const key of ["low","high"])el(`field-${key}`)?.addEventListener("input",e=>mockup.draft[key]=Number(e.target.value));
}
function applyDraft(){
 const d=mockup.draft;if(!d)return;
 if(mockup.menu==="random"){
  if(d.low>d.high||d.velocityLow>d.velocityHigh||d.gateLow>d.gateHigh){el("form-error").textContent="Minimum values must not exceed maximum values.";return;}
  if(!Array.from({length:d.high-d.low+1},(_,i)=>i+d.low).some(n=>scales[mockup.config.scale].includes((n-mockup.config.root+12)%12))){el("form-error").textContent="This pitch range contains no notes in the selected scale.";return;}
 }
 checkpoint();
 if(mockup.menu==="settings"){mockup.config=copy(d);mockup.cursor=Math.min(mockup.cursor,d.steps-1);mockup.page=Math.floor(mockup.cursor/16);mockup.playhead=Math.min(mockup.playhead,d.steps-1);mockup.euclidean.forEach(l=>{l.hits=Math.min(l.hits,d.steps);l.rotation%=d.steps;});generateRandom();}
 if(mockup.menu==="random"){mockup.random=copy(d);generateRandom();}
 if(mockup.menu==="lane")mockup.euclidean[mockup.lane]=copy(d);
 if(mockup.menu==="step"){
  const event=copy(d);event.fx=[d.fx0,d.fx1,d.fx2];for(let i=0;i<3;i++)delete event[`fx${i}`];
  const at=mockup.events.findIndex(e=>e.step===mockup.cursor);if(at<0)mockup.events.push(event);else mockup.events[at]=event;
 }
 closeMenu();
}
function moveCursor(horizontal,vertical){mockup.column=Math.max(0,Math.min(7,mockup.column+horizontal));mockup.cursor=Math.max(0,Math.min(mockup.config.steps-1,mockup.cursor+vertical));mockup.page=Math.floor(mockup.cursor/16);render();document.querySelector(".cell-focus")?.focus({preventScroll:true});}
let clock;
function tick(){if(!mockup.playing)return;const n=mockup.config.steps,dir=mockup.config.direction;
 if(dir==="Reverse")mockup.playhead=(mockup.playhead-1+n)%n;
 else if(dir==="Ping-pong"){if(mockup.playhead>=n-1)mockup.travel=-1;if(mockup.playhead<=0)mockup.travel=1;mockup.playhead=n===1?0:mockup.playhead+mockup.travel;}
 else mockup.playhead=(mockup.playhead+1)%n;
 // Updating only the cursor avoids replacing active form fields and buttons.
 paintTransport();scheduleTick();
}
function scheduleTick(){clearTimeout(clock);const c=mockup.config,m=c.tuplet==="Triplet"?2/3:c.tuplet==="Dotted"?1.5:1;clock=setTimeout(tick,60000/c.tempo*4/c.division*m*(1+(mockup.playhead%2?-1:1)*c.swing/100));}
function paintTransport(){
 for(const row of document.querySelectorAll('.tracker-row[data-step]'))row.classList.toggle("playing-row",mockup.playing&&Number(row.dataset.step)===mockup.playhead);
 for(const lane of document.querySelectorAll('.pulse-grid'))[...lane.children].forEach((b,i)=>b.classList.toggle("play-position",mockup.playing&&mockup.page*16+i===mockup.playhead));
 const svg=document.querySelector('.piano-roll');if(svg){let line=svg.querySelector('.mock-playhead');if(!line)line=svgNode(svg,"line",{class:"mock-playhead",stroke:"#71bb9d","stroke-width":3,"pointer-events":"none"});const x=56+(mockup.playhead-mockup.page*16)*(svg.viewBox.baseVal.width-58)/Math.min(16,mockup.config.steps-mockup.page*16);for(const [k,v]of Object.entries({x1:x,x2:x,y1:16,y2:svg.viewBox.baseVal.height-3,visibility:mockup.playing&&mockup.playhead>=mockup.page*16&&mockup.playhead<mockup.page*16+16?"visible":"hidden"}))line.setAttribute(k,v);}
}
function togglePreview(){mockup.playing=!mockup.playing;clearTimeout(clock);render();if(mockup.playing)scheduleTick();}
document.addEventListener("keydown",event=>{
 const typing=["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName);
 if(event.key==="Escape"){event.preventDefault();closeMenu();return;}
 if(typing)return;
 if(event.key==="Enter"&&document.activeElement.tagName==="BUTTON"&&!document.activeElement.classList.contains("tracker-cell"))return;
 if(event.key==="m"||event.key==="F5"){event.preventDefault();mockup.menu?closeMenu():openMenu("actions");return;}
 if(mockup.menu)return;
 if(event.key===" "){event.preventDefault();if(!event.repeat)togglePreview();}
 else if(event.key==="Enter"){event.preventDefault();openMenu(mockup.view==="euclidean"?"lane":mockup.view==="randomizer"?"random":"step");}
 else if(event.key.startsWith("Arrow")){event.preventDefault();if(mockup.view==="euclidean"){mockup.lane=Math.max(0,Math.min(3,mockup.lane+(event.key==="ArrowDown"?1:event.key==="ArrowUp"?-1:0)));render();}else moveCursor(event.key==="ArrowLeft"?-1:event.key==="ArrowRight"?1:0,event.key==="ArrowDown"?1:event.key==="ArrowUp"?-1:0);}
 else if(event.key==="Delete"&&(mockup.view==="tracker"||mockup.view==="notes")){event.preventDefault();checkpoint();mockup.events=mockup.events.filter(e=>e.step!==mockup.cursor);render();}
});
generateRandom();bindActions();if(mockup.menu)openMenu(mockup.menu);else render();
