// SPDX-License-Identifier: GPL-2.0-or-later
import {ControllerModel} from './model.mjs';
import {installInput} from './input.mjs';
import {installAudio} from './audio.mjs';

// Preserve the supplied optional Qt host while Node is the desktop entry point.
if (typeof qt !== 'undefined') {
  const script = document.createElement('script');
  script.src = 'qrc:///qtwebchannel/qwebchannel.js';
  script.onload = () => new QWebChannel(qt.webChannelTransport, channel => window.attachBackend(channel.objects.zynthian));
  document.head.append(script);
} else {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get('token') || sessionStorage.getItem('zynthian-controller-token') || '';
  if (token) sessionStorage.setItem('zynthian-controller-token', token);
  history.replaceState(null, '', location.pathname);
  const url = path => `ws://${location.host}/${path}?token=${encodeURIComponent(token)}`;
  let socket;
  const model = new ControllerModel(command => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
    else model.disconnect('Disconnected. Reopen the controller URL.');
  });
  window.controller = model;
  window.attachBackend(model);
  installInput(model);
  installAudio(url);
  model.onTimeout = () => socket.close();
  function connect() {
    socket = new WebSocket(url('control'));
    socket.onmessage = event => {
      try { model.receive(JSON.parse(event.data)); }
      catch (error) {
        console.error('Controller state error:', error);
        model.disconnect(error.message); socket.close(1002, 'Invalid controller state');
      }
    };
    socket.onclose = event => {
      console.warn('Controller disconnected:', event.code, event.reason);
      model.disconnect(`Disconnected${event.reason ? ': ' + event.reason : '. Close any other controller tab'}; reconnecting…`);
      setTimeout(connect, 1500);
    };
    socket.onerror = () => socket.close();
  }
  if (token) connect();
  else model.disconnect('Open the local URL printed by zynthian-controller start.');
}
