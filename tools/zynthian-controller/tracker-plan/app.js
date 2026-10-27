// SPDX-License-Identifier: GPL-2.0-or-later
// Offline fixture interactions only. Zynthian remains the proposed musical authority.
'use strict';
const $ = selector => document.querySelector(selector);
const h = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const two = value => String(value).padStart(2, '0');
const copy = value => structuredClone(value);
const pitches = ['C4','C♯4','D4','E♭4','E4','F4','F♯4','G4','A♭4','A4','B♭4','B4','C5'];
const trackNames = ['DRUMS','BASS','LEAD','CHORD','PULSE','TEXTURE','ARP','AUX','KEYS','PAD','PERC','ECHO','BRASS','STRINGS','FX','MIDI'];
const channels = [10,2,3,4,5,6,7,8,1,9,11,12,13,14,15,16];
const presetNames = ['Standard Kit','Synth Bass 1','Lead 1 (square)','Pad 2 (warm)','Lead 2 (sawtooth)','Pad 4 (choir)','Electric Piano 1','Acoustic Grand Piano'];
const firstRows = [[1,5,8,12,15,17,19,22],[1,5,8,12,15,18,20,22],[2,6,9,13,16,17,19,23],[3,5,10,14,15,null,21,null],[1,7,8],[4,7,11],[2],[3]];
const model = {
  name:'NIGHT CURRENT', tempo:120, trackCount:8,
  song:Array.from({length:12}, (_, row) => Array.from({length:16}, (_, col) => firstRows[row]?.[col] ?? null)),
  tracks:trackNames.map((name, i) => ({name, channel:channels[i], muted:false, solo:false})),
  phrases:{},
  instruments:channels.slice(0,8).map((channel, i) => ({name:trackNames[i],channel,preset:presetNames[i],volume:100-i*4,pan:0,muted:false,solo:false}))
};
function makePhrase(id) {
  const notes = [0,3,7,5,10,7];
  const cells = {};
  [0,2,4,6,8,12].forEach((step,i) => {cells[step] = {note:pitches[notes[(i+id-1)%notes.length]],channel:channels[(id-1)%8],velocity:80+(i%3)*12};});
  cells[14] = {note:'OFF'};
  return {name:`PHRASE ${two(id)}`,steps:16,resolution:'1/16',timing:'Straight',cells};
}
for(let id=1; id<=23; id++) model.phrases[id] = makePhrase(id);
// Keep the first visible example's destination consistent with its track.
Object.values(model.phrases[1].cells).forEach(cell => {if(cell.note !== 'OFF') cell.channel=10;});
const ui = {view:'song',songRow:0,songTrack:0,phraseId:1,editor:'tracker',step:0,instrument:0,playing:false,playStep:0,trackPage:0};
const history = [], future = [];
let previewTimer, returnFocus, pendingEdit;

