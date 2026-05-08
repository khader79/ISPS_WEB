const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const port = 8081;

const mimes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/esp32-simulator.html';
  const file = path.join(root, url);
  const ext = path.extname(file);
  fs.readFile(file, (err, data) => {
    if (err) {
      console.error('404', req.url);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + req.url);
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimes[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log('Serving on http://localhost:' + port + '/esp32-simulator.html');
});
