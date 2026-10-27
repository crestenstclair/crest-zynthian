import test from 'node:test';
import assert from 'node:assert/strict';
import {ControllerModel} from '../web/model.mjs';
import {gamepadActions,InputGestures} from '../web/input.mjs';

const state = (extra = {}) => ({protocol:1, revision:'r1', screen:'preset', kind:'list', columns:1,
  items:[{id:'a',label:'A',enabled:true},{id:'b',label:'B',enabled:true}], ...extra});

test('options target is atomic, commands are gated until acknowledgement, never replayed', () => {
  const commands = [], model = new ControllerModel(command => commands.push(command));
  model.receiveState(state()); model.activate('b', true); model.choose('a');
  assert.equal(commands.length,1); assert.equal(commands[0].target,'b'); assert.equal(commands[0].bold,true);
  model.receive({id:1,ok:true,state:state({revision:'r2'})});
  model.choose('a'); assert.equal(commands[1].revision,'r2');
  model.disconnect(); model.receiveState(state()); assert.equal(commands.length,2);
  model.disconnect();
});

test('new confirmation defaults to Cancel, not previously selected destructive choice', () => {
  const model = new ControllerModel(()=>{});
  model.receiveState(state({screen:'confirm',kind:'confirm'})); model.move(1);
  model.receiveState(state({screen:'confirm',kind:'confirm',revision:'r2'}));
  assert.equal(model.selected,0); model.disconnect();
});

test('backend busy blocks mutations; inline editor and sequencer menu preserve focus', () => {
  const commands=[], model=new ControllerModel(c=>commands.push(c));
  model.receiveState(state({backendBusy:true})); model.choose('a'); assert.equal(commands.length,0);
  model.receiveState(state({screen:'pattern_editor',kind:'sequencer',sequenceActions:['select','play']}));
  model.input('menu'); assert.equal(model.canvasFocus,false);
  model.input('back'); assert.equal(model.canvasFocus,true);
  model.input('play'); assert.equal(commands[0].method,'sequence'); model.disconnect();
});

test('browser gamepad shares navigation and editor intents', () => {
  const pad={buttons:Array.from({length:16},()=>({pressed:false})),axes:[0,0,0,0]};
  pad.buttons[4].pressed=true;pad.buttons[2].pressed=true;pad.axes[2]=1;
  const result=gamepadActions(pad);
  assert.equal(result.fine,false);assert.deepEqual([...result.actions],['menu','shift','lengthMore']);
});

test('fresh state clears a connection error without replaying the last action', () => {
  const commands=[], model=new ControllerModel(command=>commands.push(command));
  model.receiveState(state());model.choose('a');
  model.disconnect('Connection lost');model.receiveState(state());
  assert.equal(model.connected,true);assert.equal(model.error,'');
  assert.equal(model.pending,0);assert.equal(commands.length,1);
  model.error='Action failed';model.receiveState(state());
  assert.equal(model.error,'Action failed');model.disconnect();
});

test('screen menus target browser focus; native selection follows only when requested', () => {
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  model.receiveState(state({selectedTarget:'b',screenActions:{screenMenu:'Screen options'}}));
  assert.equal(model.selected,1);
  model.move(-1);
  model.receiveState(state({selectedTarget:'b',screenActions:{screenMenu:'Screen options'}}));
  assert.equal(model.selected,0);
  model.input('screenMenu');
  assert.equal(commands[0].target,'a');
  model.receive({id:1,ok:true,state:state({selectedTarget:'b',selectionFollowsBackend:true})});
  assert.equal(model.selected,1);
  model.disconnect();
});

test('quick jump routes once; top-level menu and errors remain reachable', () => {
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  model.receiveState(state({navigation:{chainManager:'Chains',admin:'Admin'}}));
  model.input('navigation');model.input('down');model.input('select');
  assert.equal(model.navigationOpen,false);
  assert.equal(commands[0].action,'chainManager');
  model.input('navigation');model.input('select');
  assert.equal(commands.length,1);
  model.receive({id:commands[0].id,ok:false,error:'Native action unavailable'});
  assert.equal(model.error,'Native action unavailable');
  model.input('navigation');model.input('back');
  assert.equal(model.navigationOpen,false);
  model.input('home');assert.equal(model.homeOpen,true);model.disconnect();
  assert.equal(model.navigationOpen,false);
});

