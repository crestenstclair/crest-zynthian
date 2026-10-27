// SPDX-License-Identifier: GPL-2.0-or-later
// Bundled after bundle.mjs and the generated catalog; all user content is text.
const STORAGE_KEY = 'crest-zynthian-control-workbook-v1';
const el = id => document.getElementById(id);
const fieldLabels = {press:'Press / primary gesture',hold:'Hold / long press',doublePress:'Double press',
  modifiers:'Modifiers / combinations',repeat:'Repeat / sensitivity / feel',notes:'Notes / edge cases'};
let bundle = newBundle(catalog);
let context = 'global';
let pendingReplacement = null;
let storageBlocked = false;
let recoveryText = '';
let dirty = false;

function element(tag, className, textContent) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (textContent !== undefined) item.textContent = textContent;
  return item;
}
function message(text, error=false) {
  el('notice').textContent = text;
  el('notice').classList.toggle('error',error);
  el('notice').setAttribute('role',error?'alert':'status');
}
function controls() {
  return [...catalog.controls,...bundle.customControls.map(control=>({...control,device:'custom',group:'Custom',
    current:'Custom input / combination',shifted:'',availability:'Describe how this input should be recognized.'}))];
}
function contexts() { return [...catalog.contexts,...bundle.customContexts]; }
function assignment(controlId, contextId=context) {
  return bundle.assignments.find(entry=>entry.context===contextId && entry.control===controlId) || emptyAssignment(contextId,controlId);
}
function contextLabel(id) { return contexts().find(item=>item.id===id)?.label || id; }
function saveDraft() {
  bundle.updatedAt = new Date().toISOString();
  dirty = true;
  updateProgress();
  if (storageBlocked) return;
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify(bundle));
    el('save-status').textContent = 'Draft saved in this browser. Download JSON to keep a portable copy.';
  } catch {
    storageBlocked = true;
    el('save-status').textContent = 'Browser storage unavailable. Edits remain in this tab; save JSON before closing.';
    message('Automatic draft saving is unavailable here. Use Save JSON bundle to keep your work.',true);
  }
}
function updateProgress() {
  const summary = summarize(bundle);
  el('progress').textContent = `${summary.decisions} decisions · ${summary.contexts} scopes`;
  const count = bundle.assignments.filter(entry=>entry.context===context).length;
  el('context-count').textContent = `${count} decisions here`;
  for (const button of el('contexts').querySelectorAll('button')) {
    const total = bundle.assignments.filter(entry=>entry.context===button.dataset.id).length;
    const badge = button.querySelector('.badge');
    badge.textContent = total;
    badge.hidden = total===0;
  }
}
function renderContexts() {
  const query = el('screen-search').value.toLowerCase();
  const host = el('contexts');host.replaceChildren();
  for (const item of contexts()) {
    if (!`${item.label} ${item.id}`.toLowerCase().includes(query)) continue;
    const button = element('button','',item.label);
    button.dataset.id = item.id;
    button.setAttribute('aria-current',String(item.id===context));
    button.append(element('span','badge'));
    button.onclick = () => selectContext(item.id);
    host.append(button);
  }
  updateProgress();
}
function selectContext(id) {
  context = id;
  el('context-kind').textContent = id==='global' ? 'GLOBAL DEFAULTS' : 'SCREEN / MODE OVERRIDES';
  el('context-title').textContent = contextLabel(id);
  el('context-description').textContent = id==='global' ?
    'Start here. These decisions apply everywhere unless you add an exception on a screen.' :
    'Only describe exceptions here. Unchanged controls inherit your default decisions. Current behavior depends on the selected item and editor mode.';
  el('context-notes').value = bundle.contextNotes[id] || '';
  renderContexts();renderControls();
}
function decisionSelect(entry, onChange) {
  const select = document.createElement('select');
  select.setAttribute('aria-label',`Decision for ${entry.control}`);
  const choices = [['inherit',context==='global'?'Keep current behavior':'Use default behavior'],['change','Change behavior'],['disable','Disable this control']];
  for (const [value,label] of choices) {
    const option = element('option','',label);option.value=value;select.append(option);
  }
  select.value = entry.decision;
  select.onchange = () => onChange(select.value);
  return select;
}
function behaviorField(field, entry, control, onInput) {
  const label = element('label',field==='press'?'input-label':'',fieldLabels[field]);
  const input = document.createElement('textarea');
  input.value = entry[field];input.rows = 2;input.maxLength = 10000;
  input.dataset.field = field;input.setAttribute('aria-label',`${control.label} — ${fieldLabels[field]}`);
  input.className = field==='press'?'behavior':'';
  input.placeholder = field==='press'?'What should happen? Describe the action in your own words.':
    field==='modifiers'?'e.g. Hold LB + this control to…':field==='notes'?'Special cases, questions, examples…':'Describe if needed…';
  input.addEventListener('input',()=>onInput(field,input.value));
  if (field==='press') {label.htmlFor=`press-${control.id}`;input.id=label.htmlFor;return [label,input];}
  label.append(input);return [label];
}
function referenceColumn(control) {
  const column = element('div','reference');
  column.append(element('div','group',control.group),element('h3','',control.label),
    element('p','current',`Current: ${control.current}`));
  if (control.device==='gamepad' && control.shifted && control.shifted!==control.current) column.append(element('p','current',`With LB: ${control.shifted}`));
  column.append(element('p','availability',control.availability));
  if (context!=='global') {
    const inherited = assignment(control.id,'global');
    if (inherited.decision==='disable') column.append(element('p','inherited','Your default: disabled'));
    if (inherited.decision==='change') column.append(element('p','inherited',`Your default: ${inherited.press || inherited.hold || inherited.modifiers || 'See default details'}`));
  }
  return column;
}
function controlCard(control) {
  const card = element('article','control-card');card.dataset.control=control.id;
  const entry = {...assignment(control.id)};
  const editor = element('div','behavior-fields');
  const decisionRow = element('div','decision');
  const disabled = element('p','disabled-note','No action in this scope. Existing descriptions are retained as notes.');
  const select = decisionSelect(entry,value=>{entry.decision=value;changed();});
  function changed() {
    setAssignment(bundle,entry);card.classList.toggle('changed',hasDecision(entry));
    disabled.hidden=entry.decision!=='disable';saveDraft();
  }
  function edit(field,value) {
    entry[field]=value;
    if (field!=='notes' && value.trim() && entry.decision==='inherit') {entry.decision='change';select.value='change';}
    changed();
  }
  decisionRow.append(select);
  editor.append(decisionRow,...behaviorField('press',entry,control,edit));
  const advanced = element('details','advanced');advanced.append(element('summary','','Hold, double press, modifiers & notes'));
  const fields = element('div','advanced-fields');
  for (const field of BEHAVIOR_FIELDS.slice(1)) fields.append(...behaviorField(field,entry,control,edit));
  advanced.append(fields);editor.append(disabled,advanced);
  card.classList.toggle('changed',hasDecision(entry));disabled.hidden=entry.decision!=='disable';
  card.append(referenceColumn(control),editor);return card;
}
function renderControls() {
  const device = el('device-filter').value, query = el('control-search').value.toLowerCase();
  const host = el('controls');host.replaceChildren();
  const matches = controls().filter(control=>(device==='all'||control.device===device) &&
    `${control.label} ${control.group}`.toLowerCase().includes(query) && (!el('edited-only').checked || hasDecision(assignment(control.id))));
  for (const control of matches) host.append(controlCard(control));
  el('empty').hidden = matches.length>0;
}
function renderProject() {
  for (const field of ['title','device','brief']) el(field).value = bundle[field];
  selectContext('global');
}
function download(text, filename) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportBundle() {
  try {
    const validated = parseBundle(JSON.stringify(bundle),catalog);
    const name = validated.title.trim().replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,70) || 'zynthian-controls';
    download(JSON.stringify(validated,null,2)+'\n',`${name}.json`);
    message('JSON download requested. Keep this file and give it back to Codex when you are ready.');
  } catch(error) {message(error.message,true);}
}
function requestReplacement(next, description) {
  pendingReplacement = next;
  el('replace-description').textContent = description;
  el('replace-dialog').showModal();
}
function replaceDraft() {
  if (!pendingReplacement) return;
  bundle=pendingReplacement;pendingReplacement=null;storageBlocked=false;recoveryText='';
  el('replace-dialog').close();el('edited-only').checked=false;el('control-search').value='';el('screen-search').value='';
  renderProject();saveDraft();message('Draft loaded. Your imported descriptions are ready to edit.');
}
async function importBundle(file) {
  if (!file) return;
  try {
    if (file.size>MAX_BYTES) throw Error('JSON bundle exceeds 2 MB.');
    const next = parseBundle(await file.text(),catalog);
    requestReplacement(next,`Load “${next.title}” with ${next.assignments.length} decisions? Your current draft will be replaced.`);
  } catch(error) {message(`Import failed: ${error.message} Your current draft was kept.`,true);}
  finally {el('file').value='';}
}
function addCustom(form, kind) {
  const label = new FormData(form).get('label').trim();
  if (!label) return;
  const item = {id:`custom-${kind}:${crypto.randomUUID()}`,label};
  const list = kind==='context'?bundle.customContexts:bundle.customControls;
  if (list.length>=50) {message('This bundle already has 50 custom entries of this type.',true);return;}
  list.push(item);form.reset();saveDraft();
  if (kind==='context') {el('screen-search').value='';selectContext(item.id);}
  else {el('device-filter').value='custom';el('control-search').value='';el('edited-only').checked=false;renderControls();}
}
function reviewAssignment(entry) {
  const control = controls().find(item=>item.id===entry.control);
  const section = element('section','review-entry');
  section.append(element('h3','',`${contextLabel(entry.context)} · ${control.label}`));
  section.append(element('p','',entry.decision==='disable'?'Disabled':entry.decision==='change'?'Change behavior':'Inherit behavior; notes only'));
  for (const field of BEHAVIOR_FIELDS) if (entry[field]) section.append(element('p','',`${fieldLabels[field]}: ${entry[field]}`));
  const button=element('button','','Edit this decision');
  button.onclick=()=>{
    el('review-dialog').close();el('device-filter').value='all';el('edited-only').checked=false;
    el('control-search').value=control.label;selectContext(entry.context);el('controls').querySelector('textarea')?.focus();
  };
  section.append(button);return section;
}
function review() {
  const host=el('review-content');host.replaceChildren();
  const stats=summarize(bundle);
  host.append(element('p','',`${stats.decisions} control decisions across ${stats.contexts} scopes. All are included in the JSON.`));
  if (stats.incomplete) host.append(element('p','warning',`${stats.incomplete} changes still need a behavior description. You can save unfinished work.`));
  if (bundle.brief) host.append(element('p','screen-note',`Layout brief: ${bundle.brief}`));
  for (const [id,note] of Object.entries(bundle.contextNotes)) host.append(element('p','screen-note',`${contextLabel(id)} — ${note}`));
  for (const entry of bundle.assignments) host.append(reviewAssignment(entry));
  el('review-dialog').showModal();
}
function restoreDraft() {
  try {
    recoveryText=localStorage.getItem(STORAGE_KEY) || '';
    if (recoveryText) {
      bundle=parseBundle(recoveryText,catalog);recoveryText='';
      el('save-status').textContent='Previous local draft restored. Download JSON for a portable copy.';
      message('Your previous draft has been restored.');
    }
  } catch(error) {
    storageBlocked=true;
    message(`Stored draft could not be loaded: ${error.message} It has been left untouched.`,true);
    el('save-status').textContent='Local draft storage paused. Save JSON for this session; starting a new bundle offers recovery of the stored file.';
  }
}

