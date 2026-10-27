// SPDX-License-Identifier: GPL-2.0-or-later
export const keyActions = {
  ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', PageUp:'pageUp', PageDown:'pageDown',
  Enter:'select', x:'select', Shift:'shift', o:'circle', Escape:'back', Backspace:'back', Home:'home', F2:'mixer', F3:'snapshots', F4:'bold',
  y:'navigation', t:'navigation', s:'menu', F5:'navigation', F6:'launcher', F7:'block', ' ':'play', r:'record', Tab:'focus', '[':'lengthLess', ']':'lengthMore',
  '-':'velocityLess', '=':'velocityMore', F12:'panic'
};
const repeated = new Set(['up','down','left','right','pageUp','pageDown','lengthLess','lengthMore','velocityLess','velocityMore']);

export function gamepadActions(pad) {
  const pressed = index => pad.buttons[index]===true || Boolean(pad.buttons[index]?.pressed);
  const actions = new Set();
  for (const [index, action] of [[0,'select'],[1,'circle'],[2,'menu'],[3,'navigation'],[4,'shift'],
    [5,'record'],[8,'home'],[9,'play'],[10,'focus'],[11,'block'],[12,'up'],[13,'down'],[14,'left'],[15,'right']])
    if (pressed(index)) actions.add(action);
  for (const [axis, negative, positive] of [[0,'left','right'],[1,'up','down'],[2,'lengthLess','lengthMore'],[3,'velocityMore','velocityLess']]) {
    if (pad.axes[axis] < -0.55) actions.add(negative);
    if (pad.axes[axis] > 0.55) actions.add(positive);
  }
  return {actions, fine:false};
}

// Tap selection is committed on release. A modifier chord consumes that tap,
// so changing a value never also opens, deletes or inserts the selected item.
export class InputGestures {
  constructor(emit) {this.emit=emit;this.reset();}
  reset() {this.previous=new Set();this.held=new Map();this.used=new Set();this.pressedAt=new Map();}
  update(actions,now=performance.now()) {
    const shift=actions.has('shift') || actions.has('circle');
    for(const key of ['select','circle']) {
      if(actions.has(key) && !this.previous.has(key)) {this.used.delete(key);this.pressedAt.set(key,now);}
      if(actions.has(key) && now-this.pressedAt.get(key)>=350) this.used.add(key);
    }
    if(actions.has('select') && shift) {this.used.add('select');this.used.add('circle');}
    for(const raw of actions) {
      if(['select','circle','shift'].includes(raw)) continue;
      const direction=['up','down','left','right'].includes(raw);
      if(actions.has('select')) this.used.add('select');
      if(actions.has('circle')) this.used.add('circle');
      if(['play','record'].includes(raw) && (shift || actions.has('select'))) {this.held.set(raw,{action:null});continue;}
      const action=direction && shift ? ({left:'parent',right:'enter',up:'details',down:'workspace'})[raw] :
        direction && actions.has('select') ? ({left:'adjustSmallLess',right:'adjustSmallMore',up:'adjustLargeMore',down:'adjustLargeLess'})[raw] : raw;
      const held=this.held.get(raw);
      if(held && held.action!==action) continue; // Release directions before changing chord mode.
      if(!held || (repeated.has(raw) && (!shift || action==='parent') && now>=held.next)) {
        this.held.set(raw,{action,next:now+(held?100:350)});this.emit(action,false);
      }
    }
    for(const key of ['select','circle']) {
      if(this.previous.has(key) && !actions.has(key) && !this.used.has(key) && now-this.pressedAt.get(key)<350) this.emit(key==='circle'?'back':'select',false);
    }
    for(const key of this.held.keys()) if(!actions.has(key)) this.held.delete(key);
    this.previous=new Set(actions);
  }
}

