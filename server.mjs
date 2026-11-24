import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const localPath = path => fileURLToPath(new URL(path, import.meta.url));
let lastRender;
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/flute-loop.wav',['flute-loop.wav','audio/wav']],
  ['/reference-spectrum.png',['reference-spectrum.png','image/png']],
  ['/krishna.wav', ['datasets/reels_data/audio/krishna_theme.wav', 'audio/wav']],
  ['/record', ['record.html', 'text/html']],
  ['/record.html', ['record.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ...['app', 'pitch', 'pitch-worklet', 'record', 'practice', 'krishna-score', 'practice-library','assistant','flow','import-song','melody-worker'].map((name) => ['/' + name + '.mjs', [name + '.mjs', 'text/javascript']])
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/dictate') {
    if (request.method !== 'POST' || request.headers.origin !== 'http://'+request.headers.host ||
        !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host)) return response.writeHead(403).end();
    try {
      const {stdout} = await run('powershell.exe',['-NoProfile','-File',localPath('dictate.ps1')],{timeout:18000,windowsHide:true});
      response.writeHead(200,{'Content-Type':'text/plain'}).end(stdout.trim());
    } catch { response.writeHead(503).end(); }
    return;
  }
  if (url.pathname === '/transposed.wav') {
    const cents = Number(url.searchParams.get('cents'));
    if (!Number.isInteger(cents) || Math.abs(cents)>2400) return response.writeHead(400).end();
    try {
      if (lastRender?.cents !== cents) {
        const job = run('python',[localPath('transpose_reference.py'),localPath('datasets/reels_data/audio/krishna_theme.wav'),String(2**(cents/1200))],{encoding:'buffer',maxBuffer:4e6});
        lastRender = {cents,job};
      }
      const {stdout} = await lastRender.job;
      response.writeHead(200,{'Content-Type':'audio/wav','Content-Length':stdout.length}).end(stdout);
    } catch { lastRender = undefined; response.writeHead(503).end(); }
    return;
  }
  const file = files.get(request.url?.split('?')[0]);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  const [name, type] = file;
  try {
    const body = await readFile(new URL('./' + name, import.meta.url));
    response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(body);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(Number(process.env.FLUTE_PORT ?? 4173), '127.0.0.1', () => {
  console.log('Open http://localhost:' + server.address().port);
});

