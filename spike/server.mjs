import http from 'node:http';
import fs from 'node:fs';

const ROOT = '/home/naroxeno/main/kindle-dsh/spike';
const PUB = ROOT + '/public';
const REP = ROOT + '/reports';
fs.mkdirSync(REP, { recursive: true });

const tpl = fs.readFileSync(PUB + '/index.html', 'utf8');
const ex = fs.readFileSync(PUB + '/svg-ex.html', 'utf8');
const px = fs.readFileSync(PUB + '/svg-px.html', 'utf8');
const f2 = fs.readFileSync(PUB + '/svg-f2.html', 'utf8');
const mathsvg = fs.readFileSync(PUB + '/math.svg');
const appjs = fs.readFileSync(PUB + '/app.js');

const PORT = 8090;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
  const now = new Date();
  return tpl
    .replace('{{EX}}', ex)
    .replace('{{PX}}', px)
    .replace('{{F2}}', f2)
    .replace('{{SERVER_MS}}', String(now.getTime()))
    .replace('{{SERVER_TIME}}', now.toString())
    .replace('{{IP}}', esc(ip))
    .replace('{{UA_ESC}}', esc(ua).replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
    .replace('{{UA}}', esc(ua));
}

function send(res, code, type, body) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > 1 << 20) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const ua = req.headers['user-agent'] || '';
  const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
  console.log(new Date().toISOString(), req.method, url, ip, JSON.stringify(ua).slice(0, 90));

  try {
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      return send(res, 200, 'text/html; charset=utf-8', render(req));
    }
    if (req.method === 'GET' && url === '/app.js') {
      return send(res, 200, 'application/javascript; charset=utf-8', appjs);
    }
    if (req.method === 'GET' && url === '/math.svg') {
      return send(res, 200, 'image/svg+xml; charset=utf-8', mathsvg);
    }
    if (req.method === 'GET' && url === '/ping') {
      return send(res, 200, 'text/plain; charset=utf-8', 'pong');
    }
    if (req.method === 'POST' && url === '/report') {
      const raw = await readBody(req);
      let obj;
      try { obj = JSON.parse(raw); } catch (e) { obj = { parseError: e.message, raw }; }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = REP + '/report-' + stamp + '-' + ip + '.json';
      fs.writeFileSync(file, JSON.stringify({ ip, receivedAt: new Date().toISOString(), headers: req.headers, body: obj }, null, 2));
      fs.writeFileSync(REP + '/latest.json', JSON.stringify({ ip, receivedAt: new Date().toISOString(), headers: req.headers, body: obj }, null, 2));
      console.log('--- REPORT from', ip, 'ua=', JSON.stringify(ua));
      if (obj && obj.lines) for (const l of obj.lines) console.log('   ', l);
      return send(res, 200, 'text/plain; charset=utf-8', 'ok');
    }
    if (req.method === 'POST' && url === '/echo') {
      const raw = await readBody(req);
      return send(res, 200, 'text/plain; charset=utf-8', raw);
    }
    if (req.method === 'GET' && url === '/reports') {
      let body = 'no reports yet';
      try { body = fs.readFileSync(REP + '/latest.json', 'utf8'); } catch (e) { /* none */ }
      return send(res, 200, 'text/plain; charset=utf-8', body);
    }
    send(res, 404, 'text/plain; charset=utf-8', 'not found');
  } catch (err) {
    console.error('ERR', err);
    send(res, 500, 'text/plain; charset=utf-8', 'server error: ' + err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('kindle spike listening on http://0.0.0.0:' + PORT + ' (LAN: http://192.168.10.40:' + PORT + '/)');
});
