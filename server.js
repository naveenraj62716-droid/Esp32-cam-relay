/*
  ESP32-CAM Relay Server
  -----------------------
  Two WebSocket "doors":
    /esp32   <- the camera connects here and sends binary JPEG frames
    /viewer  <- browsers connect here and receive those same frames

  Whenever a frame arrives on /esp32, it is immediately re-broadcast
  to every client currently connected on /viewer. Also serves a
  simple viewer.html page at "/" so you can just open the Render URL
  in a browser and watch the stream directly.

  Deploy: push this to your existing Render service (same one your
  ESP32 already points to). Render will run `node server.js`.
*/

const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// Serve the viewer page and any static assets
app.use(express.static(path.join(__dirname, "public")));

// Two separate WebSocket servers sharing the same HTTP server,
// distinguished by path.
const camWss = new WebSocket.Server({ noServer: true });
const viewerWss = new WebSocket.Server({ noServer: true });

const viewers = new Set();
let camSocket = null;
let frameCount = 0;

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === "/esp32") {
    camWss.handleUpgrade(request, socket, head, (ws) => {
      camWss.emit("connection", ws, request);
    });
  } else if (pathname === "/viewer") {
    viewerWss.handleUpgrade(request, socket, head, (ws) => {
      viewerWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

camWss.on("connection", (ws) => {
  console.log("[esp32] camera connected");
  camSocket = ws;

  ws.on("message", (data, isBinary) => {
    if (!isBinary) return; // ignore any stray text frames
    frameCount++;

    // Broadcast this JPEG frame to every connected viewer
    for (const viewer of viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(data, { binary: true });
      }
    }
  });

  ws.on("close", () => {
    console.log("[esp32] camera disconnected");
    if (camSocket === ws) camSocket = null;
  });

  ws.on("error", (err) => {
    console.log("[esp32] error:", err.message);
  });
});

viewerWss.on("connection", (ws) => {
  console.log("[viewer] browser connected. total viewers:", viewers.size + 1);
  viewers.add(ws);

  ws.on("close", () => {
    viewers.delete(ws);
    console.log("[viewer] browser disconnected. total viewers:", viewers.size);
  });

  ws.on("error", (err) => {
    console.log("[viewer] error:", err.message);
  });
});

// Simple status endpoint, handy for debugging from a phone browser
app.get("/status", (req, res) => {
  res.json({
    camera_connected: camSocket !== null,
    viewer_count: viewers.size,
    frames_relayed: frameCount,
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay listening on port ${PORT}`);
});
