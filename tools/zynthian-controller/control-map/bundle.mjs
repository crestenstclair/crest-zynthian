// SPDX-License-Identifier: GPL-2.0-or-later
export const FORMAT = 'crest-zynthian-control-map';
export const MAX_BYTES = 2 * 1024 * 1024;
export const BEHAVIOR_FIELDS = ['press','hold','doublePress','modifiers','repeat','notes'];

export function newBundle(catalog, now=new Date().toISOString()) {
  return {format:FORMAT,schemaVersion:1,title:'My Zynthian controls',device:'',brief:'',createdAt:now,updatedAt:now,
    reference:structuredClone(catalog),customControls:[],customContexts:[],contextNotes:{},assignments:[]};
}
function object(value, name) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error(`${name} must be an object.`);
  return value;
}
function text(value, name, maximum=10000) {
  if (typeof value!=='string' || value.length>maximum) throw Error(`${name} must be text (${maximum} characters maximum).`);
  return value;
}
function array(value, name, maximum) {
  if (!Array.isArray(value) || value.length>maximum) throw Error(`${name} must be a list (${maximum} entries maximum).`);
  return value;
}
function knownFields(value, names, name) {
  object(value,name);
  const unknown = Object.keys(value).find(key=>!names.includes(key));
  if (unknown) throw Error(`Unknown ${name} field: ${unknown}. This file may need a newer editor.`);
}
function uniqueIds(entries, name) {
  const ids = entries.map(entry=>text(entry.id,`${name} ID`,120));
  if (new Set(ids).size!==ids.length) throw Error(`Duplicate ${name} IDs.`);
  return new Set(ids);
}
function customEntries(entries, kind) {
  array(entries,`Custom ${kind}`,50);
  const result = entries.map(entry=>{
    knownFields(entry,['id','label'],`custom ${kind}`);
    if (!new RegExp(`^custom-${kind}:[a-zA-Z0-9-]+$`).test(entry.id)) throw Error(`Invalid custom ${kind} ID.`);
    return {id:entry.id,label:text(entry.label,`Custom ${kind} name`,160)};
  });
  uniqueIds(result,`custom ${kind}`);
  return result;
}
function checkReference(reference, catalog) {
  object(reference,'Reference');
  if (reference.version!==catalog.version || reference.repository!==catalog.repository) throw Error('This bundle uses a different control catalog.');
  for (const kind of ['controls','contexts']) {
    const actual = uniqueIds(array(reference[kind],kind,200),kind);
    if (actual.size!==catalog[kind].length || catalog[kind].some(entry=>!actual.has(entry.id))) {
      throw Error(`The bundle has different ${kind}. Keep the file and use its matching editor.`);
    }
  }
}
function parseAssignment(entry, controls, contexts) {
  knownFields(entry,['control','context','decision',...BEHAVIOR_FIELDS],'assignment');
  if (!controls.has(entry.control) || !contexts.has(entry.context)) throw Error('An assignment names an unknown control or screen.');
  if (!['inherit','change','disable'].includes(entry.decision)) throw Error('Unknown assignment decision.');
  const result = {control:entry.control,context:entry.context,decision:entry.decision};
  for (const field of BEHAVIOR_FIELDS) result[field]=text(entry[field],field);
  return result;
}

/** Validate imports atomically; reject unknown decisions instead of silently losing them. */
export function parseBundle(raw, catalog) {
  if (typeof raw!=='string' || new TextEncoder().encode(raw).length>MAX_BYTES) throw Error('JSON bundle exceeds 2 MB.');
  const value = JSON.parse(raw);
  knownFields(value,['format','schemaVersion','title','device','brief','createdAt','updatedAt','reference',
    'customControls','customContexts','contextNotes','assignments'],'bundle');
  if (value.format!==FORMAT || value.schemaVersion!==1) throw Error('Choose a Zynthian control-map JSON bundle, version 1.');
  checkReference(value.reference,catalog);
  const customControls=customEntries(value.customControls,'control');
  const customContexts=customEntries(value.customContexts,'context');
  const controls=uniqueIds([...catalog.controls,...customControls],'control');
  const contexts=uniqueIds([...catalog.contexts,...customContexts],'context');
  const assignments=array(value.assignments,'Assignments',12000).map(entry=>parseAssignment(entry,controls,contexts));
  const keys=assignments.map(entry=>`${entry.context}/${entry.control}`);
  if (new Set(keys).size!==keys.length) throw Error('Duplicate assignment for the same control and screen.');
  object(value.contextNotes,'Screen notes');
  for (const [context,note] of Object.entries(value.contextNotes)) {
    if (!contexts.has(context)) throw Error('Notes name an unknown screen.');
    text(note,'Screen notes',20000);
  }
  return {format:FORMAT,schemaVersion:1,title:text(value.title,'Title',160),device:text(value.device,'Device',160),
    brief:text(value.brief,'Brief',20000),createdAt:text(value.createdAt,'Creation time',60),updatedAt:text(value.updatedAt,'Update time',60),
    reference:structuredClone(value.reference),customControls,customContexts,
    contextNotes:{...value.contextNotes},assignments};
}

export function emptyAssignment(context, control) {
  return {context,control,decision:'inherit',...Object.fromEntries(BEHAVIOR_FIELDS.map(field=>[field,'']))};
}
export function hasDecision(entry) {
  return entry.decision!=='inherit' || BEHAVIOR_FIELDS.some(field=>entry[field].trim());
}
export function setAssignment(bundle, entry) {
  const index=bundle.assignments.findIndex(item=>item.context===entry.context && item.control===entry.control);
  if (index>=0) bundle.assignments.splice(index,1);
  if (hasDecision(entry)) bundle.assignments.push(entry);
}
export function summarize(bundle) {
  const changes=bundle.assignments.filter(entry=>entry.decision==='change');
  return {decisions:bundle.assignments.length,
    contexts:new Set([...bundle.assignments.map(entry=>entry.context),...Object.keys(bundle.contextNotes)]).size,
    incomplete:changes.filter(entry=>!BEHAVIOR_FIELDS.slice(0,-1).some(field=>entry[field].trim())).length};
}
