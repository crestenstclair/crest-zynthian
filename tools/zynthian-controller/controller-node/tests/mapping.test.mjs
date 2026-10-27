import test from 'node:test';
import assert from 'node:assert/strict';
import {newBundle,parseBundle,emptyAssignment,setAssignment,summarize} from '../../control-map/bundle.mjs';

const catalog={version:1,repository:'crestenstclair/crest-zynthian',controls:[{id:'pad:a'},{id:'pad:b'}],contexts:[{id:'global'},{id:'launcher'}]};
test('control worksheet preserves freeform decisions, custom inputs and screen exceptions',()=>{
  const bundle=newBundle(catalog);
  bundle.customControls.push({id:'custom-control:one',label:'L4 + A'});
  bundle.customContexts.push({id:'custom-context:one',label:'Piano roll · selection mode'});
  setAssignment(bundle,{...emptyAssignment('global','pad:a'),decision:'change',press:'Select only.\nNever start playback.',modifiers:'LB + A: audition ♭ notes'});
  setAssignment(bundle,{...emptyAssignment('launcher','pad:a'),decision:'disable'});
  setAssignment(bundle,{...emptyAssignment('custom-context:one','custom-control:one'),hold:'<script>Freeform text only</script>',decision:'change'});
  bundle.contextNotes.launcher='B returns focus without stopping music.';
  const restored=parseBundle(JSON.stringify(bundle),catalog);
  assert.deepEqual(restored,bundle);
  assert.deepEqual(summarize(restored),{decisions:3,contexts:3,incomplete:0});
});
test('control worksheet rejects incompatible or ambiguous bundles without mutating drafts',()=>{
  const original=newBundle(catalog), json=JSON.stringify(original);
  for(const mutate of [
    bundle=>bundle.schemaVersion=2,
    bundle=>bundle.extra='Unknown future field',
    bundle=>bundle.assignments.push({...emptyAssignment('global','missing'),decision:'change'}),
    bundle=>bundle.assignments.push(emptyAssignment('global','pad:a'),emptyAssignment('global','pad:a')),
    bundle=>bundle.reference.controls.push({id:'pad:other'}),
    bundle=>bundle.customControls.push({id:'pad:a',label:'Duplicate'})
  ]) {
    const changed=JSON.parse(json);mutate(changed);
    assert.throws(()=>parseBundle(JSON.stringify(changed),catalog));
    assert.equal(JSON.stringify(original),json);
  }
});
test('control worksheet distinguishes inheritance, disabling and unfinished changes',()=>{
  const bundle=newBundle(catalog);
  setAssignment(bundle,{...emptyAssignment('global','pad:a'),decision:'disable'});
  setAssignment(bundle,{...emptyAssignment('launcher','pad:b'),decision:'change'});
  assert.equal(summarize(bundle).incomplete,1);
  setAssignment(bundle,emptyAssignment('global','pad:a'));
  assert.equal(bundle.assignments.length,1);
  setAssignment(bundle,{...emptyAssignment('launcher','pad:b'),notes:'Keep this in sync with the menu.'});
  assert.equal(summarize(bundle).incomplete,0);
  assert.equal(bundle.assignments[0].decision,'inherit');
});
