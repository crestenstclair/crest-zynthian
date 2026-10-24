// SPDX-License-Identifier: GPL-2.0-or-later
// HTTP/WebSocket transport only. Zynthian retains all engine and session state.
import http from 'node:http';
import net from 'node:net';
import {readFile, stat} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';

const webRoot = new URL('./web/', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ...['app.js', 'model.mjs', 'input.mjs', 'boot.mjs', 'audio.mjs', 'audio-worklet.js'].map(name =>
    ['/'+name, [name, 'text/javascript']]),
  ['/style.css', ['style.css', 'text/css']]
]);
const MAX_FRAME = 1024 * 1024;

function tokenMatches(candidate, expected) {
  const value = Buffer.from(candidate || '');
  const secret = Buffer.from(expected);
  return value.length === secret.length && timingSafeEqual(value, secret);
}

function validOrigin(request, port, requireOrigin = false) {
  const host = request.headers.host;
  if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(host)) return false;
  return (!request.headers.origin && !requireOrigin) || request.headers.origin === `http://${host}`;
}

function bridgeConnection(client, socketPath) {
  const native = net.createConnection(socketPath);
  let incoming = Buffer.alloc(0);
  native.on('connect', () => native.write('{"method":"state"}\n'));
  native.on('data', data => {
    incoming = Buffer.concat([incoming, data]);
    if (incoming.length > MAX_FRAME) return client.close(1009, 'Backend frame too large');
    let end;
    while ((end = incoming.indexOf(10)) >= 0) {
      const frame = incoming.subarray(0, end);
      incoming = incoming.subarray(end + 1);
      if (client.bufferedAmount > MAX_FRAME) return client.close(1009, 'Client too slow');
      if (client.readyState === WebSocket.OPEN) client.send(frame.toString());
    }
  });
  client.on('message', (data, binary) => {
    try {
      const command = JSON.parse(data);
      if (binary || !command || Array.isArray(command) || typeof command !== 'object') throw Error();
      // Never offer eval, shell, unrestricted CUIA or arbitrary file access.
      if (!['state', 'action', 'activate', 'adjust', 'sequence', 'set'].includes(command.method)) throw Error();
      if (!native.writable || native.writableLength > MAX_FRAME) throw Error();
      native.write(JSON.stringify(command)+'\n');
    } catch {
      client.close(1008, 'Invalid controller command');
    }
  });
  native.on('error', () => client.close(1011, 'Zynthian unavailable'));
  native.on('close', () => client.close(1011, 'Zynthian disconnected'));
  client.on('close', () => native.destroy());
  client.on('error', () => native.destroy());
}

function audioConnection(client, request, token) {
  const upstream = new WebSocket(`ws://127.0.0.1:8767/stream?token=${encodeURIComponent(token)}`, {
    headers: {Host: request.headers.host, Origin: request.headers.origin}, maxPayload: MAX_FRAME
  });
  upstream.on('message', (data, binary) => {
    if (client.bufferedAmount > MAX_FRAME) return client.close(1013, 'Audio client too slow');
    if (client.readyState === WebSocket.OPEN) client.send(data, {binary});
  });
  client.on('message', (data, binary) => {
    if (binary || data.length > 256) return client.close(1008, 'Invalid MIDI message');
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, {binary: false});
  });
  upstream.on('error', () => client.close(1011, 'Audio unavailable'));
  upstream.on('close', () => client.close());
  client.on('close', () => upstream.close());
  client.on('error', () => upstream.close());
}

export function createControllerServer({socketPath, token, port = 8766}) {
  if (!socketPath || token.length < 32) throw Error('Private socket and access token required');
  let controller;
  const sockets = new WebSocketServer({noServer: true, maxPayload: 65536, perMessageDeflate: false});
  const server = http.createServer(async (request, response) => {
    if (!validOrigin(request, port)) return response.writeHead(403).end('Localhost access only');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' ws://${request.headers.host}; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`);
    if (request.method !== 'GET') return response.writeHead(405).end();
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/health') {
      const ready = await stat(socketPath).then(value => value.isSocket(), () => false);
      return response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ready}));
    }
    const asset = assets.get(pathname);
    if (!asset) return response.writeHead(404).end('Not found');
    try {
      const file = asset[0] === 'audio-worklet.js' ?
        (process.env.ZYNTHIAN_AUDIO_WORKLET || new URL('../../zynthian-web/static/audio-worklet.js', import.meta.url)) :
        new URL(asset[0], webRoot);
      const body = await readFile(file);
      response.writeHead(200, {'Content-Type': asset[1]+'; charset=utf-8'}).end(body);
    } catch { response.writeHead(500).end('Application asset unavailable'); }
  });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (!validOrigin(request, port, true) || !tokenMatches(url.searchParams.get('token'), token)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    if (!['/control', '/stream'].includes(url.pathname)) { socket.destroy(); return; }
    if (url.pathname === '/control' && controller?.readyState === WebSocket.OPEN) {
      socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, client => {
      if (url.pathname === '/control') { controller = client; bridgeConnection(client, socketPath); }
      else audioConnection(client, request, token);
    });
  });
  server.on('listening', () => { port = server.address().port; });
  server.on('close', () => { for (const client of sockets.clients) client.terminate(); sockets.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = (await readFile(process.env.CONTROLLER_TOKEN_FILE || '/data/access-token', 'utf8')).trim();
  const port = Number(process.env.CONTROLLER_PORT || 8766);
  const server = createControllerServer({socketPath: process.env.ZYNTHIAN_WEBVIEW_SOCKET, token, port});
  server.listen(port, '0.0.0.0', () => console.log(`Zynthian HTML interface listening on ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(); server.closeAllConnections(); setTimeout(() => process.exit(0), 500).unref();
  });
}
