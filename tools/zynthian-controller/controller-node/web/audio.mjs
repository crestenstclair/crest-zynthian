// SPDX-License-Identifier: GPL-2.0-or-later
export function installAudio(websocketURL) {
  const button = document.getElementById('audio-enable');
  const status = document.getElementById('audio-status');
  let context, socket;
  const panic = () => { if (socket?.readyState === WebSocket.OPEN) socket.send('"panic"'); };
  async function stop(message = 'Audio off') {
    const previous = socket;
    panic(); socket = null; previous?.close();
    const closing = context; context = null;
    if (closing) await closing.close();
    button.textContent = 'Enable audio'; status.textContent = message;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (context) { await stop(); return; }
      context = new AudioContext({sampleRate: 48000, latencyHint: 'interactive'});
      await context.resume();
      await context.audioWorklet.addModule('/audio-worklet.js');
      const player = new AudioWorkletNode(context, 'zynthian-audio', {outputChannelCount: [2]});
      player.connect(context.destination);
      const connection = socket = new WebSocket(websocketURL('stream'));
      connection.binaryType = 'arraybuffer';
      connection.onmessage = ({data}) => {
        if (connection !== socket) return;
        if (typeof data !== 'string') { player.port.postMessage(data, [data]); return; }
        const format = JSON.parse(data);
        if (format.sampleRate !== context.sampleRate || format.channels !== 2) { stop('Unsupported audio format'); return; }
        button.textContent = 'Disable audio'; status.textContent = 'Audio on';
      };
      connection.onclose = () => { if (socket === connection) stop('Audio disconnected; retry'); };
    } catch (error) { await stop(`Audio: ${error.message}`); }
    finally { button.disabled = false; }
  });
  window.addEventListener('blur', panic);
}