export function installInput(model) {
  const heldSources=new Map();
  const showHeld=(held,source='controller')=>{
    heldSources.set(source,held);
    const actions=new Set([...heldSources.values()].flatMap(actions=>[...actions]));
    const text=actions.has('circle') || actions.has('shift') ? '○ SHIFT · ← Back · ↑ Details · ↓ Return' :
      actions.has('select') ? '× ADJUST · ← → Small · ↑ ↓ Large' : '';
    if(model.inputHeld!==text) {model.inputHeld=text;model.notify();}
  };
  const deliver=(action,fine=false)=>{
    if(['back','parent','home','navigation','details','workspace'].includes(action)) document.activeElement?.blur();
    model.input(action,fine);
  };
  const keyboard=new Set();
  let selectButton=null;
  const keys=new InputGestures((action,fine)=>{
    if(action==='select' && selectButton) {if(selectButton.isConnected)selectButton.click();}
    else deliver(action,fine);
  });
  const keyboardEvent=event=>{
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const textEditing=event.target.closest('input,textarea,select,[contenteditable]');
    const leavingField=event.key==='Escape' || event.shiftKey && event.key.startsWith('Arrow');
    if(textEditing && !leavingField) return;
    const action = keyActions[event.key] || keyActions[event.key.toLowerCase()];
    if (!action) return;
    // Keep standard Tab navigation outside the sequencer's context menu.
    if (event.key === 'Tab' && model.view.kind !== 'sequencer') return;
    event.preventDefault();
    if(event.type==='keydown') {
      if(action==='select' && !keyboard.has('select')) {
        const button=event.target.closest('button');
        // Model-owned cells follow the highlighted cursor, not stale DOM focus.
        selectButton=event.key==='Enter' && !/^(item|tracker):/.test(button?.dataset.focusKey||'') ? button : null;
      }
      keyboard.add(action);
    } else keyboard.delete(action);
    if(event.shiftKey) keyboard.add('shift');else keyboard.delete('shift');
    showHeld(new Set(keyboard),'keyboard');
    keys.update(keyboard);
  };
  document.addEventListener('keydown',keyboardEvent);
  document.addEventListener('keyup',keyboardEvent);
  window.addEventListener('blur',()=>{keyboard.clear();keys.reset();selectButton=null;heldSources.clear();showHeld(new Set());});
  // SDL and browser Gamepad API are alternative sources for the shared model.
  if (window.zynthianNativeHost) {
    const attach = () => {
      const input = window.zynthianNativeInput;
      if (!input) return;
      const updateStatus = () => { model.inputStatus = input.status; model.notify(); };
      input.statusChanged.connect(updateStatus);
      if(input.gamepadStateChanged) {
        let sample=input.gamepadState;
        const gestures=new InputGestures(deliver);
        input.gamepadStateChanged.connect(value=>{sample=value;if(!sample?.connected){gestures.reset();showHeld(new Set());}});
        const poll=now=>{if(sample?.connected){const {actions}=gamepadActions(sample);showHeld(actions);gestures.update(actions,now);}requestAnimationFrame(poll);};
        requestAnimationFrame(poll);
      } else {model.inputStatus='Native input is outdated · rebuild and reopen the C++ host';model.notify();return;}
      updateStatus();
    };
    model.inputStatus = 'Connecting native SDL input…'; model.notify();
    if (window.zynthianNativeInput) attach();
    else window.addEventListener('zynthian-native-ready', attach, {once:true});
    return;
  }
  let armed = false, identity = '';
  const gestures=new InputGestures(deliver);
  const release = () => { armed = false; gestures.reset(); showHeld(new Set()); };
  const status = text => {
    if (model.inputStatus === text) return;
    model.inputStatus = text; model.notify();
  };
  window.addEventListener('blur', release);
  window.addEventListener('gamepaddisconnected', release);
  function poll(now) {
    // Keep polling even after a denied/failed API call; keyboard input still works.
    requestAnimationFrame(poll);
    let pads;
    try {
      if (!navigator.getGamepads) { status('Browser gamepad API unavailable'); release(); return; }
      pads = [...navigator.getGamepads()].filter(Boolean);
    } catch (error) {
      status(`Browser gamepad access failed: ${error.message}`); release(); return;
    }
    const pad = pads.find(p => p.mapping === 'standard');
    if (!pad) {
      status(pads.length ? `Unsupported browser mapping: ${pads.map(p => p.id).join(' / ')}` :
        'Browser sees no controller · press a controller button');
      release(); identity = ''; return;
    }
    if (document.hidden || !document.hasFocus()) {
      status(`${pad.id} · click this window to enable input`); release(); return;
    }
    if (identity !== `${pad.index}:${pad.id}`) {
      release(); identity = `${pad.index}:${pad.id}`;
    }
    if (!armed) {
      armed = !pad.buttons.some(button => button.pressed) && !pad.axes.some(axis => Math.abs(axis) > 0.55);
      status(armed ? pad.id : `${pad.id} · release buttons and center sticks`);
      return;
    }
    status(pad.id);
    const {actions}=gamepadActions(pad);showHeld(actions);gestures.update(actions,now);
  }
  requestAnimationFrame(poll);
}