for (const field of ['title','device','brief']) el(field).addEventListener('input',()=>{bundle[field]=el(field).value;saveDraft();});
el('context-notes').oninput=()=>{
  const value=el('context-notes').value;
  if (value) bundle.contextNotes[context]=value;else delete bundle.contextNotes[context];saveDraft();
};
el('screen-search').oninput=renderContexts;
el('control-search').oninput=renderControls;
el('device-filter').onchange=renderControls;
el('edited-only').onchange=renderControls;
el('save').onclick=exportBundle;
el('load').onclick=()=>el('file').click();
el('file').onchange=()=>importBundle(el('file').files[0]);
el('review').onclick=review;
el('close-review').onclick=()=>el('review-dialog').close();
el('reset').onclick=()=>requestReplacement(newBundle(catalog),'Start a blank workbook? This replaces the current local draft; downloaded JSON files are kept.');
el('backup').onclick=()=>recoveryText ? download(recoveryText,'zynthian-stored-draft-recovery.json') : exportBundle();
el('cancel-replace').onclick=()=>{pendingReplacement=null;el('replace-dialog').close();};
el('confirm-replace').onclick=replaceDraft;
el('new-control').onsubmit=event=>{event.preventDefault();addCustom(event.currentTarget,'control');};
el('new-context').onsubmit=event=>{event.preventDefault();addCustom(event.currentTarget,'context');};
window.addEventListener('beforeunload',event=>{if (dirty && storageBlocked) {event.preventDefault();event.returnValue='';}});
restoreDraft();renderProject();
