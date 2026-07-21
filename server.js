// ESP32-CAM Relay Server
// Two WebSocket "doors":
//   /esp32   -> only the camera connects here, sends JPEG frames
//   /viewer  -> anyone watching connects here, receives JPEG frames
//
// The server does almost no work: it just takes each frame the
// camera sends and immediately re-sends it to every connected viewer.

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ESP32-CAM relay is running.\n');
});

// Two separate WebSocket servers sharing the same HTTP server,
// distinguished by URL path.
const camWSS = new WebSocket.Server({ noServer: true });
const viewerWSS = new WebSocket.Server({ noServer: true });

let viewers = new Set();
let camSocket = null;

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/esp32') {
    camWSS.handleUpgrade(req, socket, head, (ws) => {
      camWSS.emit('connection', ws, req);
    });
  } else if (req.url === '/viewer') {
    viewerWSS.handleUpgrade(req, socket, head, (ws) => {
      viewerWSS.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

camWSS.on('connection', (ws) => {
  console.log('ESP32-CAM connected');
  camSocket = ws;

  ws.on('message', (frame) => {
    // frame is one JPEG image as raw binary data.
    // Forward it to every connected viewer, as-is, immediately.
    for (const viewer of viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(frame);
      }
    }
  });

  ws.on('close', () => {
    console.log('ESP32-CAM disconnected');
    camSocket = null;
  });
});

viewerWSS.on('connection', (ws) => {
  console.log('Viewer connected. Total viewers:', viewers.size + 1);
  viewers.add(ws);

  ws.on('close', () => {
    viewers.delete(ws);
    console.log('Viewer disconnected. Total viewers:', viewers.size);
  });
});

server.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
});
