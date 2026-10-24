import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createControllerServer} from '../server.mjs';

test('localhost/token boundary and single-client native bridge', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'controller-node-'));
  const socketPath = join(directory,'control.sock'), token='test-token-'.repeat(4);
  const commands=[], connections=new Set();
  const native=net.createServer(socket=>{
    connections.add(socket); socket.on('close',()=>connections.delete(socket));
    socket.on('data',data=>{
      for (const line of data.toString().trim().split('\n')) {
        const command=JSON.parse(line); commands.push(command);
        socket.write(JSON.stringify({id:command.id,ok:true,state:{protocol:1,revision:'r1',screen:'main_menu',items:[]}})+'\n');
      }
    });
  });
  native.listen(socketPath); await once(native,'listening');
  const server=createControllerServer({socketPath,token,port:0});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port, origin=`http://127.0.0.1:${port}`;
  const clients=[];
  t.after(async()=>{
    for(const client of clients) client.terminate();
    for(const socket of connections) socket.destroy();
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>native.close(resolve));
    await rm(directory,{recursive:true});
  });
  assert.equal((await fetch(origin+'/health')).status,200);
  const badHost = await new Promise(resolve => http.get(origin+'/', {headers:{Host:'evil.example'}}, response => {
    response.resume(); resolve(response.statusCode);
  }));
  assert.equal(badHost,403);
  assert.equal((await fetch(origin+'/',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(origin+'/server.mjs')).status,404);
  async function rejected(query, headers, status) {
    const ws=new WebSocket(`ws://127.0.0.1:${port}/control${query}`,{headers});clients.push(ws);
    const response=await new Promise(resolve=>ws.once('unexpected-response',(_,response)=>resolve(response)));
    assert.equal(response.statusCode,status);response.resume();ws.on('error',()=>{});ws.terminate();
  }
  await rejected('',{Origin:origin},403);
  await rejected('?token='+token,{Origin:'https://evil.example'},403);
  const client=new WebSocket(`ws://127.0.0.1:${port}/control?token=${token}`,{headers:{Origin:origin}});
  clients.push(client);const first=once(client,'message');await once(client,'open');await first;
  await rejected('?token='+token,{Origin:origin},409);
  const reply=once(client,'message');client.send(JSON.stringify({id:7,method:'activate',target:'a',revision:'r1'}));
  assert.equal(JSON.parse((await reply)[0]).id,7);assert.equal(commands.at(-1).target,'a');
  const closed=once(client,'close');client.send(JSON.stringify({method:'shell'}));
  assert.equal((await closed)[0],1008);
});
