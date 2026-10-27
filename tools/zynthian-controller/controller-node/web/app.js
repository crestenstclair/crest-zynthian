/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";
let backend;
let lastFocus = "";
let pointerHeld = false;
let editingParameter = false;
let focusedControl = null;
let navigationReturnFocus = null;
let lastRenderSignature = '';
document.addEventListener("focusin", event => {
  const key = event.target.dataset.focusKey;
  focusedControl = key && backend ? {key, screen: JSON.parse(backend.state).screen} : null;
  if(key && /^(item|value):/.test(key)) backend?.focusItem?.(key.slice(key.indexOf(':')+1));
});
// A playback update must not replace a button between pointer-down and click.
document.addEventListener("pointerdown", () => { pointerHeld = true; }, true);
for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, () => {
  pointerHeld = false;
  setTimeout(() => { if (backend) render(); }, 0);
}, true);
const el = id => document.getElementById(id);
function render() {
  if (pointerHeld || editingParameter) return;
  const state = JSON.parse(backend.state);
  // A command acknowledgement is not a connection change or a screen load.
  state.busy=Boolean(state.backendBusy);
  el("connection").textContent = state.connected ? (state.backendBusy ? "Loading…" : "Connected") : "Disconnected";
  el("connection").className = state.connected ? "online" : "offline";
  el("error").textContent = state.error || "";
  el("input-status").textContent = state.inputStatus || "Keyboard / touch";
  el("input-held").textContent = state.inputHeld || '';
  const signature=renderSignature(state);
  if(signature===lastRenderSignature) {updateLocalFocus(state);return;}
  lastRenderSignature=signature;
  el("title").textContent = state.connected ? state.title : "Waiting for Zynthian";
  el("screen-name").textContent = (state.screen || "Zynthian application").replaceAll("_", " ").toUpperCase();
  el("message").textContent = state.connected ? state.message : "Start Zynthian with the webview bridge enabled. The menus will appear when it connects.";
  el("error").textContent = state.error || "";
  el("input-status").textContent = state.inputStatus || "Keyboard / touch";
  el("transport-status").textContent = recordingStatus(state);
  renderScreenActions(state);
  renderScreenContent(state);
  renderNavigation(state);
  renderIdentity(state);
  renderHome(state);
  renderNameEntry(state);
  document.body.classList.toggle("sequencing", state.kind === "sequencer");
  el("footer-hints").textContent = state.kind === "sequencer" ?
    "× Select / hold + directions adjust · ○ Shift: ← Parent / ↑ Details / ↓ Return · △ Jump · □ Context" :
    "D-pad Move · × Select / hold to adjust · ○ Shift + ← Back / ↑ Details · △ Jump · □ Options";
  const sequencing = state.kind === "sequencer" && state.connected;
  const menuOpen = sequencing && state.canvasFocus === false;
  el("menu-panel").hidden = state.homeOpen || sequencing && !menuOpen;
  el("context-dismiss").hidden = !menuOpen;
  el("menu-panel").setAttribute("role", sequencing ? "dialog" : "region");
  if (sequencing) el("menu-panel").setAttribute("aria-labelledby", "context-title");
  else el("menu-panel").removeAttribute("aria-labelledby");
  if (menuOpen) el("menu-panel").setAttribute("aria-modal", "true");
  else el("menu-panel").removeAttribute("aria-modal");
  el("context-title").textContent = state.sequence?.type === "launcher" ? "Clip & phrase actions" :
    state.sequence?.type === "cc" ? "CC automation actions" : state.sequence?.editMode ? "Note selection actions" : "Piano roll actions";
  el("context-description").textContent = state.message || "";
  renderSequence(state);
  const list = el("items");
  const scroll = list.scrollTop;
  list.replaceChildren();
  list.className = state.kind === "keyboard" ? `grid cols-${Math.min(10, state.columns || 1)}` : "list";
  if (state.mixer?.length) list.className = "mixer-grid";
  if (state.instrument) list.className = "instrument-workspace";
  if (state.properties) list.className = 'property-list';
  const itemHosts = prepareItemHosts(list, state);
  (state.items || []).forEach((item, index) => {
    if (item.visible === false) return;
    if (state.mixer?.length && renderMixerItem(itemHosts, item, index, state)) return;
    const row = node("div", "item-row");
    row.dataset.kind=item.id.split(':')[0];
    row.setAttribute("role", "listitem");
    const button = document.createElement("button");
    button.dataset.focusKey = `item:${item.id}`;
    button.disabled = !state.connected || state.busy || !item.enabled;
    button.className = "item" + (index === state.selected && (state.kind !== "sequencer" || state.canvasFocus === false) ? " selected" : "") + (!item.enabled ? " divider" : "");
    button.setAttribute("aria-current", index === state.selected ? "true" : "false");
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(label);
    if (item.kind === "control") {
      const value = document.createElement("strong");
      value.textContent = item.display;
      button.append(value);
    } else {
      const arrow = document.createElement("span");
      arrow.className = "chevron";
      arrow.textContent = item.enabled ? "›" : "";
      button.append(arrow);
    }
    button.addEventListener("click", () => backend.choose(item.id));
    row.append(button);
    if (item.kind === "control" && !item.path) {
      for (const [label, delta] of [["−", -1], ["+", 1]]) {
        const adjust = node("button", "item-adjust", label);
        adjust.dataset.focusKey = `adjust:${item.id}:${delta}`;
        adjust.setAttribute("aria-label", `${delta < 0 ? "Decrease" : "Increase"} ${item.label}`);
        adjust.disabled = button.disabled;
        adjust.onclick = event => backend.adjust(item.id, delta, event.shiftKey);
        row.append(adjust);
      }
      if (typeof backend.setValue === "function" && !item.toggle && (!state.properties || !item.choices)) {
        const value = document.createElement("input");
        value.type = "number"; value.value = item.value;
        value.min = item.minimum; value.max = item.maximum; value.step = item.integer ? "1" : "any";
        value.setAttribute("aria-label", `Set ${item.label}`); value.disabled = button.disabled;
        value.onfocus = () => { editingParameter = true; };
        value.onblur = () => { editingParameter = false; render(); };
        value.onkeydown = event => { if (event.key === "Enter") value.blur(); };
        value.onchange = () => { if (value.checkValidity()) backend.setValue(item.id, Number(value.value)); };
        row.append(value);
      }
    }
    if (item.options) {
      const options = node("button", "item-options", "Options");
      options.dataset.focusKey = `options:${item.id}`;
      options.setAttribute("aria-label", `Options for ${item.label}`);
      options.disabled = button.disabled;
      options.onclick = () => backend.activate(item.id, true);
      row.append(options);
    }
    const itemHost = itemHosts.get(item.id) || list;
    itemHost.append(row);
    if (state.instruments && item.id.startsWith('instrument:')) {
      const instrument = state.instruments.find(value => value.target === item.id);
      if(!instrument) return;
      const summary = instrument.processors.map(p => [p.name,p.preset].filter(Boolean).join(' / ')).join(' · ');
      row.append(node('span','instrument-summary',`${channelLabel(instrument.channel)} · ${summary || 'Routing / output'}`));
    }
  });
  list.scrollTop = scroll;
  const focusKey = `${state.screen}:${state.selected}`;
  if (focusKey !== lastFocus) list.querySelector(".selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  lastFocus = focusKey;
  const restore = focusedControl && focusedControl.screen === state.screen ?
    document.querySelector(`[data-focus-key="${CSS.escape(focusedControl.key)}"]`) : null;
  if (restore && !restore.disabled && (!menuOpen || restore.closest('#menu-panel'))) restore.focus({preventScroll:true});
  else if (menuOpen) list.querySelector(".selected")?.focus({preventScroll: true});
  const selected = state.items?.[state.selected];
  el("selection-description").textContent = selected?.description || "";
  el("selection-actions").hidden = !selected?.options;
  el("parameter").hidden = state.properties || selected?.kind !== "control" || selected.path;
  el("parameter-label").textContent = selected?.kind === "control" ? `${selected.label} · ${selected.display}` : "";
  for (const button of document.querySelectorAll("[data-action]")) button.disabled = !state.connected || (state.busy && !['focus','navigation'].includes(button.dataset.action));
  if(state.homeOpen) {
    for(const id of ['screen-actions','screen-content','sequence','name-entry','message']) el(id).hidden=true;
    el('title').textContent='WORKSPACES';el('screen-name').textContent='CREST';el('native-context').textContent='○ + ← / Shift + ← returns here';
  } else el('message').hidden=false;
  updateLocalFocus(state);
}

function renderSignature(state) {
  const localCursor=state.sequence && ['notes','launcher'].includes(state.sequence.type) && !state.sequence.editMode && !state.sequence.moving;
  const sequence=state.sequence?{...state.sequence,...(localCursor?{selected:[],noteValues:{}}:{}),playhead:0}:null;
  return JSON.stringify({...state,sequence,selected:0,trackerField:0,navigationIndex:0,homeIndex:0,
    revision:'',inputStatus:'',inputHeld:'',error:''});
}

function updateLocalFocus(state) {
  const s=state.sequence;
  document.querySelectorAll('#items .item').forEach(button=>{
    const selected=button.dataset.focusKey===`item:${state.items?.[state.selected]?.id}`;
    button.classList.toggle('selected',selected);button.setAttribute('aria-current',selected);
  });
  const selected=state.items?.[state.selected];
  el('selection-description').textContent=selected?.description||'';
  el('selection-actions').hidden=!selected?.options;
  el('parameter').hidden=state.properties||selected?.kind!=='control'||selected.path;
  el('parameter-label').textContent=selected?.kind==='control'?`${selected.label} · ${selected.display}`:'';
  if(state.kind!=='sequencer' || !state.canvasFocus) {
    const focused=document.querySelector('#items .item.selected');
    focused?.scrollIntoView({block:'nearest'});
    if(document.activeElement?.closest('#items')) focused?.focus({preventScroll:true});
  }
  for(const [selector,index] of [['#home-view .home-destination',state.homeIndex],['#navigation-items button',state.navigationIndex]]) {
    document.querySelectorAll(selector).forEach((button,i)=>{
      button.classList.toggle('selected',i===index);
      if(i===index && state.navigationOpen && selector.includes('navigation')) button.focus({preventScroll:true});
    });
  }
  if(s?.type==='notes' && !s.editMode) {
    document.querySelectorAll('.tracker-line').forEach(row=>{
      row.classList.toggle('tracker-selected',Number(row.dataset.step)===s.selected[0]);
      row.classList.toggle('playing',Boolean(s.playState) && Number(row.dataset.step)===s.playhead);
    });
    document.querySelectorAll('.tracker-cell').forEach(button=>{
      const row=button.dataset.row===''?s.selected[1]:Number(button.dataset.row);
      const selected=Number(button.dataset.step)===s.selected[0] && row===s.selected[1] && Number(button.dataset.field)===state.trackerField;
      button.classList.toggle('selected',selected);button.setAttribute('aria-current',selected);
    });
    document.querySelector('.tracker-cell.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
    const detail=document.querySelector('.seq-detail');
    if(detail && state.editorType==='tracker') {
      const event=s.events.find(event=>event.step===s.selected[0] && event.row===s.selected[1]);
      detail.textContent=`Step ${s.selected[0]+1} · `+(event?(event.velocity?`${event.label} · Vel ${event.velocity}`:'OFF'):'Empty / sustain');
    } else if(detail) detail.textContent=`Step ${s.selected[0]+1} · ${(s.keys||s.rows).find(row=>row.id===s.selected[1])?.label||''} · Vel ${s.noteValues?.Velocity??'—'} · Len ${s.noteValues?.Duration??'—'}`;
  }
  if(s?.type==='launcher') document.querySelectorAll('.clip').forEach(button=>button.classList.toggle('cursor',button.dataset.focusKey===`clip:${s.selected[0]}:${s.selected[1]}`));
  const roll=document.querySelector('.piano-roll');
  if(roll && s) {
    const {left,top,stepWidth,rowHeight,first}=roll.dataset;
    const cursor=roll.querySelector('.roll-cursor');
    if(cursor && !s.editMode) {
      cursor.setAttribute('x',Number(left)+(s.selected[0]-Number(first))*Number(stepWidth)+1);
      cursor.setAttribute('y',Number(top)+s.rows.findIndex(row=>row.id===s.selected[1])*Number(rowHeight)+1);
    }
    roll.querySelectorAll('.roll-note').forEach(note=>note.setAttribute('fill',
      Number(note.dataset.row)===s.selected[1] && Number(note.dataset.step)===s.selected[0]?'#ff6fbe':'#65e5ff'));
    roll.querySelectorAll('.roll-velocity').forEach(bar=>bar.style.display=Number(bar.dataset.row)===s.selected[1]?'':'none');
    const playhead=roll.querySelector('.roll-playhead');
    playhead.style.display=s.playState && s.steps.includes(s.playhead)?'':'none';
    const x=Number(left)+(s.playhead-Number(first))*Number(stepWidth);
    playhead.setAttribute('x1',x);playhead.setAttribute('x2',x);
  }
}

function renderHome(state) {
  const host=el('home-view');host.hidden=!state.homeOpen;host.replaceChildren();
  if(!state.homeOpen) return;
  (state.homeEntries||[]).forEach((entry,index)=>{
    const button=node('button','home-destination'+(index===state.homeIndex?' selected':''));
    button.append(node('strong','',entry.label),node('span','',entry.description));
    button.onclick=()=>backend.navigate(entry.action);button.disabled=state.busy;host.append(button);
  });
}

function renderNameEntry(state) {
  const form=el('name-entry');form.hidden=!state.textEntry || state.homeOpen;
  if(!state.textEntry) return;
  el('name-text').value=state.textEntry.value;
  el('name-text').inputMode=state.textEntry.numeric?'numeric':'text';
  el('name-text').onfocus=()=>{editingParameter=true;};
  el('name-text').onblur=()=>{editingParameter=false;};
  el('name-text').onkeydown=event=>{
    if(event.key==='Escape' || event.shiftKey && event.key==='ArrowLeft') {event.preventDefault();el('name-text').blur();backend.input('parent');}
  };
  form.onsubmit=event=>{event.preventDefault();const text=el('name-text').value;el('name-text').blur();backend.send({method:'text',text});};
}

function recordingStatus(state) {
  return [state.transport?.audioRecording && "● Audio recording", state.transport?.midiRecording && "● MIDI recording"].filter(Boolean).join(" · ");
}

function channelLabel(channel) {
  return Number.isInteger(channel) && channel>=0 && channel<16 ? `CH ${String(channel+1).padStart(2,'0')}` : 'AUDIO';
}

function renderIdentity(state) {
  const song=state.kind==='sequencer';
  const instrument=Boolean(state.instrument || state.instruments || ['engine','bank','preset','control','processor_options','add_chain'].includes(state.screen));
  document.querySelectorAll('.contexts button').forEach(button=>button.classList.toggle('active',
    button.dataset.action===((song||state.properties)?'launcher':instrument?'chainManager':state.mixer?'mixer':'')));
  if(song) {
    el('screen-name').textContent=state.sequence.type==='launcher'?'SONG':`PHRASE ${state.sequence.pattern ?? ''}`;
    el('title').textContent=state.sequence.type==='launcher'?`SCENE ${(state.sequence.scene??0)+1}`:state.title;
    el('native-context').textContent=state.sequence.type==='launcher'?`${state.sequence.tempo} BPM · ${state.sequence.chainCount} OUTPUTS`:
      `${channelLabel(state.sequence.channel)} · ${state.sequence.stepCount} STEPS · ${state.sequence.stepsPerBeat} STEPS / BEAT`;
  } else {
    el('screen-name').textContent=instrument?'INSTRUMENTS':state.mixer?'MIXER':(state.screen||'ZYNTHIAN').replaceAll('_',' ').toUpperCase();
    el('native-context').textContent=state.instrument?channelLabel(state.instrument.channel):'ZYNTHIAN';
    if(state.instruments) el('title').textContent=state.routingVisible?'ROUTING GRAPH':'LOADED SOUNDS';
    if(state.instrument) el('title').textContent=state.instrument.name;
    if(state.screen==='engine') {
      el('title').textContent=state.engineCategory===null?'Choose instrument category':state.engineCategoryName;
      el('native-context').textContent=state.engineCategory===null?'CATEGORY':'○ + ← Categories';
    }
    if(state.properties) {
      el('screen-name').textContent='PHRASE';
      el('native-context').textContent='PATTERN OPTIONS · ○ + ↓ Return';
    }
  }
}

function renderNavigation(state) {
  const panel=el('navigation-panel'),host=el('navigation-items');
  if(state.navigationOpen && !panel.open) {navigationReturnFocus=focusedControl;panel.showModal();}
  if(!state.navigationOpen && panel.open) {panel.close();focusedControl=navigationReturnFocus;}
  if(!state.navigationOpen) return;
  host.replaceChildren();
  (state.navigationEntries||[]).forEach((entry,index)=>{
    const button=node('button',index===state.navigationIndex?'selected':'',entry.label);
    button.dataset.route=entry.action;button.disabled=state.busy;
    button.onclick=()=>backend.navigate(entry.action);host.append(button);
    if(index===state.navigationIndex) button.focus({preventScroll:true});
  });
  host.querySelector('.selected')?.scrollIntoView({block:'nearest'});
}

function prepareItemHosts(list,state) {
  const hosts=new Map();
  if(state.mixer?.length) {
    const detail=node('aside','mixer-inspector');
    const selectedStrip=state.mixer.find(strip=>String(strip.id)===String(state.mixerChain)) || state.mixer[0];
    detail.append(node('h2','section-label',`${selectedStrip.name} / OUTPUT CONTROLS`));
    detail.append(node('p','sound-identity','Native chain output. Select another strip to inspect its routing and additional controls.'));
    for(const strip of state.mixer) {
      const column=node('section','mixer-strip');
      column.append(node('span','strip-channel',channelLabel(strip.channel)));
      column.dataset.chain=strip.id;
      hosts.set(`chain:${strip.id}`,column);
      strip.controls.forEach(control=>hosts.set(control.target,['level','balance','mute','solo'].includes(control.symbol)?column:detail));
      list.append(column);
    }
    list.append(detail);
  } else if(state.instrument) {
    const processors=node('section','processors'),controls=node('section','instrument-controls');
    processors.append(node('h2','section-label','ENGINE / PRESET / POST FX'));
    controls.append(node('h2','section-label',state.instrument.section.replaceAll('_',' ').toUpperCase()));
    list.append(processors,controls);
    for(const item of state.items) hosts.set(item.id,/^(processor|presets|sub):/.test(item.id)?processors:controls);
    const sound=state.instrument.processors.map(p=>[p.name,p.bank,p.preset].filter(Boolean).join(' / ')).join(' · ');
    processors.append(node('p','sound-identity',sound));
  }
  return hosts;
}

function renderMixerItem(hosts,item,index,state) {
  const host=hosts.get(item.id);if(!host) return false;
  const selected=index===state.selected;
  if(item.id.startsWith('chain:')) {
    const button=node('button','strip-name item'+(selected?' selected':''),item.label);
    button.dataset.focusKey=`item:${item.id}`;button.disabled=state.busy;
    button.onclick=()=>backend.choose(item.id);host.append(button);return true;
  }
  if(item.kind!=='control' || item.path) return false;
  const symbol=item.id.split(':').at(-1);
  const group=node('div','strip-control'+(selected?' selected':''));
  group.append(node('label','strip-label',symbol.toUpperCase()));
  if(item.toggle) {
    const button=node('button','mixer-toggle',symbol.toUpperCase());
    button.setAttribute('aria-label',item.label);button.setAttribute('aria-pressed',Boolean(item.value));
    button.dataset.focusKey=`item:${item.id}`;button.disabled=state.busy;
    button.onclick=()=>backend.choose(item.id);group.append(button);
  } else {
    const value=document.createElement('input');
    value.type=symbol==='level'?'range':'number';
    value.className=value.type==='range'?'mixer-fader':'mixer-value';
    value.min=item.minimum;value.max=item.maximum;value.step=item.integer?'1':'any';value.value=item.value;
    value.setAttribute('aria-label',`Set ${item.label}`);value.disabled=state.busy;
    value.dataset.focusKey=`value:${item.id}`;
    value.style.setProperty('--fill',`${100*(item.value-item.minimum)/Math.max(1,item.maximum-item.minimum)}%`);
    value.onfocus=()=>{editingParameter=true;backend.focusItem?.(item.id);};value.onblur=()=>{editingParameter=false;render();};
    value.onkeydown=event=>{if(event.key==='Enter')value.blur();};
    value.onchange=()=>{if(value.checkValidity())backend.setValue(item.id,Number(value.value));};
    const display=symbol==='level'?`${Math.round(item.value*100)}%`:symbol==='balance'?(Math.abs(item.value)<.001?'Centre':`${Math.round(Math.abs(item.value)*100)}% ${item.value<0?'L':'R'}`):item.display;
    group.append(value,node('output','mixer-readout',display));
  }
  host.append(group);return true;
}

function renderTracker(host,s,state) {
  const tracker=node('div','tracker-view tracker-columns');
  tracker.append(trackerColumn({name:'Instrument',channel:s.channel,events:s.events,steps:s.stepCount},s,state));
  host.append(tracker);
  tracker.querySelector('.tracker-cell.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
  const adjust=node('div','tracker-adjustments');
  for(const [label,action] of [['− Small','adjustSmallLess'],['+ Small','adjustSmallMore'],['− Large','adjustLargeLess'],['+ Large','adjustLargeMore']]) adjust.append(inputButton(label,action,state));
  const remove=node('button','','Clear cell');remove.disabled=state.busy;remove.onclick=()=>backend.sequence('remove',...backend.sequenceView().selected);adjust.append(remove);host.append(adjust);
  const help=node('p','tracker-help','Hold × + directions to enter/edit · EVENT selects Note / OFF / Empty · Empty rows sustain · ○↑ Pattern options');
  host.append(help);
}
function trackerColumn(track,s,state) {
  const active=track.channel===s.channel;
  const column=node('section','tracker-column'+(active?' active':''));
  const heading=node('button','tracker-instrument',track.name+' · '+channelLabel(track.channel));
  heading.onclick=()=>backend.navigate('chainControl');
  column.append(heading);
  const labels=node('div','tracker-fields');
  ['STEP','NOTE','VEL','EVENT','OFFS','CHANCE','STUT'].forEach(label=>labels.append(node('span','',label)));
  column.append(labels);
  for(const step of s.steps) column.append(trackerRow(step,track,s,state));
  return column;
}
function trackerRow(step,track,s,state) {
  const active=track.channel===s.channel,selected=active && step===s.selected[0];
  const row=node('div','tracker-line'+(selected?' tracker-selected':'')+(s.playState && step===s.playhead?' playing':''));
  row.dataset.step=step;
  row.append(node('span','tracker-step',String(step+1).padStart(2,'0')));
  const notes=track.events.filter(event=>event.step===step);
  if(selected && !notes.some(event=>event.row===s.selected[1])) notes.push(null);
  const voices=node('div','tracker-voices');
  for(const event of notes.length?notes:[null]) voices.append(trackerVoice(event,step,track,s,state));
  row.append(voices);return row;
}
function trackerVoice(event,step,track,s,state) {
  const active=track.channel===s.channel,row=event?.row??s.selected[1];
  const fields=['pitch','velocity','event','offset','probability','stutter'];
  const voice=node('div','tracker-voice');
  fields.forEach((field,index)=>{
    const selected=active && step===s.selected[0] && row===s.selected[1] && index===state.trackerField;
    const off=event && event.velocity===0;
    const kind=event?(off?'OFF':'Note'):'Empty';
    const label=field==='event'?kind:event?(index===0?(off?'OFF':event.label):off?'—':event[field]):'—';
    const button=node('button','tracker-cell'+(selected?' selected':''),String(label));
    button.dataset.step=step;button.dataset.row=event?row:'';button.dataset.field=index;
    button.dataset.focusKey='tracker:'+track.channel+':'+step+':'+row+':'+index;
    button.setAttribute('aria-label',track.name+', step '+(step+1)+', '+field+(event?', '+(index===0?(off?'OFF':event.label):label):', empty'));
    button.disabled=state.busy || step>=track.steps || state.canvasFocus===false;
    button.onclick=()=>backend.focusTracker(step,event?.row??backend.sequenceView().selected[1],index);
    voice.append(button);
  });
  return voice;
}

function renderScreenActions(state) {
  const host = el("screen-actions"); host.replaceChildren();
  for (const [action, label] of Object.entries(state.screenActions || {})) host.append(inputButton(label, action, state));
  if(state.instruments) {
    const routing=node('button','seq-button',state.routingVisible?'Loaded instruments':'Routing graph');
    routing.dataset.focusKey='routing-view';routing.onclick=()=>backend.toggleRouting?.();host.prepend(routing);
  }
  host.hidden = state.kind === "sequencer" || state.properties || !state.connected;
}

function renderScreenContent(state) {
  const host = el("screen-content"); host.replaceChildren();
  host.hidden = !state.content;
  if (!state.content) return;
  if (state.content.text) host.append(node("div", "screen-text", state.content.text));
  if (state.content.readouts) {
    const values = node("dl", "readouts");
    for (const [name, value] of Object.entries(state.content.readouts)) {
      values.append(node("dt", "", name.replaceAll("_", " ")), node("dd", "", value));
    }
    host.append(values);
  }
  if (state.content.type === "keyRange") {
    const keyboard = node("div", "range-keyboard");
    for (let note = 0; note < 128; note++) {
      const key = node("span", note >= state.content.low && note <= state.content.high ? "range-active" : "");
      key.title = `MIDI ${note}`; keyboard.append(key);
    }
    host.append(keyboard);
  }
}

function node(tag, cls, text) {
  const result = document.createElement(tag);
  if (cls) result.className = cls;
  if (text !== undefined) result.textContent = text;
  return result;
}
function seqButton(label, action, state) {
  const button = node("button", "seq-button", label);
  button.dataset.focusKey = `sequence:${action}`;
  button.disabled = state.busy || !state.connected;
  button.addEventListener("click", event => backend.sequence(action, 0, 0, event.shiftKey));
  return button;
}
function svgNode(parent, tag, attrs, text) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}
function inputButton(label, action, state) {
  const button = node("button", "seq-button", label);
  button.dataset.focusKey = `action:${action}`;
  button.disabled = !state.connected || (state.busy && action !== "focus");
  button.addEventListener("click", event => backend.input(action, event.shiftKey));
  return button;
}
function renderSequence(state) {
  const host = el("sequence");
  host.replaceChildren();
  host.hidden = state.homeOpen || state.properties || !state.sequence || !state.connected;
  if (host.hidden) return;
  const s = state.sequence;
  const menuOpen = state.canvasFocus === false;
  host.className = menuOpen ? "" : "canvas-focus";
  const status = node("div", "seq-status");
  status.append(inputButton("‹", "back", state));
  status.firstElementChild.setAttribute("aria-label", "Back");
  status.append(node("strong", "seq-title", s.type==='launcher'?'VIEW / PHRASES':s.type==='cc'?'CC AUTOMATION':'PHRASE EDITOR'));
  if (recordingStatus(state)) status.append(node("span", "recording", recordingStatus(state)));
  const detail = s.type === "launcher" ? (s.moving ? "Moving phrase · × finish" : `${s.phraseCount} phrases`) :
    s.type === "cc" ? `CC${s.cc} · ${s.value}` : s.editMode === 2 || s.editMode === 3 ?
      Object.entries(s.noteValues).map(([k,v],i) => i === s.editParam ? `${k} ${Number(v.toFixed(2))}` : "").filter(Boolean).join("") :
      `Step ${s.selected[0]+1} · ${s.rows.find(row=>row.id===s.selected[1])?.label || ''} · Vel ${s.noteValues?.Velocity ?? "—"} · Len ${s.noteValues?.Duration ?? "—"}`;
  status.append(node("span", "seq-detail", detail), node("span", "seq-tempo", `${s.tempo} BPM`));
  const playState = s.type === "launcher" ? s.cells.find(c => c.row === s.selected[0] && c.column === s.selected[1])?.playState : s.playState;
  const play = seqButton(playState ? "■ Stop" : "▶ Play", "play", state);
  if (s.recording) play.classList.add("recording");
  status.append(play);
  if(s.type==='notes' && typeof backend.setEditor==='function') {
    for(const [type,label] of [['piano','Piano roll'],['tracker','Tracker']]) {
      const button=node('button','seq-button editor-tab',label);
      button.dataset.focusKey=`editor:${type}`;button.setAttribute('aria-pressed',state.editorType===type);
      button.onclick=()=>backend.setEditor(type);status.append(button);
    }
    status.append(seqButton('Edit note','bold',state));
  }
  const acting = s.moving || s.editMode === 2 || s.editMode === 3;
  status.append(seqButton(acting ? "✓ Done" : s.editMode === 1 ? "Copy / paste" : s.type === "launcher" ? "Launch" : "± Note", "select", state));
  if(s.type==='launcher') {
    const open=node('button','seq-button','Open phrase');open.disabled=state.busy;
    open.onclick=()=>backend.sequence('open',...backend.sequenceView().selected);status.append(open);
  }
  if (s.type === "cc") status.lastElementChild.textContent = "± Event";
  const menu = inputButton("☰ Menu", "focus", state);
  menu.id = "context-toggle";
  menu.setAttribute("aria-haspopup", "dialog");
  menu.setAttribute("aria-expanded", menuOpen);
  menu.setAttribute("aria-controls", "menu-panel");
  menu.title = "Context menu · □ / Tab";
  status.append(inputButton('Details · ○↑','details',state));
  status.append(menu);
  host.append(status);
  const surface = node("div", "editor-surface");
  host.append(surface);
  if (s.type === "launcher") renderLauncher(surface, s, state);
  else if(s.type==='notes' && state.editorType==='tracker' && s.events) renderTracker(surface,s,state);
  else renderRoll(surface, s, state);
}
function renderLauncher(host, s, state) {
  const grid = node("div", "clip-grid");
  grid.style.gridTemplateColumns = `120px repeat(${s.columns.length}, minmax(96px, 1fr))`;
  grid.style.gridTemplateRows = `32px repeat(${s.rows.length}, minmax(38px, 1fr))`;
  grid.append(node("div", "clip-heading", "ROW"));
  for (const column of s.columns) grid.append(node("div", "clip-heading", `${column.label} · ${column.global?'ALL':channelLabel(column.channel)}`));
  for (const row of s.rows) {
    const title = node("div", "phrase-heading", `${row.id + 1} · ${row.label}`);
    title.append(node("small", "", row.follow === null ? "No follow action" : `Follow → ${row.id + row.follow + 1}`));
    grid.append(title);
    for (const column of s.columns) {
      const c = s.cells.find(c => c.row === row.id && c.column === column.id);
      const selected = s.selected[0] === row.id && s.selected[1] === column.id;
      const pad = node("button", `clip state-${c.playState}${selected ? " cursor" : ""}${c.repeat === 0 ? " clip-disabled" : ""}`);
      pad.disabled = !c.enabled || state.busy || state.canvasFocus === false;
      pad.setAttribute("aria-label", `${row.label}, ${column.label}, ${c.label}, ${c.status}`);
      pad.dataset.focusKey=`clip:${row.id}:${column.id}`;
      pad.append(node("strong", "", c.events ? c.label : '—'),
        node("span", "clip-meta", `${c.audio ? "AUDIO" : c.events + " events"} · ${c.repeat === 255 ? "LOOP" : c.repeat === 0 ? "DISABLED" : c.repeat + "×"} · ${c.status}`));
      pad.addEventListener("click", () => backend.sequence(s.moving?'cell':'open', row.id, column.id, false));
      grid.append(pad);
    }
  }
  host.append(grid);
}
function renderRoll(host, s, state) {
  // Match the available pixels: a fixed-aspect SVG would letterbox the editor.
  const width = Math.max(320, host.clientWidth), height = Math.max(160, host.clientHeight);
  const left = 56, right = width - 2, top = 24;
  const bottom = height - (s.type === "notes" ? 66 : 26), lane = bottom + 6;
  const stepWidth = (right - left) / Math.max(1, s.steps.length), first = s.steps[0] || 0;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "piano-roll");
  Object.assign(svg.dataset,{left,top,stepWidth,first});
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", s.type === "cc" ? `CC ${s.cc} automation editor` : "Piano roll and velocity lane");
  svgNode(svg, "rect", {width, height, fill: "#0c1015"});
  const select = (n, step, row) => {
    n.setAttribute("role", "button");
    n.setAttribute("aria-label", `Select step ${step + 1}, ${s.type === "notes" ? "row" : "value"} ${row}`);
    n.addEventListener("click", () => { if (!state.busy && state.canvasFocus !== false) backend.sequence("cell", step, row, false); });
  };
  if (s.type === "notes") {
    const rh = (bottom - top) / Math.max(1, s.rows.length);
    svg.dataset.rowHeight=rh;
    s.rows.forEach((row, ri) => {
      const y = top + ri * rh, black = [1,3,6,8,10].includes(row.note % 12);
      svgNode(svg, "rect", {x:left, y, width:right-left, height:rh, fill:black ? "#17212b" : "#121821"});
      svgNode(svg, "rect", {x:0, y, width:left-2, height:rh-1, fill:black ? "#1d2733" : "#0c1015"});
      svgNode(svg, "text", {x:left-9, y:y+rh/2+4, "text-anchor":"end", fill:black ? "#b8c4d1" : "#b8c4d1", "font-size":12}, row.label);
      for (const step of s.steps) {
        const x = left + (step-first)*stepWidth;
        const r = svgNode(svg, "rect", {x, y, width:stepWidth, height:rh, fill:"transparent", stroke:"#2a3745", "stroke-width":0.5});
        select(r, step, row.id);
      }
    });
    const drawn = new Set();
    for (const cell of s.cells) {
      const key = `${cell.row}:${cell.start}`;
      if (!cell.velocity || drawn.has(key)) continue;
      drawn.add(key);
      const ri = s.rows.findIndex(r => r.id === cell.row);
      const begin = Math.max(first, cell.start + cell.offset);
      const end = Math.min(first + s.steps.length, cell.start + cell.offset + cell.duration);
      const r = svgNode(svg, "rect", {x:left+(begin-first)*stepWidth+1, y:top+ri*rh+3,
        width:Math.max(2,(end-begin)*stepWidth-2), height:rh-6,
        class:'roll-note', 'data-row':cell.row, 'data-step':cell.start,
        fill:cell.row === s.selected[1] && cell.start === s.selected[0] ? "#ff6fbe" : "#65e5ff", stroke:"#65e5ff", "stroke-width":1});
      select(r, Math.max(first, cell.start), cell.row);
    }
    const ri = s.rows.findIndex(r => r.id === s.selected[1]);
    if (ri >= 0) svgNode(svg, "rect", {x:left+(s.selected[0]-first)*stepWidth+1, y:top+ri*rh+1,
      class:'roll-cursor', width:stepWidth-2, height:rh-2, fill:"none", stroke:"#65e5ff", "stroke-width":3, "pointer-events":"none"});
    if (s.block) {
      const [a,b] = s.block, lo = Math.max(first,Math.min(a[0],b[0])), hi = Math.min(first+s.steps.length-1,Math.max(a[0],b[0]));
      s.rows.forEach((row, i) => {if (row.id >= Math.min(a[1],b[1]) && row.id <= Math.max(a[1],b[1]))
        svgNode(svg,"rect",{x:left+(lo-first)*stepWidth,y:top+i*rh,width:(hi-lo+1)*stepWidth,height:rh,fill:"#ff6fbe",opacity:0.25,"pointer-events":"none"});});
    }
    svgNode(svg,"text",{x:10,y:lane+15,fill:"#b4c4ca","font-size":10},"VELOCITY");
    for (const cell of s.cells.filter(c => c.start === c.step && s.steps.includes(c.step) && c.velocity)) {
      const h = cell.velocity/127*44;
      const bar = svgNode(svg,"rect",{class:'roll-velocity','data-row':cell.row,x:left+(cell.step-first)*stepWidth+stepWidth*.35,y:lane+48-h,width:Math.max(3,stepWidth*.3),height:h,fill:"#65e5ff"});
      select(bar,cell.step,cell.row);
    }
  } else {
    svgNode(svg,"rect",{x:left,y:top,width:right-left,height:bottom-top,fill:"#121821"});
    for(const value of [0,32,64,96,127]) {
      const y=bottom-value/127*(bottom-top);
      svgNode(svg,"line",{x1:left,x2:right,y1:y,y2:y,stroke:"#2a3745","stroke-width":.5});
      svgNode(svg,"text",{x:left-10,y:y+4,fill:"#c5cfd2","font-size":12,"text-anchor":"end"},value);
    }
    for(const c of s.cells) {
      const x=left+(c.step-first)*stepWidth;
      const r=svgNode(svg,"rect",{x,y:top,width:stepWidth,height:bottom-top,fill:c.step===s.selected[0]?"#65e5ff":"transparent",opacity:c.step===s.selected[0]?.16:1});
      select(r,c.step,s.selected[1]);
      if(c.value !== null) {
        const y=bottom-c.value/127*(bottom-top);
        svgNode(svg,"rect",{x:x+stepWidth*.25,y,width:stepWidth*.5,height:Math.max(2,bottom-y),fill:"#65e5ff","pointer-events":"none"});
        svgNode(svg,"circle",{cx:x+stepWidth/2,cy:y,r:4,fill:"#ff6fbe","pointer-events":"none"});
      }
    }
    svgNode(svg,"text",{x:left,y:lane+15,fill:"#c7d4d8","font-size":15},`CC ${s.cc} · value ${s.value} · ${s.interpolate ? "Interpolation on" : "Stepped"}`);
  }
  for (const step of s.steps) {
    const x=left+(step-first)*stepWidth;
    svgNode(svg,"line",{x1:x,x2:x,y1:top,y2:bottom,stroke:step%s.stepsPerBeat===0?"#415166":"#2a3745","stroke-width":step%s.stepsPerBeat===0?1.5:.5,"pointer-events":"none"});
    svgNode(svg,"text",{x:x+6,y:19,fill:step%s.stepsPerBeat===0?"#f2f6f8":"#819298","font-size":11},step+1);
  }
  svgNode(svg,"line",{class:'roll-playhead',y1:top-8,y2:height-3,stroke:"#58e887","stroke-width":3,"pointer-events":"none"});
  host.append(svg);

}
let resizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { lastRenderSignature='';if (backend) render(); });
});
function bindActions() {
  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", event => backend.input(button.dataset.action, event.shiftKey));
  }
  el('navigation-panel').addEventListener('cancel',event=>{event.preventDefault();backend.input('navigation');});
}
window.attachBackend = model => {
    backend = model;
    backend.changed.connect(render);
    bindActions();
    render();
};
