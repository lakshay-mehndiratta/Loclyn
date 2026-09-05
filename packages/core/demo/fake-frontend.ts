import http from "node:http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<html><body><h1>Fake Frontend (pretend Vite)</h1><p>Path: ${req.url}</p></body></html>`);
});

// Minimal stand-in for Vite's HMR WebSocket. Real Vite exposes this at a
// specific path (e.g. /@vite/hmr) — we're not replicating Vite's actual
// protocol, just proving a WebSocket connection can be opened, held open,
// and used to push messages, the same shape of thing HMR relies on.
const wss = new WebSocketServer({ server, path: "/hmr" });

wss.on("connection", (socket) => {
  console.log("[demo] fake frontend: HMR client connected");

  socket.send(JSON.stringify({ type: "connected", message: "HMR socket open" }));

  const interval = setInterval(() => {
    socket.send(JSON.stringify({ type: "update", message: "pretend file changed", time: Date.now() }));
  }, 5000);

  socket.on("close", () => {
    console.log("[demo] fake frontend: HMR client disconnected");
    clearInterval(interval);
  });
});

server.listen(5173, "127.0.0.1", () => console.log("[demo] fake frontend listening on :5173 (HTTP + WS at /hmr)"));