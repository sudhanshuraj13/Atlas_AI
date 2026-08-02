import http from "node:http";

/**
 * Lightweight HTTP server for 24/7 cloud hosting platforms (Render, Railway, Fly.io).
 * Provides /health check and keep-alive endpoints (Law 13).
 */
export function startHealthServer(
  port: number = Number(process.env.PORT) || 3000
): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";

    if (url === "/health" || url === "/") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "Atlas AI Telegram Bot",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  server.listen(port, () => {
    console.log(`🌐 Health server active on port ${port} (Endpoints: GET /health, GET /)`);
  });

  return server;
}
