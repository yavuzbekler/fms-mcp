import http from "node:http";
import { getHealthData } from "./tools/health-check.js";
import { logger } from "./lib/logger.js";

let server: http.Server | undefined;

export function startHealthServer(port: number): http.Server {
  server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      try {
        const data = await getHealthData();
        const body = JSON.stringify(data);
        res.writeHead(data.status === "unhealthy" ? 503 : 200, {
          "Content-Type": "application/json",
        });
        res.end(body);
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unhealthy", error: "health check failed" }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info({ port }, "HTTP health server started");
  });

  return server;
}

export function stopHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