test('instrument navigation skips hidden routing; mixer pointer selection exposes its controls', () => {
  const model=new ControllerModel(()=>{});
  model.receiveState(state({screen:'chain_manager',instruments:[],items:[
    {id:'instrument:4',enabled:true},{id:'instrument:9',enabled:true},{id:'node:0',enabled:true}]}));
  model.input('down');model.input('down');
  assert.equal(model.view.items[model.selected].id,'instrument:9');
  model.toggleRouting();
  assert.equal(model.view.items[model.selected].id,'node:0');
  model.receiveState(state({screen:'mixer',mixer:[{id:4},{id:9}],items:[
    {id:'mix:4:level',enabled:true},{id:'mix:4:gain',enabled:true},
    {id:'mix:9:mute',enabled:true},{id:'mix:9:gain',enabled:true}]}));
  model.choose('mix:9:mute');
  assert.equal(model.mixerChain,'9');
  const visible=JSON.parse(model.state).items.filter(item=>item.visible).map(item=>item.id);
  assert.deepEqual(visible,['mix:4:level','mix:9:mute','mix:9:gain']);
  model.disconnect();
});

test('Song opens selected native pad; tracker axes change only cursor navigation', () => {
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  model.receiveState(state({kind:'sequencer',sequence:{type:'launcher',selected:[2,9]},sequenceActions:['open','select']}));
  model.input('select');
  assert.deepEqual([commands[0].action,commands[0].first,commands[0].second],['open',2,9]);
  const pattern=state({screen:'pattern_editor',kind:'sequencer',sequence:{type:'notes',editMode:0,selected:[0,60],steps:[0,1],stepCount:16,events:[]},sequenceActions:['up','down','left','right']});
  model.receive({id:commands[0].id,ok:true,state:pattern});model.setEditor('tracker');model.input('down');
  assert.equal(commands.length,1);assert.equal(model.sequenceView().selected[0],1);
  model.receiveState({...pattern,sequence:{type:'notes',editMode:2}});model.input('down');
  assert.equal(commands[1].action,'down');
  model.disconnect();
});

test('held Cross edits small/large without selection; Circle directions navigate without a trailing back',()=>{
  const actions=[],gestures=new InputGestures(action=>actions.push(action));
  const sample=(keys,time=0)=>gestures.update(new Set(keys),time);
  sample(['select']);assert.deepEqual(actions,[]);
  sample(['select','right']);sample(['select','right'],400);
  sample(['select']);sample(['select','up']);sample([]);
  assert.deepEqual(actions,['adjustSmallMore','adjustSmallMore','adjustLargeMore']);
  sample(['circle']);sample(['circle','left']);sample([]);
  sample(['circle']);sample(['circle','up']);sample([]);
  assert.deepEqual(actions.slice(-2),['parent','details']);
  sample(['select']);sample([]);assert.equal(actions.at(-1),'select');
  sample(['circle']);sample([]);assert.equal(actions.at(-1),'back');
  const count=actions.length;sample(['select']);gestures.reset();sample([]);assert.equal(actions.length,count);
  sample(['shift','left'],500);sample(['shift','left'],900);
  assert.deepEqual(actions.slice(-2),['parent','parent']);
  sample([]);sample(['shift','up'],1000);sample(['shift','up'],1400);
  assert.equal(actions.filter(action=>action==='details').length,2); // Details do not repeat/toggle while held.
});

test('phrase fields focus separately from native notes and detail return is explicit',()=>{
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  model.receiveState(state({screen:'pattern_editor',kind:'sequencer',sequence:{type:'notes',editMode:0,selected:[0,60],steps:[0,1],stepCount:16,events:[{step:0,row:60,duration:2}]},sequenceActions:['left','right','select']}));
  model.input('select');assert.equal(commands.length,0);
  model.input('right');assert.equal(model.trackerField,1);assert.equal(commands.length,0);
  model.input('adjustLargeMore');assert.equal(commands[0].field,'velocity');assert.equal(commands[0].large,true);
  model.receive({id:commands[0].id,ok:true});model.input('details');assert.equal(commands[1].action,'details');
  model.receive({id:commands[1].id,ok:true,state:state({screen:'option',detailWorkspace:'pattern_editor'})});
  model.input('workspace');assert.equal(commands[2].action,'workspace');
  model.canvasFocus=false;
  model.receive({id:commands[2].id,ok:true,state:state({screen:'pattern_editor',kind:'sequencer',detailWorkspace:null})});
  assert.equal(model.canvasFocus,true);
  model.input('navigation');model.input('parent');assert.equal(model.navigationOpen,false);
  model.disconnect();
});

test('tracker traverses sustain rows locally and Select inserts at the chosen row',()=>{
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  const pattern=state({screen:'pattern_editor',kind:'sequencer',sequence:{type:'notes',editMode:0,pattern:1,selected:[0,60],steps:[0,1,2],stepCount:16,events:[{step:0,row:60,duration:2}]},sequenceActions:['down','up','select','insert']});
  model.receiveState(pattern);model.input('down');
  model.receiveState(pattern); // A backend poll must not steal local focus.
  assert.deepEqual(JSON.parse(model.state).sequence.selected,[1,60]);
  model.input('select');assert.deepEqual([commands[0].action,commands[0].first,commands[0].tracker],['insert',1,true]);
  model.input('down');assert.equal(commands.length,1);
  assert.deepEqual(JSON.parse(model.state).sequence.selected,[2,60]);
  model.input('up');assert.equal(model.sequenceView().selected[0],1);model.disconnect();
});