const mappings = {
  song:{title:'Song = sequencer overview',status:'adapt',body:'<p>The scene / sequencer overview becomes the Song workspace. Each cell opens a pad’s musical material directly as a Crest Phrase. There is no intermediate tracker Chain.</p><p>The current adapter reads <code>scenes[scene].phrases[row].sequences[channel]</code>. Its native “phrase” is an arrangement row, not the Crest note editor. Keep those native identities behind the view.</p><p>Native repeat, follow and launch behavior remains authoritative. The numbered references here are illustrative; a live adapter must discover real pattern references instead of inventing them.</p>'},
  phrase:{title:'Phrase = a pad’s notes',status:'adapt',body:'<p>Crest Phrase presents the pattern opened from a pad / clip. Tracker and piano roll are two views of the same musical material. ZynSeq retains note storage, playback, timing and undo.</p><p>The demo projects one monophonic lane. Empty rows sustain; OFF ends the held note. Its piano-roll lengths are derived from the next note, OFF or pattern end. Live integration must translate these rules to native durations without losing polyphony, offsets or expression.</p><p>The existing piano-roll adapter already reads native notes, lengths, velocity and offsets. Tracker, per-note channels, Euclidean and Randomizer still require playback and persistence integration.</p>'},
  instruments:{title:'Instruments = loaded Zynthian sounds',status:'adapt',body:'<p>A preset is the starting point, but an Instrument means the loaded sound: engine, bank, preset, processor controls and MIDI destination. It is a view of native state, not a separate engine or preset system.</p><p>Choose an engine from the installed list, then bank and preset using native workflows. Preset changes affect every track using that loaded sound. The demo’s FluidSynth / FluidR3 choices are examples, not a live inventory.</p><p>Zynthian processor chains stay here, including effects and MIDI/audio routing. Figma’s shared sound library and pinned revisions do not have an established native equivalent.</p>'},
  mixer:{title:'Mixer = actual chain outputs',status:'existing',body:'<p>These vertical strips map to Zynthian mixer channels: volume, pan, mute, solo and master. The real frontend will display confirmed native values and meters.</p><p>A tracker track is not necessarily an audio strip. Multiple tracks can target one loaded instrument and share its mixer output. Track mute suppresses that track’s sequence; chain mute silences every source routed through the chain.</p><p>Demo faders change local numbers only. Sends must follow supported audio routes; the view must not create hidden buses.</p>'},
  routing:{title:'Keep the Zynthian routing chain',status:'existing',body:'<p>Zynthian chains organize MIDI processors, sound engines, audio effects and connections. Show them as an ordered processor list and a routing inspector inside Instruments.</p><p>A tracker Chain orders phrases. It is omitted from this proposal. Removing that navigation layer does not remove or rename native routing objects.</p><p>The live view must preserve channel selection, MIDI device input, key/CC filters, audio input/output, effect order and available sends. Use native validation before changing routes.</p>'},
  file:{title:'Song File / snapshots',status:'existing',body:'<p>Full-session Save and Load use Zynthian snapshots, including the engine, routing and sequencer state supported by the connected runtime. Preserve native file selection, overwrite confirmation and failure reporting.</p><p>ZS3 remains a performance-state workflow. Pattern files and MIDI import/export operate on their native scope. Neither is a substitute for a complete session snapshot.</p><p>This HTML demo has no Save-to-Zynthian operation. Reloading resets its fixtures. A future frontend may store presentation metadata alongside the session, but must not fork native musical state.</p>'},
  recordings:{title:'Recordings',status:'existing',body:'<p>Give audio and MIDI recordings their own menu destination: record, play, browse, rename and manage files through existing native operations. Engine-provided loopers remain available through their processor controls.</p><p>Piano-roll MIDI recording belongs in Phrase. Full MPE capture and expression editing need a verified event and persistence contract before claiming support.</p>'},
  devices:{title:'Settings / devices',status:'adapt',body:'<p>Group MIDI devices, channel/filter profiles, clock/sync, controller setup and supported system functions here. Keep Song settings separate from host settings.</p><p>Show capability-specific tools such as Wi-Fi, Bluetooth, CV and touch calibration only when the connected host supports them. Surface native errors and unavailable reasons.</p>'},
  chords:{title:'Chord Bank / tracker FX',status:'new',body:'<p>Reuse native root, scale and chord operations where available. The Figma’s shared default/custom chord bank, per-note chord references and FX1–3 pipeline require additional design.</p><p>Map commands individually to supported note properties or native MIDI/CC operations. Do not silently reinterpret a Crest FX command as a Zynthian effect plugin. Unsupported commands stay explicit.</p>'},
  generators:{title:'Phrase editors / generators',status:'new',body:'<p>Tracker and piano roll share musical events. Euclidean generates from steps, hits and rotation; Randomizer generates within pitch, scale, rhythm, velocity and gate constraints, with seeds and locks.</p><p>Preview first, then commit ordinary notes through native editing as one undoable change. No second clock, MIDI engine or instrument library.</p><p>These generators already have interactive mockups in the repository; native playback and persistence integration remain work. Drum editing is optional. This plan demo implements only tracker and piano-roll fixture editing.</p>'},
  timing:{title:'Pattern timing contract',status:'new',body:'<p>Requested range: 1–64 steps; 1/4 to 1/64; straight, triplet and dotted timing; tempo, swing, gate, direction, root and scale. The demo changes length and visual resolution only.</p><p>Native timing capabilities must be checked. Changing an editing grid should not retime recorded notes. Generators use gate; the tracker’s empty/OFF sustain rules must not be silently overridden by it. Direction and loop behavior need explicit note-release rules.</p>'},
  controls:{title:'Controls / preview limits',status:'adapt',body:'<p>Mouse/touch: choose a Song cell, edit a Phrase row, or open a context. Keyboard: arrows move focus; Enter selects; Escape returns; F5 opens navigation; F2 opens Mixer; F6 returns to Song; Space starts/stops visual motion. Tab reaches ordinary UI controls.</p><p>Existing standard gamepad map: D-pad / left stick move; south face selects; east face returns; west face toggles visual motion; north face opens context; Start opens navigation. Nintendo face labels may differ. Bindings are provisional.</p><p>Focus the window and press/release a controller button. The footer reports actual browser detection. Input reuses the runtime’s browser Gamepad / native SDL adapter; this demo has no audio, backend writes or persistent edits.</p>'}
};
const badgeNames = {existing:'EXISTING BACKEND',adapt:'FRONTEND ADAPTATION',new:'NEW CAPABILITY / DECISION'};
function announce(text) { $('#announcement').textContent=text; }
function checkpoint() {history.push(copy(model));if(history.length>40) history.shift();future.length=0;}
function moveHistory(source, destination) {
  if(!source.length) return;
  destination.push(copy(model));Object.assign(model,source.pop());
  if(!model.phrases[ui.phraseId]) ui.phraseId=model.song[ui.songRow][ui.songTrack] || 1;
  render();announce('Demo edit history updated.');
}
function phraseUses(id) {
  return model.song.flatMap((row,r) => row.map((phrase,c) => phrase===id ? {row:r,track:c} : null).filter(Boolean));
}
function activePhrase() {return model.phrases[ui.phraseId];}
function openDialog(title, html) {
  const dialog=$('#popover');
  if(!dialog.open) returnFocus=document.activeElement;
  $('#popover-title').textContent=title;$('#popover-content').innerHTML=html;
  if(!dialog.open) dialog.showModal();
  const first=$('#popover-content').querySelector('button,input,select,a');
  (first || $('#close-popover')).focus();
}
function closeDialog() {
  $('#popover').close();pendingEdit=null;
  if(returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  else focusCurrent();
}
function explain(key) {
  const item=mappings[key];
  openDialog(item.title,`<span class="badge ${item.status}">${badgeNames[item.status]}</span>${item.body}<div class="dialog-actions"><button data-action="close">Back to workspace</button><button data-action="plan">Read full plan</button></div>`);
}
function showPlan() {if($('#popover').open) closeDialog();$('#plan').scrollIntoView({behavior:'instant'});$('#plan').focus({preventScroll:true});}
function setView(view) {
  if($('#popover').open) closeDialog();
  ui.view=view;render();focusCurrent();$('#demo').scrollIntoView({behavior:'instant'});
}
function focusCurrent() {
  let target;
  if(ui.view==='song') target=$(`#song-${ui.songRow}-${ui.songTrack}`);
  if(ui.view==='phrase') target=$(`#note-${ui.step}`) || $('#workspace button');
  (target || $('#workspace button') || $('#menu')).focus({preventScroll:true});
}
function setIdentity(section,title,subtitle) {
  $('#identity').innerHTML=`<span class="eyebrow">${h(section)}</span><h2>/ ${h(title)}</h2><span class="subtitle">${h(subtitle)}</span>`;
}
function render() {
  ui.songTrack=Math.min(ui.songTrack,model.trackCount-1);
  ui.trackPage=Math.floor(ui.songTrack/8)*8;
  ui.step=Math.min(ui.step,activePhrase().steps-1);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view===(ui.view==='phrase'?'song':ui.view)));
  ({song:renderSong,phrase:renderPhrase,instruments:renderInstruments,mixer:renderMixer}[ui.view])();
  const mapping=ui.view==='phrase'?'phrase':ui.view;
  const summaries={song:'Song cells open Phrase directly. Native scenes / arrangement underneath.',phrase:'One pad’s notes. Tracker and piano roll share this fixture.',instruments:'Loaded engine + bank + preset + routing. No second instrument system.',mixer:'Native chain outputs, not automatically one strip per tracker track.'};
  $('#mapping-strip').innerHTML=`<span>${summaries[mapping]}</span><button data-explain="${mapping}">? HOW THIS MAPS</button>`;
  $('#breadcrumb').textContent=ui.view==='phrase'?`SONG / TRACK ${two(ui.songTrack+1)} / PHRASE ${two(ui.phraseId)}`:ui.view.toUpperCase();
  paintPlayhead();
}
function songCell(id,row,col) {
  const selected=row===ui.songRow && col===ui.songTrack;
  const classes=['song-cell',selected?'cursor':'',id?'':'empty',(row===2||row===3)&&id?'variation':'',model.tracks[col].muted?'track-muted':''];
  return `<button id="song-${row}-${col}" class="${classes.join(' ')}" data-song-row="${row}" data-song-track="${col}" data-grid-cell tabindex="${selected?0:-1}" aria-label="Row ${row+1}, track ${col+1} ${h(model.tracks[col].name)}, ${id?'phrase '+two(id):'empty'}">${id?two(id):'—'}</button>`;
}
function songRow(row,index) {
  const cells=row.slice(ui.trackPage,Math.min(ui.trackPage+8,model.trackCount)).map((id,i)=>songCell(id,index,i+ui.trackPage));
  return `<div class="row-label">${two(index+1)}</div>${cells.join('')}`;
}
function renderSong() {
  const count=Math.min(8,model.trackCount-ui.trackPage);
  const tracks=model.tracks.slice(ui.trackPage,ui.trackPage+count);
  setIdentity('SONG',model.name,`${model.tempo} BPM · C MINOR · ${model.trackCount} TRACKS`);
  const headers=tracks.map((track,i)=>`<button class="column-label" data-track="${i+ui.trackPage}" aria-label="Track ${i+ui.trackPage+1} options">${two(i+ui.trackPage+1)} / ${h(track.name)}${track.muted?' M':''}${track.solo?' S':''}</button>`).join('');
  const id=model.song[ui.songRow][ui.songTrack];
  $('#workspace').innerHTML=`<div class="toolbar"><span>VIEW / PHRASES</span><span>TRACKS ${two(ui.trackPage+1)}–${two(ui.trackPage+count)} OF ${two(model.trackCount)}</span>${model.trackCount>8?'<button data-action="bank">OTHER TRACKS ↔</button>':''}<button data-action="song-settings" class="push">SONG SETTINGS</button><button data-action="file">SONG FILE</button></div><div class="grid-scroll"><div class="song-grid" style="--tracks:${count}"><div class="column-label">ROW</div>${headers}${model.song.map(songRow).join('')}</div></div><div id="selection-detail" class="selection-detail">${id?`PHRASE ${two(id)} · ${model.phrases[id].steps} steps · ${phraseUses(id).length} references`:'EMPTY SLOT · Select to assign a phrase'} &nbsp; | &nbsp; SELECT opens notes</div>`;
}
function enterPhrase(row,track) {
  ui.songRow=row;ui.songTrack=track;
  const id=model.song[row][track];
  if(!id) {openAssignment();return;}
  ui.phraseId=id;ui.step=0;setView('phrase');
}
function openAssignment() {
  openDialog('Assign a phrase',`<p>Song row ${two(ui.songRow+1)} · Track ${two(ui.songTrack+1)}. Reuse an existing phrase reference or create a new one in this demo.</p><form id="assign-form"><div class="form-row"><label for="assign-phrase">Phrase</label><select id="assign-phrase">${Object.keys(model.phrases).map(id=>`<option value="${id}">${two(id)} · ${h(model.phrases[id].name)}</option>`).join('')}</select></div><div class="dialog-actions"><button type="button" data-action="new-phrase">Create new</button><button type="submit">Use reference</button></div></form>`);
  $('#assign-form').onsubmit=event=>{event.preventDefault();checkpoint();model.song[ui.songRow][ui.songTrack]=Number($('#assign-phrase').value);closeDialog();enterPhrase(ui.songRow,ui.songTrack);};
}
function createPhrase() {
  checkpoint();const id=Math.max(...Object.keys(model.phrases).map(Number))+1;
  model.phrases[id]={...makePhrase(id),cells:{}};model.song[ui.songRow][ui.songTrack]=id;
  closeDialog();enterPhrase(ui.songRow,ui.songTrack);
}
function renderPhrase() {
  const phrase=activePhrase();
  setIdentity(`PHRASE ${two(ui.phraseId)}`,phrase.name,`TRACK ${two(ui.songTrack+1)} · ${phrase.steps} STEPS · ${phrase.resolution}`);
  $('#workspace').innerHTML=`<div class="toolbar"><button data-action="back">← SONG</button><button data-editor="tracker" aria-pressed="${ui.editor==='tracker'}">TRACKER</button><button data-editor="piano" aria-pressed="${ui.editor==='piano'}">PIANO ROLL</button><button data-explain="generators">OTHER EDITORS</button><button class="push" data-action="phrase-settings">PATTERN SETTINGS</button><button data-action="undo" ${history.length?'':'disabled'}>UNDO</button><button data-action="redo" ${future.length?'':'disabled'}>REDO</button></div>${ui.editor==='tracker'?trackerMarkup(phrase):pianoMarkup(phrase)}<div class="selection-detail">MIDI CHANNEL PER NOTE &nbsp; | &nbsp; ${phraseUses(ui.phraseId).length} references &nbsp; | &nbsp; — sustain · OFF release · loop boundary releases</div>`;
}
function trackerRow(step) {
  const cell=activePhrase().cells[step];
  const note=cell?.note??'—';
  const common=`data-step="${step}" tabindex="${ui.step===step?0:-1}"`;
  return `<div class="row-label" data-play-row="${step}">${two(step+1)}</div><button id="note-${step}" class="tracker-cell ${ui.step===step?'cursor':''} ${note==='OFF'?'off':''} ${cell?'':'tracker-empty'}" ${common} aria-label="Row ${step+1} note ${h(note)}">${h(note)}</button><button class="tracker-cell target" ${common} aria-label="Row ${step+1} MIDI channel">${cell?.channel?'CH '+two(cell.channel):'—'}</button><button class="tracker-cell" ${common} aria-label="Row ${step+1} velocity">${cell?.velocity??'—'}</button><button class="tracker-fx" data-explain="chords" tabindex="-1" aria-label="FX 1 proposal">—</button><span class="tracker-fx">—</span><span class="tracker-fx">—</span>`;
}
function trackerMarkup(phrase) {
  return `<div class="grid-scroll"><div class="tracker-grid"><span class="column-label">ROW</span><span class="column-label">NOTE</span><span class="column-label">MIDI CHANNEL</span><span class="column-label">VELOCITY</span><span class="column-label">FX 1*</span><span class="column-label">FX 2*</span><span class="column-label">FX 3*</span>${Array.from({length:phrase.steps},(_,step)=>trackerRow(step)).join('')}</div></div><span class="muted" style="font-size:10px">* FX commands require a native mapping; shown as a planned extension.</span>`;
}
// Monophonic fixture projection only. A blank has no event; OFF ends the held note.
function sustainedNotes(phrase) {
  const events=Object.keys(phrase.cells).map(Number).filter(step=>step<phrase.steps).sort((a,b)=>a-b);
  return events.map((step,i)=>({...phrase.cells[step],step,duration:(events[i+1]??phrase.steps)-step})).filter(cell=>cell.note!=='OFF');
}
function pianoPitchRow(note,row,steps) {
  const black=/♯|♭/.test(note);
  const cells=Array.from({length:steps},(_,step)=>`<button class="piano-cell ${black?'black':''}" style="grid-row:${row+2};grid-column:${step+2}" data-piano-step="${step}" data-pitch="${h(note)}" tabindex="-1" aria-label="Insert ${h(note)} at step ${step+1}"></button>`).join('');
  return `<div class="piano-key ${black?'black':''}" style="grid-row:${row+2};grid-column:1">${h(note)}</div>${cells}`;
}
function pianoNote(cell) {
  const row=12-pitches.indexOf(cell.note);
  return `<button id="note-${cell.step}" class="piano-note" style="grid-row:${row+2};grid-column:${cell.step+2}/span ${cell.duration}" data-step="${cell.step}" aria-label="${h(cell.note)} at step ${cell.step+1}, length ${cell.duration}, channel ${cell.channel}">${h(cell.note)}</button>`;
}
function pianoMarkup(phrase) {
  const steps=Array.from({length:phrase.steps},(_,i)=>`<span class="piano-step" style="grid-row:1;grid-column:${i+2}">${two(i+1)}</span>`).join('');
  const rows=[...pitches].reverse().map((note,i)=>pianoPitchRow(note,i,phrase.steps)).join('');
  const velocity=Array.from({length:phrase.steps},(_,i)=>`<div class="velocity-step" style="height:${(phrase.cells[i]?.velocity??0)/127*100}%">${phrase.cells[i]?.velocity??''}</div>`).join('');
  return `<div class="piano-scroll"><div class="piano" style="--steps:${phrase.steps}"><span class="piano-key">STEP</span>${steps}${rows}${sustainedNotes(phrase).map(pianoNote).join('')}</div></div><div class="velocity-lane" aria-label="Note velocities">${velocity}</div>`;
}
function requireEditScope(edit) {
  const uses=phraseUses(ui.phraseId);
  if(uses.length<2) {edit();return;}
  pendingEdit=edit;
  const locations=uses.map(use=>`<li>Row ${two(use.row+1)} · Track ${two(use.track+1)} / ${h(model.tracks[use.track].name)}</li>`).join('');
  openDialog('This phrase is shared',`<p>PHRASE ${two(ui.phraseId)} has ${uses.length} references. Choose the scope before editing.</p><ul>${locations}</ul><div class="dialog-actions"><button data-action="close">Cancel</button><button data-action="unique">Make unique</button><button data-action="shared">Edit shared</button></div>`);
}
function chooseScope(unique) {
  const edit=pendingEdit;pendingEdit=null;
  if(unique) {
    checkpoint();const id=Math.max(...Object.keys(model.phrases).map(Number))+1;
    model.phrases[id]=copy(activePhrase());model.phrases[id].name=`PHRASE ${two(id)}`;
    model.song[ui.songRow][ui.songTrack]=id;ui.phraseId=id;render();
  }
  edit?.();
}
function option(value,label,selected) {return `<option value="${h(value)}" ${String(value)===String(selected)?'selected':''}>${h(label)}</option>`;}
function openNoteEditor(step,pitch) {
  ui.step=step;
  requireEditScope(()=>{
    const cell={channel:model.tracks[ui.songTrack].channel,velocity:100,...activePhrase().cells[step]};
    cell.note=pitch??cell.note??'EMPTY';
    const choices=[option('EMPTY','— Empty / sustain',cell.note),option('OFF','OFF / release',cell.note),...pitches.map(note=>option(note,note,cell.note))].join('');
    openDialog(`Phrase ${two(ui.phraseId)} / row ${two(step+1)}`,`<p>Change the local example. Empty sustains; OFF releases the track’s held note.</p><form id="note-form"><div class="form-row"><label for="note-value">Note</label><select id="note-value">${choices}</select></div><div class="form-row"><label for="note-channel">MIDI Channel</label><select id="note-channel">${channels.map((_,i)=>option(i+1,`CH ${two(i+1)}`,cell.channel??model.tracks[ui.songTrack].channel)).join('')}</select></div><div class="form-row"><label for="note-velocity">Velocity</label><input id="note-velocity" type="number" min="1" max="127" value="${cell.velocity??100}" required></div><p class="dialog-note">Channel and velocity apply to notes only. No instrument or preset is loaded by this edit.</p><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button type="submit">Apply demo edit</button></div></form>`);
    $('#note-form').onsubmit=event=>{
      event.preventDefault();const note=$('#note-value').value;checkpoint();
      if(note==='EMPTY') delete activePhrase().cells[step];
      else activePhrase().cells[step]=note==='OFF'?{note}:{note,channel:Number($('#note-channel').value),velocity:Number($('#note-velocity').value)};
      render();closeDialog();announce('Note changed in local demo.');
    };
  });
}
function phraseSettings() {
  requireEditScope(()=>{
    const phrase=activePhrase();
    openDialog('Pattern settings',`<form id="phrase-form"><div class="form-row"><label for="phrase-length">Length / steps</label><input id="phrase-length" type="number" min="1" max="64" value="${phrase.steps}" required></div><div class="form-row"><label for="phrase-resolution">Resolution</label><select id="phrase-resolution">${['1/4','1/8','1/16','1/32','1/64'].map(value=>option(value,value,phrase.resolution)).join('')}</select></div><div class="form-row"><label for="phrase-timing">Timing</label><select id="phrase-timing">${['Straight','Triplet','Dotted'].map(value=>option(value,value,phrase.timing)).join('')}</select></div><p class="dialog-note">Shortening the demo hides later events; extending restores them. No native timing changes. Swing, gate, direction, root and scale need the live timing contract.</p><div class="dialog-actions"><button type="button" data-explain="timing">Timing mapping</button><button type="button" data-action="close">Cancel</button><button type="submit">Apply demo settings</button></div></form>`);
    $('#phrase-form').onsubmit=event=>{event.preventDefault();checkpoint();phrase.steps=Number($('#phrase-length').value);phrase.resolution=$('#phrase-resolution').value;phrase.timing=$('#phrase-timing').value;ui.step=Math.min(ui.step,phrase.steps-1);render();closeDialog();};
  });
}
function songSettings() {
  openDialog('Song settings',`<form id="song-form"><div class="form-row"><label for="song-name">Name</label><input id="song-name" maxlength="40" value="${h(model.name)}" required></div><div class="form-row"><label for="song-tempo">Tempo / BPM</label><input id="song-tempo" type="number" min="30" max="300" value="${model.tempo}" required></div><div class="form-row"><label for="song-tracks">Visible tracks</label><input id="song-tracks" type="number" min="1" max="16" value="${model.trackCount}" required></div><p class="dialog-note">Track count changes the view; hidden tracks remain in the fixture. Root / scale is C minor in this example. Song File owns snapshot operations.</p><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button type="submit">Apply demo settings</button></div></form>`);
  $('#song-form').onsubmit=event=>{event.preventDefault();checkpoint();model.name=$('#song-name').value.trim()||'UNTITLED';model.tempo=Number($('#song-tempo').value);model.trackCount=Number($('#song-tracks').value);ui.songTrack=Math.min(ui.songTrack,model.trackCount-1);ui.trackPage=Math.floor(ui.songTrack/8)*8;render();closeDialog();};
}
function trackOptions(index) {
  const track=model.tracks[index];
  openDialog(`Track ${two(index+1)} / ${track.name}`,`<p>Track identity is independent of MIDI channel. These switches mark this demo track only; live track mute/solo must operate on its events, not the entire instrument output.</p><div class="menu-list"><button data-track-toggle="muted" data-index="${index}">Mute track <span>${track.muted?'ON':'OFF'}</span></button><button data-track-toggle="solo" data-index="${index}">Solo track <span>${track.solo?'ON':'OFF'}</span></button><button data-explain="routing">MIDI / audio routing <span>Native ownership</span></button></div>`);
}
function renderInstruments() {
  const instrument=model.instruments[ui.instrument];
  setIdentity(`INSTRUMENT ${two(ui.instrument+1)}`,instrument.name,`FLUIDSYNTH · MIDI CH ${two(instrument.channel)} · EXAMPLE`);
  $('#workspace').innerHTML=`<div class="toolbar"><label for="instrument-picker">LOADED SOUND</label><select id="instrument-picker" class="instrument-picker">${model.instruments.map((item,i)=>option(i,`${two(i+1)} / ${item.name}`,ui.instrument)).join('')}</select><button class="push" data-explain="instruments">ADD SOUND / MAPPING</button></div><div class="split"><div class="processor-list"><span class="eyebrow">PATCH OVERVIEW</span><button class="setting-row engine" data-explain="instruments"><b>› ENGINE ◆ FLUIDSYNTH</b><span>Installed-engine selection ↗</span></button><button class="setting-row" data-action="preset"><b>BANK / FLUIDR3 GM</b><span>PRESET / ${h(instrument.preset)} ›</span></button><span class="eyebrow">POST FX · ILLUSTRATIVE ROUTE</span><button class="setting-row effect" data-explain="routing"><b>01 &nbsp; CALF REVERB</b><span>Parameters · bypass · order ›</span></button><button class="setting-row" data-explain="routing"><span>+ ADD PROCESSOR</span><span>Use native installed list ›</span></button><div class="route-line">MIDI CH ${two(instrument.channel)} &nbsp; › &nbsp; FLUIDSYNTH &nbsp; › &nbsp; CALF REVERB &nbsp; › &nbsp; MIXER<br><span class="muted">This is a Zynthian routing chain. It does not order phrases.</span></div></div><aside class="utility"><h3>UTILITY / INSTRUMENT ${two(ui.instrument+1)}</h3><button class="setting-row" data-explain="routing">MIDI INPUT<span>CH ${two(instrument.channel)}</span></button><button class="setting-row" data-view="mixer">OUTPUT LEVEL<span>${instrument.volume}%</span></button><button class="setting-row" data-explain="routing">AUDIO OUTPUT<span>Main stereo</span></button><button class="setting-row" data-explain="instruments">ENGINE CONTROLS<span>Native parameters ›</span></button><p style="margin-top:24px">Preset edits affect every track targeting this loaded sound. Notes choose a MIDI destination, not a preset.</p></aside></div>`;
  $('#instrument-picker').onchange=event=>{ui.instrument=Number(event.target.value);render();$('#instrument-picker').focus();};
}
function presetPicker() {
  const instrument=model.instruments[ui.instrument];
  openDialog('Bank / preset',`<span class="badge adapt">ILLUSTRATIVE CHOICES</span><p>INSTRUMENT ${two(ui.instrument+1)} / ${h(instrument.name)} · FluidSynth · FluidR3 GM. This changes the local label only. The live browser must request the engine’s actual presets and show all affected tracks.</p><form id="preset-form"><div class="form-row"><label for="preset-choice">Preset</label><select id="preset-choice">${presetNames.map(name=>option(name,name,instrument.preset)).join('')}</select></div><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button type="submit">Use in demo</button></div></form>`);
  $('#preset-form').onsubmit=event=>{event.preventDefault();checkpoint();instrument.preset=$('#preset-choice').value;render();closeDialog();};
}
function mixerStrip(instrument,index) {
  return `<div class="mixer-strip"><b>${two(index+1)}</b><small>${h(instrument.name)}</small><input class="fader" style="--fill:${instrument.volume/127*100}%" type="range" min="0" max="127" value="${instrument.volume}" data-volume="${index}" aria-label="${h(instrument.name)} volume"><output id="volume-${index}">${instrument.volume}%</output><small>CH ${two(instrument.channel)}</small><label class="sr-only" for="pan-${index}">${h(instrument.name)} pan</label><input class="pan" id="pan-${index}" data-pan="${index}" type="number" min="-100" max="100" value="${instrument.pan}"><div class="strip-buttons"><button data-mixer-toggle="muted" data-index="${index}" aria-pressed="${instrument.muted}" aria-label="Mute ${h(instrument.name)}">M</button><button data-mixer-toggle="solo" data-index="${index}" aria-pressed="${instrument.solo}" aria-label="Solo ${h(instrument.name)}">S</button></div></div>`;
}
function renderMixer() {
  setIdentity('MIXER','LOADED OUTPUTS','8 EXAMPLE CHAIN STRIPS · LOCAL VALUES');
  $('#workspace').innerHTML=`<div class="toolbar"><span>LEVEL / PAN / MUTE / SOLO</span><button class="push" data-explain="routing">ROUTING / SENDS</button></div><div class="split"><div class="mixer-strips">${model.instruments.map(mixerStrip).join('')}</div><aside class="utility"><h3 id="mixer-selection">01 / DRUMS</h3><div id="mixer-value" class="readout">${model.instruments[0].volume}%</div><p>No signal meters in this offline demo. Faders adjust example values only.</p><button class="setting-row" data-explain="mixer">TRACK ≠ MIXER STRIP<span>Mapping ›</span></button><button class="setting-row" data-explain="routing">SENDS<span>Native routes ›</span></button></aside></div>`;
}
function navigation() {
  const items=[['song','Song / Phrase','Resume arrangement'],['instruments','Instruments','Engine · bank · preset · controls'],['mixer','Mixer','Output levels · pan · mute · solo']];
  const destinations=[['routing','Routing / sends','Native processor chains'],['file','Song File / ZS3','Snapshots · performance states'],['recordings','Recordings','Audio · MIDI'],['chords','Chord Bank / FX','Proposed extension'],['devices','Settings / devices','MIDI · clock · system']];
  openDialog('Navigation',`<p>Closing this menu restores the previous editing position.</p><div class="menu-list">${items.map(([view,label,hint])=>`<button data-view="${view}">${label}<span>${hint} ›</span></button>`).join('')}<button data-action="song-settings">Song settings<span>Name · tempo · tracks ›</span></button>${destinations.map(([key,label,hint])=>`<button data-explain="${key}">${label}<span>${hint} ›</span></button>`).join('')}<button data-action="plan">Mapping plan<span>Decisions · gaps · implementation order ↗</span></button><button data-action="controls">Controls<span>Provisional input map ›</span></button></div>`);
}
function togglePlayback() {
  ui.playing=!ui.playing;clearInterval(previewTimer);
  $('#transport').textContent=ui.playing?'■ VISUAL STOP':'▷ VISUAL PLAY';
  $('#transport').setAttribute('aria-label',ui.playing?'Stop visual playback':'Start visual playback');
  if(ui.playing) previewTimer=setInterval(()=>{ui.playStep=(ui.playStep+1)%64;paintPlayhead();},180);
  paintPlayhead();announce(ui.playing?'Visual motion only. No audio or MIDI.':'Visual motion stopped.');
}
function paintPlayhead() {
  document.querySelectorAll('.playing').forEach(cell=>cell.classList.remove('playing'));
  if(!ui.playing) return;
  if(ui.view==='song') document.querySelectorAll(`[data-song-row="${Math.floor(ui.playStep/4)%12}"]`).forEach(cell=>cell.classList.add('playing'));
  if(ui.view==='phrase') document.querySelectorAll(`[data-play-row="${ui.playStep%activePhrase().steps}"],[data-piano-step="${ui.playStep%activePhrase().steps}"]`).forEach(cell=>cell.classList.add('playing'));
}
function back() {
  if($('#popover').open) {closeDialog();return;}
  if(ui.view!=='song') {setView('song');return;}
  navigation();
}
const actions={menu:navigation,home:navigation,play:togglePlayback,back,close:closeDialog,plan:showPlan,
  controls:()=>explain('controls'),file:()=>explain('file'),preset:presetPicker,'song-settings':songSettings,'phrase-settings':phraseSettings,
  undo:()=>moveHistory(history,future),redo:()=>moveHistory(future,history),'new-phrase':createPhrase,
  shared:()=>chooseScope(false),unique:()=>chooseScope(true),
  bank:()=>{ui.trackPage=ui.trackPage?0:8;ui.songTrack=ui.trackPage;render();focusCurrent();}
};
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button) return;
  const d=button.dataset;
  if(d.action) {actions[d.action]?.();return;}
  if(d.explain) {explain(d.explain);return;}
  if(d.view) {setView(d.view);return;}
  if(d.songRow!==undefined) {enterPhrase(Number(d.songRow),Number(d.songTrack));return;}
  if(d.editor) {ui.editor=d.editor;render();focusCurrent();return;}
  if(d.step!==undefined) {openNoteEditor(Number(d.step));return;}
  if(d.pianoStep!==undefined) {openNoteEditor(Number(d.pianoStep),d.pitch);return;}
  if(d.track!==undefined) {trackOptions(Number(d.track));return;}
  if(d.trackToggle) {checkpoint();const track=model.tracks[Number(d.index)];track[d.trackToggle]=!track[d.trackToggle];render();trackOptions(Number(d.index));return;}
  if(d.mixerToggle) {const instrument=model.instruments[Number(d.index)];instrument[d.mixerToggle]=!instrument[d.mixerToggle];button.setAttribute('aria-pressed',instrument[d.mixerToggle]);}
});
document.addEventListener('input',event=>{
  const d=event.target.dataset;
  if(d.volume!==undefined) {
    const index=Number(d.volume),value=Number(event.target.value);model.instruments[index].volume=value;
    event.target.style.setProperty('--fill',`${value/127*100}%`);
    $(`#volume-${index}`).textContent=value+'%';$('#mixer-value').textContent=value+'%';$('#mixer-selection').textContent=`${two(index+1)} / ${model.instruments[index].name}`;
  }
  if(d.pan!==undefined && event.target.validity.valid && event.target.value!=='') model.instruments[Number(d.pan)].pan=Number(event.target.value);
});
document.addEventListener('change',event=>{
  if(event.target.dataset.pan!==undefined) event.target.value=model.instruments[Number(event.target.dataset.pan)].pan;
});
document.addEventListener('focusin',event=>{
  const d=event.target.dataset;
  if(d.songRow!==undefined) {
    ui.songRow=Number(d.songRow);ui.songTrack=Number(d.songTrack);
    document.querySelectorAll('.song-cell.cursor').forEach(cell=>{cell.classList.remove('cursor');cell.tabIndex=-1;});
    event.target.classList.add('cursor');event.target.tabIndex=0;
    const id=model.song[ui.songRow][ui.songTrack];
    $('#selection-detail').textContent=id?`PHRASE ${two(id)} · ${model.phrases[id].steps} steps · ${phraseUses(id).length} references | SELECT opens notes`:'EMPTY SLOT · Select to assign a phrase';
  }
  if(d.step!==undefined) {
    ui.step=Number(d.step);
    document.querySelectorAll('.tracker-cell').forEach(cell=>{cell.classList.remove('cursor');cell.tabIndex=-1;});
    if(event.target.matches('.tracker-cell')) {event.target.classList.add('cursor');event.target.tabIndex=0;}
  }
});
$('#close-popover').onclick=closeDialog;
$('#popover').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});

