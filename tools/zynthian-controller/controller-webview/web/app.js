/* SPDX-License-Identifier: GPL-2.0-or-later */
"use strict";
let backend;
let lastFocus = "";
let pointerHeld = false;
// A playback update must not replace a button between pointer-down and click.
document.addEventListener("pointerdown", () => { pointerHeld = true; }, true);
for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, () => {
  pointerHeld = false;
  setTimeout(() => { if (backend) render(); }, 0);
}, true);
const el = id => document.getElementById(id);
function render() {
  if (pointerHeld) return;
  const state = JSON.parse(backend.state);
  el("connection").textContent = state.connected ? (state.busy ? "Working…" : "Connected") : "Disconnected";
  el("connection").className = state.connected ? "online" : "offline";
  el("title").textContent = state.connected ? state.title : "Waiting for Zynthian";
  el("screen-name").textContent = (state.screen || "Zynthian application").replaceAll("_", " ").toUpperCase();
  el("message").textContent = state.connected ? state.message : "Start Zynthian with the webview bridge enabled. The menus will appear when it connects.";
  el("error").textContent = state.error || "";
  el("input-status").textContent = state.inputStatus || "Keyboard / touch";
  document.body.classList.toggle("sequencing", state.kind === "sequencer");
  el("footer-hints").textContent = state.kind === "sequencer" ?
    "D-pad / L-stick cursor · A act · Y edit · X play · R-stick values · LB + Y menu · LB fine" :
    "↑ ↓ Navigate · A / Enter Select · Y / F4 Options · ← → Adjust · LB / Shift Fine";
  const sequencing = state.kind === "sequencer" && state.connected;
  const menuOpen = sequencing && state.canvasFocus === false;
  el("menu-panel").hidden = sequencing && !menuOpen;
  el("context-dismiss").hidden = !menuOpen;
  el("menu-panel").setAttribute("role", sequencing ? "dialog" : "region");
  if (sequencing) el("menu-panel").setAttribute("aria-labelledby", "context-title");
  else el("menu-panel").removeAttribute("aria-labelledby");
  if (menuOpen) el("menu-panel").setAttribute("aria-modal", "true");
  else el("menu-panel").removeAttribute("aria-modal");
  el("context-title").textContent = state.sequence?.type === "launcher" ? "Clip & phrase actions" :
    state.sequence?.type === "cc" ? "CC automation actions" : state.sequence?.editMode ? "Note selection actions" : "Piano roll actions";
  el("context-description").textContent = state.message || "";
  renderSequence(state);
  const list = el("items");
  const scroll = list.scrollTop;
  list.replaceChildren();
  list.className = state.kind === "grid" || state.kind === "keyboard" ? `grid cols-${Math.min(10, state.columns || 1)}` : "list";
  (state.items || []).forEach((item, index) => {
    const button = document.createElement("button");
    button.disabled = !state.connected || state.busy || !item.enabled;
    button.className = "item" + (index === state.selected && (state.kind !== "sequencer" || state.canvasFocus === false) ? " selected" : "") + (!item.enabled ? " divider" : "");
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-current", index === state.selected ? "true" : "false");
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(label);
    if (item.kind === "control") {
      const value = document.createElement("strong");
      value.textContent = item.display;
      button.append(value);
    } else {
      const arrow = document.createElement("span");
      arrow.className = "chevron";
      arrow.textContent = item.enabled ? "›" : "";
      button.append(arrow);
    }
    button.addEventListener("click", () => backend.choose(item.id));
    list.append(button);
  });
  list.scrollTop = scroll;
  const focusKey = `${state.screen}:${state.selected}`;
  if (focusKey !== lastFocus) list.querySelector(".selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  lastFocus = focusKey;
  if (menuOpen) list.querySelector(".selected")?.focus({preventScroll: true});
  const selected = state.items?.[state.selected];
  el("parameter").hidden = selected?.kind !== "control" || selected.path;
  el("parameter-label").textContent = selected?.kind === "control" ? `${selected.label} · ${selected.display}` : "";
  for (const button of document.querySelectorAll("[data-action]")) button.disabled = !state.connected || (state.busy && button.dataset.action !== "focus");
}

function node(tag, cls, text) {
  const result = document.createElement(tag);
  if (cls) result.className = cls;
  if (text !== undefined) result.textContent = text;
  return result;
}
function seqButton(label, action, state) {
  const button = node("button", "seq-button", label);
  button.disabled = state.busy || !state.connected;
  button.addEventListener("click", event => backend.sequence(action, 0, 0, event.shiftKey));
  return button;
}
function svgNode(parent, tag, attrs, text) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}
function inputButton(label, action, state) {
  const button = node("button", "seq-button", label);
  button.disabled = !state.connected || (state.busy && action !== "focus");
  button.addEventListener("click", event => backend.input(action, event.shiftKey));
  return button;
}
function renderSequence(state) {
  const host = el("sequence");
  host.replaceChildren();
  host.hidden = !state.sequence || !state.connected;
  if (host.hidden) return;
  const s = state.sequence;
  const menuOpen = state.canvasFocus === false;
  host.className = menuOpen ? "" : "canvas-focus";
  const status = node("div", "seq-status");
  status.append(inputButton("‹", "back", state));
  status.firstElementChild.setAttribute("aria-label", "Back");
  status.append(node("strong", "seq-title", state.title));
  const detail = s.type === "launcher" ? (s.moving ? "Moving phrase · A finish" : `${s.phraseCount} phrases`) :
    s.type === "cc" ? `CC${s.cc} · ${s.value}` : s.editMode === 2 || s.editMode === 3 ?
      Object.entries(s.noteValues).map(([k,v],i) => i === s.editParam ? `${k} ${Number(v.toFixed(2))}` : "").filter(Boolean).join("") :
      `Step ${s.selected[0]+1} · Vel ${s.noteValues?.Velocity ?? "—"} · Len ${s.noteValues?.Duration ?? "—"}`;
  status.append(node("span", "seq-detail", detail), node("span", "seq-tempo", `${s.tempo} BPM`));
  const playState = s.type === "launcher" ? s.cells.find(c => c.row === s.selected[0] && c.column === s.selected[1])?.playState : s.playState;
  const play = seqButton(playState ? "■ Stop" : "▶ Play", "play", state);
  if (s.recording) play.classList.add("recording");
  status.append(play);
  const acting = s.moving || s.editMode === 2 || s.editMode === 3;
  status.append(seqButton(acting ? "✓ Done" : s.editMode === 1 ? "Copy / paste" : s.type === "launcher" ? "Launch" : "± Note", "select", state));
  if (s.type === "cc") status.lastElementChild.textContent = "± Event";
  const menu = inputButton("☰ Menu", "focus", state);
  menu.id = "context-toggle";
  menu.setAttribute("aria-haspopup", "dialog");
  menu.setAttribute("aria-expanded", menuOpen);
  menu.setAttribute("aria-controls", "menu-panel");
  menu.title = "Context menu · LB + Y / L-stick click / F5 / Tab";
  status.append(menu);
  host.append(status);
  const surface = node("div", "editor-surface");
  host.append(surface);
  if (s.type === "launcher") renderLauncher(surface, s, state);
  else renderRoll(surface, s, state);
}
function renderLauncher(host, s, state) {
  const grid = node("div", "clip-grid");
  grid.style.gridTemplateColumns = `100px repeat(${s.columns.length}, minmax(70px, 1fr))`;
  grid.style.gridTemplateRows = `32px repeat(${s.rows.length}, minmax(68px, 1fr))`;
  grid.append(node("div", "clip-heading", "PHRASES"));
  for (const column of s.columns) grid.append(node("div", "clip-heading", column.label));
  for (const row of s.rows) {
    const title = node("div", "phrase-heading", `${row.id + 1} · ${row.label}`);
    title.append(node("small", "", row.follow === null ? "No follow action" : `Follow → ${row.id + row.follow + 1}`));
    grid.append(title);
    for (const column of s.columns) {
      const c = s.cells.find(c => c.row === row.id && c.column === column.id);
      const selected = s.selected[0] === row.id && s.selected[1] === column.id;
      const pad = node("button", `clip state-${c.playState}${selected ? " cursor" : ""}${c.repeat === 0 ? " clip-disabled" : ""}`);
      pad.disabled = !c.enabled || state.busy || state.canvasFocus === false;
      pad.setAttribute("aria-label", `${row.label}, ${column.label}, ${c.label}, ${c.status}`);
      pad.append(node("strong", "", c.label), node("small", "", c.status),
        node("span", "clip-meta", `${c.audio ? "AUDIO" : c.events + " events"} · ${c.repeat === 255 ? "LOOP" : c.repeat === 0 ? "OFF" : c.repeat + "×"}`));
      pad.addEventListener("click", () => backend.sequence("cell", row.id, column.id, false));
      grid.append(pad);
    }
  }
  host.append(grid);
}
function renderRoll(host, s, state) {
  // Match the available pixels: a fixed-aspect SVG would letterbox the editor.
  const width = Math.max(320, host.clientWidth), height = Math.max(160, host.clientHeight);
  const left = 56, right = width - 2, top = 24;
  const bottom = height - (s.type === "notes" ? 66 : 26), lane = bottom + 6;
  const stepWidth = (right - left) / Math.max(1, s.steps.length), first = s.steps[0] || 0;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "piano-roll");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", s.type === "cc" ? `CC ${s.cc} automation editor` : "Piano roll and velocity lane");
  svgNode(svg, "rect", {width, height, fill: "#20272c"});
  const select = (n, step, row) => {
    n.setAttribute("role", "button");
    n.setAttribute("aria-label", `Select step ${step + 1}, ${s.type === "notes" ? "row" : "value"} ${row}`);
    n.addEventListener("click", () => { if (!state.busy && state.canvasFocus !== false) backend.sequence("cell", step, row, false); });
  };
  if (s.type === "notes") {
    const rh = (bottom - top) / Math.max(1, s.rows.length);
    s.rows.forEach((row, ri) => {
      const y = top + ri * rh, black = [1,3,6,8,10].includes(row.note % 12);
      svgNode(svg, "rect", {x:left, y, width:right-left, height:rh, fill:black ? "#ccd0d2" : "#e4e6e5"});
      svgNode(svg, "rect", {x:0, y, width:left-2, height:rh-1, fill:black ? "#354149" : "#f2f1ea"});
      svgNode(svg, "text", {x:left-9, y:y+rh/2+4, "text-anchor":"end", fill:black ? "#e7eeee" : "#424b50", "font-size":12}, row.label);
      for (const step of s.steps) {
        const x = left + (step-first)*stepWidth;
        const r = svgNode(svg, "rect", {x, y, width:stepWidth, height:rh, fill:"transparent", stroke:"#a7afb3", "stroke-width":0.5});
        select(r, step, row.id);
      }
    });
    const drawn = new Set();
    for (const cell of s.cells) {
      const key = `${cell.row}:${cell.start}`;
      if (!cell.velocity || drawn.has(key)) continue;
      drawn.add(key);
      const ri = s.rows.findIndex(r => r.id === cell.row);
      const begin = Math.max(first, cell.start + cell.offset);
      const end = Math.min(first + s.steps.length, cell.start + cell.offset + cell.duration);
      const r = svgNode(svg, "rect", {x:left+(begin-first)*stepWidth+1, y:top+ri*rh+3,
        width:Math.max(2,(end-begin)*stepWidth-2), height:rh-6, rx:2,
        fill:cell.row === s.selected[1] && cell.start === s.selected[0] ? "#f6c184" : "#d97968", stroke:"#9e4c40", "stroke-width":1});
      select(r, Math.max(first, cell.start), cell.row);
    }
    const ri = s.rows.findIndex(r => r.id === s.selected[1]);
    if (ri >= 0) svgNode(svg, "rect", {x:left+(s.selected[0]-first)*stepWidth+1, y:top+ri*rh+1,
      width:stepWidth-2, height:rh-2, fill:"none", stroke:"#f4a52a", "stroke-width":3, "pointer-events":"none"});
    if (s.block) {
      const [a,b] = s.block, lo = Math.max(first,Math.min(a[0],b[0])), hi = Math.min(first+s.steps.length-1,Math.max(a[0],b[0]));
      s.rows.forEach((row, i) => {if (row.id >= Math.min(a[1],b[1]) && row.id <= Math.max(a[1],b[1]))
        svgNode(svg,"rect",{x:left+(lo-first)*stepWidth,y:top+i*rh,width:(hi-lo+1)*stepWidth,height:rh,fill:"#eab74d",opacity:0.25,"pointer-events":"none"});});
    }
    svgNode(svg,"text",{x:10,y:lane+15,fill:"#b4c4ca","font-size":10},"VELOCITY");
    for (const cell of s.cells.filter(c => c.row === s.selected[1] && c.start === c.step && c.velocity)) {
      const h = cell.velocity/127*44;
      const bar = svgNode(svg,"rect",{x:left+(cell.step-first)*stepWidth+stepWidth*.35,y:lane+48-h,width:Math.max(3,stepWidth*.3),height:h,fill:"#d97968"});
      select(bar,cell.step,cell.row);
    }
  } else {
    svgNode(svg,"rect",{x:left,y:top,width:right-left,height:bottom-top,fill:"#e0e3e3"});
    for(const value of [0,32,64,96,127]) {
      const y=bottom-value/127*(bottom-top);
      svgNode(svg,"line",{x1:left,x2:right,y1:y,y2:y,stroke:"#a7afb3","stroke-width":.5});
      svgNode(svg,"text",{x:left-10,y:y+4,fill:"#c5cfd2","font-size":12,"text-anchor":"end"},value);
    }
    for(const c of s.cells) {
      const x=left+(c.step-first)*stepWidth;
      const r=svgNode(svg,"rect",{x,y:top,width:stepWidth,height:bottom-top,fill:c.step===s.selected[0]?"#f4a52a":"transparent",opacity:c.step===s.selected[0]?.16:1});
      select(r,c.step,s.selected[1]);
      if(c.value !== null) {
        const y=bottom-c.value/127*(bottom-top);
        svgNode(svg,"rect",{x:x+stepWidth*.25,y,width:stepWidth*.5,height:Math.max(2,bottom-y),fill:"#d97968","pointer-events":"none"});
        svgNode(svg,"circle",{cx:x+stepWidth/2,cy:y,r:4,fill:"#6e3c36","pointer-events":"none"});
      }
    }
    svgNode(svg,"text",{x:left,y:lane+15,fill:"#c7d4d8","font-size":15},`CC ${s.cc} · value ${s.value} · ${s.interpolate ? "Interpolation on" : "Stepped"}`);
  }
  for (const step of s.steps) {
    const x=left+(step-first)*stepWidth;
    svgNode(svg,"line",{x1:x,x2:x,y1:top,y2:bottom,stroke:step%s.stepsPerBeat===0?"#586870":"#a7afb3","stroke-width":step%s.stepsPerBeat===0?1.5:.5,"pointer-events":"none"});
    svgNode(svg,"text",{x:x+6,y:19,fill:step%s.stepsPerBeat===0?"#f0d5a6":"#819298","font-size":11},step+1);
  }
  if(s.playState && s.playhead>=first && s.playhead<first+s.steps.length) {
    const x=left+(s.playhead-first)*stepWidth;
    svgNode(svg,"line",{x1:x,x2:x,y1:top-8,y2:height-3,stroke:"#71bb9d","stroke-width":3,"pointer-events":"none"});
  }
  host.append(svg);

}
let resizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (backend) render(); });
});
function bindActions() {
  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", event => backend.input(button.dataset.action, event.shiftKey));
  }
}
if (typeof qt !== "undefined") {
  new QWebChannel(qt.webChannelTransport, channel => {
    backend = channel.objects.zynthian;
    backend.changed.connect(render);
    bindActions();
    render();
    if (typeof connectComposer === "function") connectComposer(channel);
  });
} else {
  el("message").textContent = "Open this interface with the Zynthian Controller application.";
}
