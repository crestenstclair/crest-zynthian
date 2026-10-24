import test from 'node:test';
import assert from 'node:assert/strict';
import {ControllerModel} from '../web/model.mjs';
import {gamepadActions} from '../web/input.mjs';

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
  assert.equal(result.fine,true);assert.deepEqual([...result.actions],['record','lengthMore']);
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
