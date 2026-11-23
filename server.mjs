import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/record', ['record.html', 'text/html']],
  ['/record.html', ['record.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ...['app', 'pitch', 'pitch-worklet', 'record'].map((name) => ['/' + name + '.mjs', [name + '.mjs', 'text/javascript']])
]);

const server = createServer(async (request, response) => {
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