test('engine categories open child lists and Back returns locally to categories',()=>{
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  const engine=state({screen:'engine',items:[{id:'category:0',enabled:true},{id:'category:1',enabled:true},
    {id:'control:0',enabled:true},{id:'list:0',enabled:true}]});
  model.receiveState(engine);model.input('down');model.input('select');
  assert.equal(commands[0].target,'category:1');
  model.receive({id:commands[0].id,ok:true,state:engine});
  assert.equal(model.engineCategory,'category:1');assert.equal(model.view.items[model.selected].id,'list:0');
  assert.deepEqual(JSON.parse(model.state).items.filter(item=>item.visible).map(item=>item.id),['list:0']);
  model.input('parent');assert.equal(model.engineCategory,null);assert.equal(commands.length,1);
  assert.equal(model.view.items[model.selected].id,'category:1');model.disconnect();
});

test('cursor stays immediate during a delayed edit; write targets never follow later cursor movement',()=>{
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  const pattern=state({screen:'pattern_editor',kind:'sequencer',sequence:{type:'notes',editMode:0,pattern:1,selected:[0,60],steps:[0,1],stepCount:64,events:[{step:0,row:60,duration:2}]},sequenceActions:['down','up','left','right','select','insert']});
  model.receiveState(pattern);model.input('adjustSmallMore');
  for(let i=0;i<40;i++) model.input('down');
  assert.equal(model.sequenceView().selected[0],40);
  assert.equal(commands.length,1);assert.deepEqual([commands[0].first,commands[0].second],[0,60]);
  model.receive({id:commands[0].id,ok:true,state:{...pattern,sequence:{...pattern.sequence,selected:[0,61]}}});
  assert.equal(model.sequenceView().selected[0],40);
  model.input('select');assert.deepEqual([commands[1].action,commands[1].first],['insert',40]);
  model.disconnect();
});

test('Circle never plays: hold, modifier overlap, and simultaneous transport remain consumed',()=>{
  const actions=[],gestures=new InputGestures(action=>actions.push(action));
  gestures.update(new Set(['circle']),0);gestures.update(new Set(['circle']),500);gestures.update(new Set(),510);
  assert.deepEqual(actions,[]);
  gestures.update(new Set(['circle','select','play']),600);gestures.update(new Set(),650);
  assert.deepEqual(actions,[]);
  gestures.update(new Set(['circle','play']),660);gestures.update(new Set(['play']),680);gestures.update(new Set(),690);
  assert.equal(actions.includes('play'),false);
  gestures.update(new Set(['circle','left']),700);gestures.update(new Set(),720);
  assert.deepEqual(actions,['parent']);
});

test('local piano pages project native events; CC and moving clips retain native cell actions',()=>{
  const commands=[],model=new ControllerModel(command=>commands.push(command));
  const keys=Array.from({length:128},(_,id)=>({id,note:id,label:String(id)}));
  const event={step:14,row:70,offset:0,duration:4,velocity:96};
  const pattern=state({screen:'pattern_editor',kind:'sequencer',sequence:{type:'notes',editMode:0,
    pattern:1,selected:[0,60],steps:[0,1],stepCount:64,keys,events:[event]},sequenceActions:['right','up']});
  model.receiveState(pattern);model.setEditor('piano');model.sequence('cell',17,70);
  const projected=model.sequenceView();
  assert.equal(commands.length,0);
  assert.deepEqual(projected.selected,[17,70]);assert.equal(projected.steps[0],16);
  assert.ok(projected.rows.some(row=>row.id===70));assert.deepEqual(projected.cells,[{...event,start:14}]);
  model.input('up');model.input('up');
  assert.ok(model.sequenceView().rows.some(row=>row.id===72));
  assert.deepEqual(model.sequenceView().cells,[]);
  assert.deepEqual(model.sequenceView().noteValues,{});
  model.receiveState(state({screen:'pated_cc',kind:'sequencer',sequence:{type:'cc',selected:[0,64]}}));
  model.sequence('cell',4,64);assert.equal(commands[0].action,'cell');
  model.receive({id:commands[0].id,ok:true,state:state({screen:'launcher',kind:'sequencer',sequence:{type:'launcher',moving:true,selected:[0,1]}})});
  model.sequence('cell',2,1);assert.equal(commands[1].action,'cell');model.disconnect();
});
