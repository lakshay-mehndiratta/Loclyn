import http from "node:http";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Fake Backend (pretend Express)", path: req.url }));
});

server.listen(3000, () => console.log("[demo] fake backend listening on :3000"));