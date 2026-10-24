// SPDX-License-Identifier: GPL-2.0-or-later
// Presentation state only. Notes, chains, presets and sessions live in Zynthian.
export class ControllerModel {
  constructor(send) {
    this.sendFrame = send;
    this.view = {};
    this.selected = 0;
    this.pending = 0;
    this.serial = 0;
    this.connected = false;
    this.canvasFocus = true;
    this.error = '';
    this.inputStatus = 'Keyboard / touch';
    this.listeners = new Set();
    this.changed = {connect: listener => this.listeners.add(listener)};
  }
  get state() {
    return JSON.stringify({...this.view, selected: this.selected, connected: this.connected,
      busy: Boolean(this.pending || this.view.backendBusy), canvasFocus: this.canvasFocus,
      error: this.error, inputStatus: this.inputStatus});
  }
  notify() { for (const listener of this.listeners) listener(); }
  disconnect(message = '') {
    clearTimeout(this.deadline);
    this.connected = false; this.pending = 0; this.view = {}; this.selected = 0;
    this.error = message; this.notify();
  }
  receive(message) {
    if (message.state) this.receiveState(message.state);
    if (this.pending && message.id === this.pending) {
      clearTimeout(this.deadline); this.pending = 0;
      this.error = message.ok ? '' : message.error || 'Action failed'; this.notify();
    }
  }
  receiveState(state) {
    if (state.protocol !== 1 || !Array.isArray(state.items) || typeof state.revision !== 'string') {
      throw Error('Incompatible Zynthian bridge protocol');
    }
    // A fresh authoritative state completes reconnection. Keep action errors
    // during an existing connection until another command is acknowledged.
    if (!this.connected) this.error = '';
    const old = this.view;
    const oldId = old.items?.[this.selected]?.id;
    const same = old.screen === state.screen;
    const newConfirm = state.kind === 'confirm' && old.revision !== state.revision;
    if (!same) this.canvasFocus = true;
    if (state.inlineEditor && (!old.inlineEditor || !same)) this.canvasFocus = false;
    this.view = state;
    const selectedId = state.selectionFollowsBackend || !same ? state.selectedTarget : oldId;
    this.selected = !newConfirm ? state.items.findIndex(item => item.id === selectedId && item.enabled) : -1;
    if (this.selected < 0) this.selected = Math.max(0, state.items.findIndex(item => item.enabled));
    this.connected = true; this.notify();
  }
  send(command) {
    if (!this.connected || this.pending || this.view.backendBusy) return;
    command = {...command, revision: this.view.revision, id: ++this.serial};
    this.pending = command.id; this.error = '';
    this.deadline = setTimeout(() => {
      this.disconnect('Zynthian did not respond. Reconnect before continuing; last action may have completed.');
      this.onTimeout?.();
    }, 30000);
    this.notify(); this.sendFrame(command);
  }
  move(delta) {
    const items = this.view.items || [];
    let next = Math.max(0, Math.min(items.length - 1, this.selected + delta));
    while (next >= 0 && next < items.length) {
      if (items[next].enabled) { this.selected = next; this.notify(); return; }
      next += Math.sign(delta);
    }
  }
  input(action, fine = false) {
    if (!this.connected) return;
    if (this.view.kind === 'sequencer') {
      if (['focus', 'menu'].includes(action)) { this.canvasFocus = !this.canvasFocus; this.notify(); return; }
      if (action === 'back' && !this.canvasFocus) { this.canvasFocus = true; this.notify(); return; }
      if (this.canvasFocus && this.view.sequenceActions?.includes(action)) {
        this.sequence(action, 0, 0, fine); return;
      }
    }
    if (this.pending || this.view.backendBusy) return;
    const item = this.view.items[this.selected];
    const columns = Math.max(1, this.view.columns || 1);
    if (action === 'up' || action === 'down') return this.move(action === 'up' ? -columns : columns);
    if (action === 'pageUp' || action === 'pageDown') return this.move(action === 'pageUp' ? -8 : 8);
    if (action === 'left' || action === 'right') {
      const delta = action === 'left' ? -1 : 1;
      if (item?.kind === 'control' && !item.path) this.adjust(item.id, delta, fine);
      else this.move(delta);
      return;
    }
    if (action === 'select' || action === 'bold') {
      if (item?.enabled) {
        if (this.view.kind === 'sequencer' && item.kind !== 'control') this.canvasFocus = true;
        this.send({method: 'activate', target: item.id, bold: action === 'bold'});
      }
      return;
    }
    if (['back','home','mixer','snapshots','panic','launcher'].includes(action) || action in (this.view.screenActions || {}) || action in (this.view.navigation || {}))
      this.send({method: 'action', action, ...(action === 'screenMenu' && item ? {target:item.id} : {})});
  }
  choose(id) { this.activate(id, false); }
  activate(id, bold) {
    const index = this.view.items?.findIndex(item => item.id === id && item.enabled);
    if (index === undefined || index < 0 || this.pending) return;
    this.selected = index; this.canvasFocus = false;
    this.input(bold ? 'bold' : 'select');
  }
  adjust(id, delta, fine = false) {
    const item = this.view.items?.find(item => item.id === id);
    if (!item?.enabled || item.kind !== 'control' || item.path || !Number.isInteger(delta) || Math.abs(delta) > 10) return;
    this.send({method: 'adjust', target: id, delta, fine});
  }
  setValue(id, value) {
    const item = this.view.items?.find(item => item.id === id);
    if (!item?.enabled || item.kind !== 'control' || item.path || !Number.isFinite(value)) return;
    this.send({method: 'set', target: id, value});
  }
  sequence(action, first = 0, second = 0, fine = false) {
    if (this.view.kind !== 'sequencer' || (action !== 'cell' && !this.view.sequenceActions?.includes(action))) return;
    if (action === 'cell') this.canvasFocus = true;
    this.send({method: 'sequence', action, first, second, fine});
  }
}
