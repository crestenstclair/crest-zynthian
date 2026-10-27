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
    this.navigationOpen = false;
    this.navigationIndex = 0;
    this.homeOpen = false;
    this.homeIndex = 0;
    this.trackerField = 0;
    this.sequenceCursor = null;
    this.pendingCommand = null;
    this.inputHeld = '';
    this.editorType = 'tracker';
    this.routingVisible = false;
    this.engineCategory = null;
    this.mixerChain = null;
    this.error = '';
    this.inputStatus = 'Keyboard / touch';
    this.listeners = new Set();
    this.changed = {connect: listener => this.listeners.add(listener)};
  }
  get state() {
    return JSON.stringify({...this.view, selected: this.selected, connected: this.connected,
      busy: Boolean(this.pending || this.view.backendBusy), canvasFocus: this.canvasFocus, inputHeld:this.inputHeld,
      navigationOpen:this.navigationOpen, navigationIndex:this.navigationIndex,
      navigationEntries:this.navigationEntries(), editorType:this.editorType, routingVisible:this.routingVisible,
      homeOpen:this.homeOpen,homeIndex:this.homeIndex,homeEntries:this.homeEntries(),trackerField:this.trackerField,
      engineCategory:this.engineCategory,
      sequence:this.sequenceView(),
      mixerChain:this.mixerChain,
      items:(this.view.items || []).map(item=>({...item,visible:this.itemVisible(item)})),
      error: this.error, inputStatus: this.inputStatus});
  }
  sequenceView() {
    const sequence=this.view.sequence;
    if(!sequence || !this.sequenceCursor || sequence.editMode || sequence.moving) return sequence;
    if(sequence.type==='launcher') return {...sequence,selected:this.sequenceCursor};
    if(sequence.type!=='notes') return sequence;
    const [step,row]=this.sequenceCursor, start=Math.floor(step/16)*16;
    const event=sequence.events.find(event=>event.row===row && event.step<=step && event.step+event.duration>step);
    const steps=Array.from({length:Math.min(16,sequence.stepCount-start)},(_,index)=>start+index);
    const projection={...sequence,selected:this.sequenceCursor,steps,
      noteValues:event?{...sequence.noteValues,Velocity:event.velocity,Duration:event.duration}:{}};
    if(this.editorType==='piano' && sequence.keys) {
      const firstRow=Math.floor(row/12)*12;
      projection.rows=sequence.keys.slice(firstRow,firstRow+12).reverse();
      projection.cells=sequence.events.filter(event=>projection.rows.some(row=>row.id===event.row) &&
        event.step+event.offset+event.duration>start && event.step+event.offset<start+steps.length)
        .map(event=>({...event,start:event.step}));
    }
    return projection;
  }
  focusSequence(first,second) {
    this.sequenceCursor=[first,second];this.canvasFocus=true;this.notify();
  }
  navigationEntries() {
    const labels={launcher:'Song',chainManager:'Instruments',mixer:'Mixer',snapshots:'Song File / snapshots',
      presets:'Bank / preset',chainControl:'Current instrument',zs3:'Performance states / ZS3',tempo:'Tempo / clock',
      audioPlayer:'Audio recordings',midiPlayer:'MIDI recordings',audioLevels:'Audio levels',
      midiInput:'MIDI input',midiOutput:'MIDI output',admin:'System settings',addChain:'Advanced routing / add chain'};
    return [...new Set(['launcher','chainManager','mixer','snapshots',...Object.keys(this.view.navigation || {})])]
      .map(action=>({action,label:labels[action] || this.view.navigation?.[action]}))
      .concat([{action:'home',label:'Native main menu / recording'},{action:'panic',label:'All sounds off'}]);
  }
  homeEntries() {
    return [{action:'launcher',label:'Sequencer',description:'Song and phrases'},
      {action:'chainManager',label:'Instruments',description:'Sounds, inserts and routing'},
      {action:'mixer',label:'Mixer',description:'Levels and outputs'},
      {action:'snapshots',label:'Song files',description:'Save and load snapshots'},
      {action:'zs3',label:'Performance',description:'ZS3 states'},
      {action:'audioPlayer',label:'Audio recordings',description:'Recorded audio and playback'},
      {action:'midiPlayer',label:'MIDI recordings',description:'MIDI files and playback'},
      {action:'admin',label:'Settings',description:'Devices and system'}];
  }
  itemVisible(item) {
    if(this.view.screen==='engine') return this.engineCategory===null ? item.id.startsWith('category:') : item.id.startsWith('list:');
    if(this.view.mixer && item.id.startsWith('mix:')) {
      const [,chain,symbol]=item.id.split(':');
      return ['level','balance','mute','solo'].includes(symbol) || chain===String(this.mixerChain);
    }
    if(!this.view.instruments) return true;
    return this.routingVisible ? !item.id.startsWith('instrument:') : item.id.startsWith('instrument:');
  }
  toggleNavigation() {this.navigationOpen=!this.navigationOpen;this.navigationIndex=0;this.notify();}
  navigate(action) {this.navigationOpen=false;this.homeOpen=false;this.send({method:'action',action});this.notify();}
  parent() {
    if(this.navigationOpen) {this.navigationOpen=false;this.notify();return;}
    if(this.homeOpen) return;
    if(this.view.screen==='engine' && this.engineCategory!==null) {
      const category=this.engineCategory;this.engineCategory=null;this.focusItem(category);this.notify();return;
    }
    if(this.view.detailWorkspace) {this.send({method:'action',action:'workspace'});return;}
    if(this.view.kind==='sequencer' && !this.canvasFocus) {this.canvasFocus=true;this.notify();return;}
    if(['pattern_editor','pated_cc'].includes(this.view.screen)) return this.navigate('launcher');
    if(this.view.instrument) return this.navigate('chainManager');
    if(['launcher','chain_manager','mixer','root','main_menu','admin','snapshot','zs3','audio_player','midi_recorder'].includes(this.view.screen)) {
      this.homeOpen=true;this.homeIndex=0;this.notify();return;
    }
    this.send({method:'action',action:'back'});
  }
  trackerInput(action) {
    const s=this.sequenceView(),fields=['pitch','velocity','event','offset','probability','stutter'];
    if(action==='left' || action==='right') {
      const delta=action==='left'?-1:1, next=this.trackerField+delta;
      if(next>=0 && next<fields.length) {this.trackerField=next;this.notify();return;}
      return;
    }
    if(action==='up' || action==='down') {
      const step=Math.max(0,Math.min(s.stepCount-1,s.selected[0]+(action==='up'?-1:1)));
      const event=s.events.find(event=>event.step<=step && event.step+event.duration>step);
      this.focusSequence(step,event?.row??s.selected[1]);
      return;
    }
    if(action==='select') {
      if(this.trackerField===2) {this.adjustSelected('adjustSmallMore');return;}
      const existing=s.events.some(event=>event.row===s.selected[1] && event.step===s.selected[0]);
      if(!existing && this.trackerField===0) this.sequence('insert',...s.selected);
      return;
    }
  }
  focusTracker(step,row,field=0) {this.trackerField=field;this.focusSequence(step,row);}
  moveSequence(action) {
    const s=this.sequenceView(), [first,second]=s.selected;
    if(s.type==='notes') {
      const step=Math.max(0,Math.min(s.stepCount-1,first+(action==='left'?-1:action==='right'?1:0)));
      const row=Math.max(0,Math.min((s.keys?.length||128)-1,second+(action==='down'?-1:action==='up'?1:0)));
      this.focusSequence(step,row);
    } else {
      const row=s.rows.findIndex(row=>row.id===first),column=s.columns.findIndex(column=>column.id===second);
      const nextRow=Math.max(0,Math.min(s.rows.length-1,row+(action==='up'?-1:action==='down'?1:0)));
      const nextColumn=Math.max(0,Math.min(s.columns.length-1,column+(action==='left'?-1:action==='right'?1:0)));
      this.focusSequence(s.rows[nextRow].id,s.columns[nextColumn].id);
    }
  }
  adjustSelected(action) {
    const delta=action.endsWith('Less')?-1:1,large=action.includes('Large');
    if(this.view.kind==='sequencer' && this.view.sequence.type==='notes' && !this.view.inlineEditor && this.canvasFocus) {
      if(this.view.sequence.editMode!==0) {this.sequence(delta>0?'up':'down',0,0,!large);return;}
      const s=this.sequenceView(),field=['pitch','velocity','event','offset','probability','stutter'][this.trackerField];
      this.send({method:'sequence',action:'editCell',first:s.selected[0],second:s.selected[1],field,delta,large,tracker:this.editorType==='tracker'});return;
    }
    const item=this.view.items[this.selected];
    if(item?.kind==='control') this.adjust(item.id,delta*(large?10:1),!large);
  }
  setEditor(type) {if(['piano','tracker'].includes(type)){this.editorType=type;this.notify();}}
  toggleRouting() {
    this.routingVisible=!this.routingVisible;
    this.selected=Math.max(0,this.view.items.findIndex(item=>item.enabled && this.itemVisible(item)));this.notify();
  }
  focusItem(id) {
    const index=this.view.items?.findIndex(item=>item.id===id && item.enabled);
    if(index<0 || index===undefined) return;
    this.selected=index;
    if(this.view.mixer && /^(chain|mix):/.test(id)) this.mixerChain=id.split(':')[1];
  }
  notify() { for (const listener of this.listeners) listener(); }
  disconnect(message = '') {
    clearTimeout(this.deadline);
    this.connected = false; this.pending = 0; this.view = {}; this.selected = 0;
    this.navigationOpen = false;this.sequenceCursor=null;this.pendingCommand=null;
    this.error = message; this.notify();
  }
  receive(message) {
    const command=this.pendingCommand;
    if(message.id===this.pending && message.ok && command?.action==='editCell' && command.field==='pitch' &&
       this.sequenceCursor?.[0]===command.first && this.sequenceCursor?.[1]===command.second && message.state?.sequence)
      this.sequenceCursor=[command.first,message.state.sequence.selected[1]];
    if(message.id===this.pending) {clearTimeout(this.deadline);this.pending=0;this.pendingCommand=null;}
    if(command && message.id===command.id && message.ok && command.target?.startsWith('category:')) this.engineCategory=command.target;
    if (message.state) this.receiveState(message.state);
    if (command && message.id === command.id) {
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
    if(!same || old.sequence?.pattern!==state.sequence?.pattern || old.sequence?.channel!==state.sequence?.channel || old.sequence?.scene!==state.sequence?.scene)
      this.sequenceCursor=state.sequence?.selected?[...state.sequence.selected]:null;
    if(this.sequenceCursor && state.sequence?.type==='notes') this.sequenceCursor[0]=Math.min(this.sequenceCursor[0],state.sequence.stepCount-1);
    const newConfirm = state.kind === 'confirm' && old.revision !== state.revision;
    if (!same) {this.canvasFocus = true;this.routingVisible=false;this.engineCategory=null;this.mixerChain=state.mixer?.[0]?.id??null;}
    if (old.detailWorkspace && !state.detailWorkspace) this.canvasFocus = true;
    if (state.instruments && state.screenActions?.['move:done']) this.routingVisible=true;
    if (state.mixer && !state.mixer.some(strip=>String(strip.id)===String(this.mixerChain))) this.mixerChain=state.mixer[0]?.id??null;
    if (state.inlineEditor && (!old.inlineEditor || !same)) this.canvasFocus = false;
    this.view = state;
    const selectedId = state.inlineEditor && (!old.inlineEditor || !same) ? 'inline-editor' :
      state.selectionFollowsBackend || !same ? state.selectedTarget : oldId;
    this.selected = !newConfirm ? state.items.findIndex(item => item.id === selectedId && item.enabled) : -1;
    if (this.selected < 0 || !this.itemVisible(state.items[this.selected])) this.selected = Math.max(0, state.items.findIndex(item => item.enabled && this.itemVisible(item)));
    this.connected = true; this.notify();
  }
  send(command) {
    if (!this.connected || this.pending || this.view.backendBusy) return;
    command = {...command, revision: this.view.revision, id: ++this.serial};
    this.pending = command.id; this.pendingCommand=command; this.error = '';
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
      if (items[next].enabled && this.itemVisible(items[next])) { this.focusItem(items[next].id); this.notify(); return; }
      next += Math.sign(delta);
    }
  }
  input(action, fine = false) {
    if (!this.connected) return;
    if(action==='navigation') {this.toggleNavigation();return;}
    if(action==='home') {this.homeOpen=true;this.navigationOpen=false;this.homeIndex=0;this.notify();return;}
    if(this.navigationOpen) {
      if(['back','parent','workspace','home','menu'].includes(action)) {this.navigationOpen=false;this.notify();return;}
      if(['up','down','left','right'].includes(action)) {
        this.navigationIndex=Math.max(0,Math.min(this.navigationEntries().length-1,this.navigationIndex+(['up','left'].includes(action)?-1:1)));this.notify();return;
      }
      if(action==='select') this.navigate(this.navigationEntries()[this.navigationIndex].action);
      return;
    }
    if(action==='back' || action==='parent') {this.parent();return;}
    if(this.homeOpen) {
      if(['up','down','left','right'].includes(action)) {this.homeIndex=Math.max(0,Math.min(this.homeEntries().length-1,this.homeIndex+(['up','left'].includes(action)?-1:1)));this.notify();}
      if(action==='select' || action==='enter') this.navigate(this.homeEntries()[this.homeIndex].action);
      return;
    }
    if(action==='workspace') {if(this.view.detailWorkspace)this.send({method:'action',action:'workspace'});else {this.canvasFocus=true;this.notify();}return;}
    if(action==='details') {
      if(this.view.kind==='sequencer' && this.view.sequence.type==='launcher') this.sequence('details',...this.sequenceView().selected);
      else this.send({method:'action',action:'details'});
      return;
    }
    if(action==='enter') action='select';
    if(action.startsWith('adjust')) {this.adjustSelected(action);return;}
    if(action==='menu' && this.view.kind!=='sequencer') {this.input('bold');return;}
    if (this.view.kind === 'sequencer') {
      if (['focus', 'menu'].includes(action)) { this.canvasFocus = !this.canvasFocus; this.notify(); return; }
      if (action === 'back' && !this.canvasFocus) { this.canvasFocus = true; this.notify(); return; }
      if (this.canvasFocus && this.view.sequenceActions?.includes(action)) {
        if(this.view.sequence?.type==='launcher' && action==='select' && !this.view.sequence.moving && this.view.sequenceActions.includes('open')) {
          this.sequence('open',...this.sequenceView().selected);return;
        }
        if(this.editorType==='tracker' && this.view.sequence?.type==='notes' && this.view.sequence.editMode===0 && ['up','down','left','right','select'].includes(action)) return this.trackerInput(action);
        if(!this.view.sequence?.editMode && !this.view.sequence?.moving && ['notes','launcher'].includes(this.view.sequence?.type) && ['up','down','left','right'].includes(action)) return this.moveSequence(action);
        this.sequence(action, 0, 0, fine); return;
      }
    }
    const item = this.view.items[this.selected];
    const columns = this.view.kind==='keyboard' ? Math.max(1, this.view.columns || 1) : 1;
    if (action === 'up' || action === 'down') return this.move(action === 'up' ? -columns : columns);
    if (action === 'pageUp' || action === 'pageDown') return this.move(action === 'pageUp' ? -8 : 8);
    if (action === 'left' || action === 'right') {
      const delta = action === 'left' ? -1 : 1;
      this.move(delta);
      return;
    }
    if (action === 'select' || action === 'bold') {
      if (this.pending || this.view.backendBusy) return;
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
    this.focusItem(id); this.canvasFocus = false;
    if(this.view.properties && this.view.items[index].kind==='control') {this.notify();return;}
    if(id.startsWith('seq:') && this.view.sequence?.type==='notes') {
      this.canvasFocus=true;this.sequence(id.slice(4));return;
    }
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
    if (this.view.kind !== 'sequencer' || (!['cell','trackerCell'].includes(action) && !this.view.sequenceActions?.includes(action))) return;
    if(['cell','trackerCell'].includes(action) && ['notes','launcher'].includes(this.view.sequence.type) &&
      !this.view.sequence.editMode && !this.view.sequence.moving) {this.focusSequence(first,second);return;}
    if(this.pending || this.view.backendBusy) return;
    if (['cell','trackerCell','open'].includes(action)) this.canvasFocus = true;
    const directed=this.view.sequence?.type==='notes' && !this.view.sequence.editMode &&
      ['select','insert','remove','bold','block','lengthLess','lengthMore','velocityLess','velocityMore'].includes(action) ||
      this.view.sequence?.type==='launcher' && ['play','select','edit','menu','copy','paste','details'].includes(action);
    if(directed) [first,second]=this.sequenceView().selected;
    this.send({method: 'sequence', action, first, second, fine, ...(directed?{directed:true}:{}),
      ...(['insert','remove'].includes(action) && this.editorType==='tracker'?{tracker:true}:{})});
  }
}
