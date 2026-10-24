// SPDX-License-Identifier: GPL-2.0-or-later
const keyActions = {
  ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', PageUp:'pageUp', PageDown:'pageDown',
  Enter:'select', Escape:'back', Backspace:'back', Home:'home', F2:'mixer', F3:'snapshots', F4:'bold',
  F5:'menu', F6:'launcher', F7:'block', ' ':'play', r:'record', Tab:'focus', '[':'lengthLess', ']':'lengthMore',
  '-':'velocityLess', '=':'velocityMore', F12:'panic'
};
const repeated = new Set(['up','down','left','right','pageUp','pageDown','lengthLess','lengthMore','velocityLess','velocityMore']);

export function gamepadActions(pad) {
  const pressed = index => Boolean(pad.buttons[index]?.pressed);
  const fine = pressed(4), actions = new Set();
  for (const [index, action] of [[0,'select'],[1,'back'],[2,fine?'record':'play'],[3,fine?'menu':'bold'],
    [5,'snapshots'],[8,'mixer'],[9,'home'],[10,'focus'],[11,'block'],[12,'up'],[13,'down'],[14,'left'],[15,'right']])
    if (pressed(index)) actions.add(action);
  for (const [axis, negative, positive] of [[0,'left','right'],[1,'up','down'],[2,'lengthLess','lengthMore'],[3,'velocityMore','velocityLess']]) {
    if (pad.axes[axis] < -0.55) actions.add(negative);
    if (pad.axes[axis] > 0.55) actions.add(positive);
  }
  return {actions, fine};
}

export function installInput(model) {
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable]')) return;
    const action = keyActions[event.key];
    if (!action) return;
    // Keep standard Tab navigation outside the sequencer's context menu.
    if (event.key === 'Tab' && model.view.kind !== 'sequencer') return;
    if (event.key === 'Enter' && event.target.closest('button')) return;
    event.preventDefault();
    if (!event.repeat || repeated.has(action)) {
      model.input(action, event.shiftKey);
      if (repeated.has(action) && model.view.kind !== 'sequencer') document.querySelector('#items .selected')?.focus({preventScroll:true});
    }
  });
  let armed = false, identity = '', held = new Map();
  const release = () => { armed = false; held.clear(); };
  window.addEventListener('blur', release);
  window.addEventListener('gamepaddisconnected', release);
  function poll(now) {
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.mapping === 'standard');
    if (!pad || document.hidden || !document.hasFocus()) { release(); requestAnimationFrame(poll); return; }
    if (identity !== `${pad.index}:${pad.id}`) {
      release(); identity = `${pad.index}:${pad.id}`;
      model.inputStatus = pad.id; model.notify();
    }
    if (!armed) {
      armed = !pad.buttons.some(button => button.pressed) && !pad.axes.some(axis => Math.abs(axis) > 0.55);
      requestAnimationFrame(poll); return;
    }
    const {actions, fine} = gamepadActions(pad);
    for (const action of held.keys()) if (!actions.has(action)) held.delete(action);
    for (const action of actions) {
      if (!held.has(action) || (repeated.has(action) && now >= held.get(action))) {
        const delay = held.has(action) ? 100 : 350;
        held.set(action, now + delay); model.input(action, fine);
      }
    }
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);
}
