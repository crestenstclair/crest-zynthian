import RFB from '/novnc/core/rfb.js';

const element = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') || sessionStorage.getItem('zynthian-token');
if (token) sessionStorage.setItem('zynthian-token', token);
history.replaceState(null, '', location.pathname);
const websocketURL = path => `ws://${location.host}/${path}?token=${encodeURIComponent(token || '')}`;

const display = new RFB(element('display'), websocketURL('vnc'));
display.scaleViewport = true;
display.resizeSession = false;
display.addEventListener('connect', () => { element('display-status').textContent = 'Display connected'; });
display.addEventListener('disconnect', () => {
  element('display-status').textContent = 'Display disconnected. Reload, or reopen URL from zynthian-web start.';
});

let socket;
let context;
let gain;
let midiAccess;
const held = new Map();
const keys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'];
const notes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B', 'C'];
const channel = () => Number(element('channel').value);
for (let i = 0; i < 16; i++) element('channel').add(new Option(String(i + 1), String(i)));

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function panic() {
  held.clear();
  document.querySelectorAll('.playing').forEach(key => key.classList.remove('playing'));
  send('panic');
}

function noteOn(note) {
  if (held.has(note) || socket?.readyState !== WebSocket.OPEN) return;
  held.set(note, channel());
  send([0x90 + channel(), note, 90]);
  element(`note-${note}`)?.classList.add('playing');
}

function noteOff(note) {
  if (!held.has(note)) return;
  send([0x80 + held.get(note), note, 0]);
  held.delete(note);
  element(`note-${note}`)?.classList.remove('playing');
}

async function stopAudio(message = 'Audio off.') {
  panic();
  const previousSocket = socket;
  socket = null;
  previousSocket?.close();
  if (context) await context.close();
  context = null;
  element('audio').textContent = 'Enable audio';
  element('audio-status').textContent = message;
}

async function startAudio() {
  context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await context.resume();
  await context.audioWorklet.addModule('/static/audio-worklet.js');
  const player = new AudioWorkletNode(context, 'zynthian-audio', { outputChannelCount: [2] });
  gain = context.createGain();
  gain.gain.value = Number(element('volume').value);
  player.connect(gain).connect(context.destination);
  const connection = socket = new WebSocket(websocketURL('stream'));
  connection.binaryType = 'arraybuffer';
  connection.onmessage = ({ data }) => {
    if (typeof data === 'string') {
      const format = JSON.parse(data);
      if (format.sampleRate !== context.sampleRate || format.channels !== 2) {
        stopAudio('Unsupported audio format. Expected 48 kHz stereo.');
        return;
      }
      element('audio-status').textContent = 'Audio on · 48 kHz stereo · browser MIDI ready';
      element('audio').textContent = 'Disable audio';
    } else {
      player.port.postMessage(data, [data]);
    }
  };
  connection.onclose = () => {
    if (socket === connection) stopAudio('Audio disconnected. Retry; only one tab can play at a time.');
  };
}

element('audio').onclick = async () => {
  element('audio').disabled = true;
  try {
    if (context) await stopAudio();
    else await startAudio();
  } catch (error) {
    await stopAudio(`Audio failed: ${error.message}`);
  } finally {
    element('audio').disabled = false;
  }
};
element('volume').oninput = event => {
  if (gain && context) gain.gain.setTargetAtTime(Number(event.target.value), context.currentTime, 0.02);
};
element('panic').onclick = panic;
element('channel').onchange = panic;
window.addEventListener('blur', panic);
document.addEventListener('visibilitychange', () => { if (document.hidden) panic(); });

function attachMidiInputs() {
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = ({ data }) => {
      if (data[0] < 0xF0 || [0xF8, 0xFA, 0xFB, 0xFC].includes(data[0])) send(Array.from(data));
    };
  }
  element('midi-status').textContent = `MIDI inputs: ${Array.from(midiAccess.inputs.values(), input => input.name).join(', ') || 'none connected'}. Hardware MIDI keeps its original channel.`;
}
element('midi').onclick = async () => {
  if (!navigator.requestMIDIAccess) {
    element('midi-status').textContent = 'Web MIDI requires Chrome or another browser with Web MIDI support.';
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = () => { panic(); attachMidiInputs(); };
    attachMidiInputs();
  } catch (error) {
    element('midi-status').textContent = `MIDI access failed: ${error.message}`;
  }
};

notes.forEach((name, index) => {
  const note = 60 + index;
  const button = document.createElement('button');
  button.id = `note-${note}`;
  button.textContent = `${name} ${keys[index].toUpperCase()}`;
  button.setAttribute('aria-label', `${name}${index === 12 ? 5 : 4}`);
  if (name.includes('♯')) button.className = 'sharp';
  button.onpointerdown = event => {
    event.preventDefault();
    element('piano').focus();
    button.setPointerCapture(event.pointerId);
    noteOn(note);
  };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => noteOff(note);
  button.onkeydown = event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); noteOn(note); }
  };
  button.onkeyup = event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); noteOff(note); }
  };
  element('piano').append(button);
});
element('piano').addEventListener('keydown', event => {
  const index = keys.indexOf(event.key.toLowerCase());
  if (index < 0 || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  noteOn(60 + index);
});
window.addEventListener('keyup', event => {
  const index = keys.indexOf(event.key.toLowerCase());
  if (index >= 0) noteOff(60 + index);
});
element('piano').addEventListener('focusout', event => {
  if (!element('piano').contains(event.relatedTarget)) panic();
});
