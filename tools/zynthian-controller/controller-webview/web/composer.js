/* SPDX-License-Identifier: GPL-2.0-or-later */
// Rendering and input only. Authored state, generation, transport and persistence are C++.
let composer, composerState, nativeVisible = true, nativeMenu = null;
const names = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const pitchName = pitch => pitch < 0 ? 'OFF' : names[pitch % 12] + (Math.floor(pitch / 12) - 1);
const sendComposer = request => composer.command(JSON.stringify(request));
function nativeButton(label, callback, title) {
  const button = node('button', '', label); button.type = 'button';
  if (title) button.title = title;
  button.onclick = callback; return button;
}
function showNative(visible) {
  nativeVisible = visible; backend.setNativeMode(visible);
  document.body.classList.toggle('native-composer', visible);
  document.getElementById('composer-root').hidden = !visible;
  document.getElementById('return-composer').hidden = visible;
  if (visible) renderComposer();
}
function connectComposer(channel) {
  composer = channel.objects.composer;
  if (!composer) return;
  const root = node('section'); root.id = 'composer-root'; root.setAttribute('aria-label', 'Native sequencers');
  document.body.append(root);
  const back = nativeButton('Controller sequencers', () => showNative(true)); back.id = 'return-composer'; document.body.append(back);
  composer.changed.connect(renderComposer);
  composer.menuRequested.connect(() => nativeMenu ? closeNativeMenu() : openNativeMenu('cell'));
  composer.menuInput.connect(action => {
    if (action === 'back' || action === 'focus' || action === 'menu') { closeNativeMenu(); return; }
    const fields = [...document.querySelectorAll('#native-dialog button,#native-dialog input,#native-dialog select')];
    const at = fields.indexOf(document.activeElement);
    if (action === 'up' || action === 'down') fields[(at + (action === 'up' ? -1 : 1) + fields.length) % fields.length]?.focus();
    else if (action === 'select') document.activeElement?.click();
    else if (action === 'left' || action === 'right') {
      const field = document.activeElement, delta = action === 'left' ? -1 : 1;
      if (field?.tagName === 'SELECT') field.selectedIndex = Math.max(0, Math.min(field.options.length - 1, field.selectedIndex + delta));
      else if (field?.type === 'number') delta > 0 ? field.stepUp() : field.stepDown();
    }
  });
  showNative(true);
}
function renderComposer() {
  composerState = JSON.parse(composer.state);
  if (!nativeVisible || nativeMenu || pointerHeld) return;
  const s = composerState, c = s.config, root = document.getElementById('composer-root'); root.replaceChildren();
  const bar = node('div', 'native-bar');
  const chooser = node('select'); chooser.setAttribute('aria-label', 'Sequencer type');
  for (const [value, label] of Object.entries({notes:'Piano roll',tracker:'Tracker',euclidean:'Euclidean',randomizer:'Randomizer'})) {
    const option = node('option','',label); option.value=value; chooser.append(option);
  }
  chooser.value=s.view; chooser.onchange=()=>sendComposer({action:'view',view:chooser.value});
  bar.append(chooser, nativeButton(s.playing?'Stop':'Play',()=>sendComposer({action:'play'})),
    node('span','native-tempo',`${c.tempo} BPM · ${c.steps} steps · 1/${c.division}`),
    nativeButton('Zynthian / Clips',()=>showNative(false)), nativeButton('Menu',()=>openNativeMenu('actions')));
  root.append(bar);
  const status=node('div','native-status',s.error || s.output); status.setAttribute('role',s.error?'alert':'status'); root.append(status);
  if (s.view==='notes') renderNativePiano(root,s);
  else renderNativeTracker(root,s);
  const footer=node('div','native-footer',`Track ${s.track+1} · Row ${s.row+1} · Arrows move · Enter edit · Space play · Tab menu · [ ] gate · − / = velocity`);
  if(s.view==='euclidean' || s.view==='randomizer') footer.append(nativeButton('Generate on selected track',()=>openNativeMenu('generator')));
  root.append(footer);
}
function renderNativeTracker(root,s) {
  const surface=node('div','native-grid-scroll'), table=node('table','native-tracker'), head=node('tr'); head.append(node('th','','Step'));
  for(let track=0;track<s.config.tracks;++track) {
    const lane=s.tracks[track], heading=node('th'), label=nativeButton(`Track ${track+1}`,()=>sendComposer({action:'cursor',row:s.row,track}));
    const mute=nativeButton(lane.mute?'M●':'M',()=>sendComposer({action:'mute',track,value:!lane.mute}),'Mute track');
    const solo=nativeButton(lane.solo?'S●':'S',()=>sendComposer({action:'solo',track,value:!lane.solo}),'Solo track');
    heading.append(label,mute,solo); head.append(heading);
  }
  table.append(head);
  const start=Math.floor(s.row/16)*16;
  for(let row=start;row<Math.min(start+16,s.config.steps);++row) {
    const tr=node('tr',row===s.playhead?'playing':''); tr.append(node('th','',String(row+1).padStart(2,'0')));
    for(let track=0;track<s.config.tracks;++track) {
      const cell=s.tracks[track].cells[row], td=node('td'), button=nativeButton(cell?pitchName(cell.pitch):'···',()=>{
        sendComposer({action:'cursor',row,track}); openNativeMenu('cell',{...s,row,track});
      });
      button.setAttribute('aria-label',`Track ${track+1}, step ${row+1}, ${cell?pitchName(cell.pitch)+', MIDI channel '+cell.channel:'empty, sustain'}`);
      if(cell && cell.pitch>=0) button.append(node('small','',`ch${cell.channel} v${cell.velocity}`));
      if(row===s.row && track===s.track) button.className='selected'; td.append(button); tr.append(td);
    }
    table.append(tr);
  }
  surface.append(table); root.append(surface);
}
function renderNativePiano(root,s) {
  const surface=node('div','native-grid-scroll'), table=node('table','native-piano'), start=Math.floor(s.row/16)*16;
  const selected=s.tracks[s.track].cells[s.row], center=selected?.pitch>=0?selected.pitch:60, bottom=Math.max(0,Math.min(104,center-12));
  const head=node('tr'); head.append(node('th','',`T${s.track+1}`));
  for(let row=start;row<Math.min(start+16,s.config.steps);++row) head.append(node('th','',row+1)); table.append(head);
  for(let pitch=bottom+23;pitch>=bottom;--pitch) {
    const tr=node('tr'); tr.append(node('th','',pitchName(pitch)));
    for(let row=start;row<Math.min(start+16,s.config.steps);++row) {
      const cell=s.tracks[s.track].cells[row], active=cell?.pitch===pitch, td=node('td');
      const button=nativeButton(active?'●':'',()=>sendComposer({action:'cell',row,track:s.track,cell:active?null:{pitch,channel:cell?.channel||1,velocity:100,gate:s.config.gate}}));
      button.setAttribute('aria-label',`${pitchName(pitch)}, step ${row+1}${active?', note':''}`);
      button.className=(active?'note ':'')+(row===s.playhead?'playing ':'')+(row===s.row?'cursor':''); td.append(button); tr.append(td);
    }
    table.append(tr);
  }
  surface.append(table); root.append(surface);
}
function closeNativeMenu() {
  nativeMenu=null; document.getElementById('native-overlay')?.remove();
  composer.setMenuOpen(false); backend.setTextEditing(false); renderComposer();
}
function formField(form,label,name,value,options) {
  const wrapper=node('label','',label); let input;
  if(Array.isArray(options)) {
    input=node('select'); for(const item of options) { const option=node('option','',item); option.value=item; input.append(option); }
  } else { input=node('input'); input.type='number'; input.min=options[0]; input.max=options[1]; }
  input.name=name; input.value=value; wrapper.append(input); form.append(wrapper); return input;
}
function numeric(form,label,name,value,min,max) {
  const wrapper=node('label','',label), input=node('input'); input.type='number';input.required=true;
  input.name=name; input.value=value; input.min=min; input.max=max; input.step=1; wrapper.append(input); form.append(wrapper);return input;
}
function openNativeMenu(kind,s=composerState) {
  if(nativeMenu) closeNativeMenu(); nativeMenu=kind; composer.setMenuOpen(true); backend.setTextEditing(true);
  const overlay=node('div'); overlay.id='native-overlay'; overlay.onclick=e=>{if(e.target===overlay)closeNativeMenu();};
  const dialog=node('form'); dialog.id='native-dialog'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-label',kind+' settings');
  dialog.append(node('h2','',kind==='cell'?`Track ${s.track+1} · Step ${s.row+1}`:kind==='generator'?s.view:'Pattern & actions'));
  dialog.append(nativeButton('Close · Esc',closeNativeMenu)); overlay.append(dialog); document.body.append(overlay);
  const values=()=>Object.fromEntries([...new FormData(dialog)].map(([key,value])=>[key,/^-?\d+$/.test(value)?Number(value):value]));
  if(kind==='actions') {
    for(const [label,action] of [['Undo','undo'],['Redo','redo'],['Save project','save'],['Stop / release notes','stop']]) dialog.append(nativeButton(label,()=>{sendComposer({action});closeNativeMenu();}));
    dialog.append(nativeButton('Pattern settings',()=>openNativeMenu('settings')),
      nativeButton('Edit selected cell',()=>openNativeMenu('cell')));
    if(s.view==='euclidean'||s.view==='randomizer') dialog.append(nativeButton('Generator settings',()=>openNativeMenu('generator')));
    dialog.append(node('p','',`Save path: ${s.project || 'unavailable'}. Zynthian snapshots remain separate.`));
  } else if(kind==='cell') {
    const cell=s.tracks[s.track].cells[s.row]||{pitch:60,channel:1,velocity:100,gate:0};
    numeric(dialog,'MIDI note (−1 = OFF)','pitch',cell.pitch,-1,127);
    numeric(dialog,'MIDI Channel','channel',cell.channel,1,16); numeric(dialog,'Velocity','velocity',cell.velocity,1,127);
    numeric(dialog,'Gate % (0 = sustain until next note / OFF)','gate',cell.gate,0,6400);
    dialog.append(nativeButton('Clear → empty / sustain',()=>{sendComposer({action:'cell',row:s.row,track:s.track,cell:null});closeNativeMenu();}),
      nativeButton('OFF',()=>{sendComposer({action:'cell',row:s.row,track:s.track,cell:{...cell,pitch:-1}});closeNativeMenu();}));
    dialog.onsubmit=e=>{e.preventDefault();sendComposer({action:'cell',row:s.row,track:s.track,cell:values()});closeNativeMenu();};
  } else if(kind==='settings') {
    const c=s.config;
    for(const [label,key,min,max] of [['Steps','steps',1,64],['Tracks','tracks',1,16],['Tempo','tempo',20,300],['Swing %','swing',0,75],['Default gate %','gate',1,100],['Root (C=0)','root',0,11]]) numeric(dialog,label,key,c[key],min,max);
    formField(dialog,'Step denominator','division',c.division,[4,8,16,32,64]);
    formField(dialog,'Timing','timing',c.timing,['Straight','Triplet','Dotted']);
    formField(dialog,'Direction','direction',c.direction,['Forward','Reverse','Ping-pong']);
    formField(dialog,'Scale','scale',c.scale,['Chromatic','Major','Natural minor','Harmonic minor']);
    dialog.onsubmit=e=>{e.preventDefault();sendComposer({action:'config',config:values()});closeNativeMenu();};
  } else {
    numeric(dialog,'Target track (1-based)','target',s.track+1,1,s.config.tracks);
    numeric(dialog,'MIDI Channel','channel',1,1,16); numeric(dialog,'Velocity','velocity',100,1,127);
    if(s.view==='euclidean') {
      numeric(dialog,'Hits','hits',Math.min(4,s.config.steps),0,s.config.steps);
      numeric(dialog,'Rotation','rotation',0,0,s.config.steps-1); numeric(dialog,'MIDI note','pitch',60,0,127);
    } else {
      numeric(dialog,'Seed','seed',42,0,1000000); numeric(dialog,'Density %','density',70,0,100);
      numeric(dialog,'Lowest note','low',48,0,127); numeric(dialog,'Highest note','high',84,0,127);
    }
    dialog.append(node('p','','Generate replaces active steps on target track. Undo restores previous notes.'));
    dialog.onsubmit=e=>{e.preventDefault();const v=values();sendComposer({action:'generate',kind:s.view,...v,track:v.target-1});closeNativeMenu();};
  }
  if(kind!=='actions') { const apply=node('button','','Apply');apply.type='submit';dialog.append(apply); }
  dialog.addEventListener('keydown',e=>{
    if(e.key==='Escape') {e.preventDefault();closeNativeMenu();}
    if(e.key==='Tab') {
      const fields=[...dialog.querySelectorAll('button,input,select')], at=fields.indexOf(document.activeElement);
      if(e.shiftKey&&at===0) {e.preventDefault();fields.at(-1).focus();}
      else if(!e.shiftKey&&at===fields.length-1) {e.preventDefault();fields[0].focus();}
    }
  });
  dialog.querySelector('input,select,button').focus();
}
