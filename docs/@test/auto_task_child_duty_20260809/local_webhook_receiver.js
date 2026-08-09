const http = require('http');

const port = Number(process.argv[2] || 31987);
let events = [];

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, count: events.length }));
    return;
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.end(JSON.stringify({ ok: true, count: events.length, events }));
    return;
  }
  if (req.method === 'DELETE' && req.url === '/events') {
    events = [];
    res.end(JSON.stringify({ ok: true, count: 0 }));
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { raw };
    }
    events.push({ method: req.method, url: req.url, payload, received_at: new Date().toISOString() });
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`local webhook receiver listening on 127.0.0.1:${port}\n`);
});

function close() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
