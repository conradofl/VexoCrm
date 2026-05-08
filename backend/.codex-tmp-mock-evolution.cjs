const http = require('http');
const fs = require('fs');
const path = 'C:/Users/W11/Desktop/Vexo/VexoCrm/backend/.codex-tmp-mock-evolution.log';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let parsed = body;
    try { parsed = body ? JSON.parse(body) : null; } catch {}
    fs.appendFileSync(path, JSON.stringify({ method: req.method, url: req.url, body: parsed, at: new Date().toISOString() }) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(4010, '127.0.0.1');
setInterval(() => {}, 1000);