// Spatial focus lets the reused input adapter drive real HTML controls, including dialogs.
function focusables() {
  const root=$('#popover').open?$('#popover'):$('#demo');
  return [...root.querySelectorAll('button,a[href],input,select')].filter(el=>!el.disabled && el.getClientRects().length);
}
function moveFocus(direction) {
  const active=document.activeElement;
  if(adjustField(active,direction)) return;
  const from=active.getBoundingClientRect(),vertical=direction==='up'||direction==='down',sign=direction==='up'||direction==='left'?-1:1;
  const score=el=>{
    const rect=el.getBoundingClientRect(),dx=(rect.left+rect.width/2)-(from.left+from.width/2),dy=(rect.top+rect.height/2)-(from.top+from.height/2);
    const forward=sign*(vertical?dy:dx),cross=Math.abs(vertical?dx:dy);
    return forward>2?forward+cross*4:Infinity;
  };
  const candidates=focusables().filter(el=>el!==active).map(el=>({el,score:score(el)})).filter(item=>Number.isFinite(item.score)).sort((a,b)=>a.score-b.score);
  candidates[0]?.el.focus();
}
function adjustField(active,direction) {
  if(direction!=='left' && direction!=='right') return false;
  const delta=direction==='right'?1:-1;
  if(active.matches('input[type=range],input[type=number]')) {
    delta>0?active.stepUp():active.stepDown();active.dispatchEvent(new Event('input',{bubbles:true}));return true;
  }
  if(active.matches('select')) {
    active.selectedIndex=Math.max(0,Math.min(active.options.length-1,active.selectedIndex+delta));active.dispatchEvent(new Event('change',{bubbles:true}));return true;
  }
  return false;
}
function previewInput(action) {
  if(!$('#popover').open && $('#plan').getBoundingClientRect().top<innerHeight/2) {
    if(action==='up'||action==='down') window.scrollBy(0,action==='up'?-90:90);
    else if(action==='play') window.scrollBy(0,innerHeight*.8);
    else if(action==='back'||action==='home'||action==='menu') {$('#demo').scrollIntoView();focusCurrent();}
    else if(action==='select' && document.activeElement.matches('a')) document.activeElement.click();
    return;
  }
  if(['up','down','left','right'].includes(action)) {moveFocus(action);return;}
  if(action==='select') {
    const active=document.activeElement;
    if(active.matches('select')) adjustField(active,'right');
    else if(active.matches('input')) {const fields=focusables();fields[(fields.indexOf(active)+1)%fields.length]?.focus();}
    else active.click();
    return;
  }
  if(action==='back') {back();return;}
  if(action==='focus') {const fields=focusables();fields[(fields.indexOf(document.activeElement)+1)%fields.length]?.focus();return;}
  if($('#popover').open) return;
  if(action==='play') togglePlayback();
  else if(action==='mixer') setView('mixer');
  else if(action==='launcher') setView('song');
  else if(action==='snapshots') explain('file');
  else if(action==='bold') explain(ui.view);
  else if(action==='home'||action==='menu') navigation();
}
render();
installInput({view:{kind:'tracker-plan'},input:previewInput,inputStatus:'',notify(){ $('#input-status').textContent=this.inputStatus; }});
