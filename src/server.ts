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

    // Automatic keep-alive self-ping if running on Render/Cloud
    const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (appUrl) {
      console.log(`📡 Keep-alive self-ping configured for: ${appUrl}/health (every 10m)`);
      setInterval(async () => {
        try {
          const res = await fetch(`${appUrl}/health`);
          if (res.ok) {
            console.log(`💚 Keep-alive self-ping successful: [${res.status}]`);
          }
        } catch (err: any) {
          console.warn(`⚠️ Keep-alive self-ping failed:`, err?.message || String(err));
        }
      }, 10 * 60 * 1000); // Every 10 minutes
    }
  });

  return server;
}
