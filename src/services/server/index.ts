import http from "node:http";
import { closeDatabase } from "../database/connection.js";
import { startTelegram, stopTelegram } from "./telegram.js";
import {
  handleTracking,
  initTracking,
  cleanTracking,
  stopTracking,
} from "./tracking.js";

try {
  await initTracking();
} catch {
  console.error(
    "Database initialization or migration failed; server not started",
  );
  await closeDatabase();
  process.exit(1);
}
startTelegram();
const port = Number(process.env.VISITGRAM_PORT_SERVER ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid VISITGRAM_PORT_SERVER");

const server = http.createServer((req, res) => {
  void route(req, res).catch(() => {
    if (!res.headersSent)
      res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  });
});

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  if (await handleTracking(req, res)) return;
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

const cleanup = setInterval(
  () => {
    void cleanTracking().catch(() =>
      console.error("Event retention cleanup failed"),
    );
  },
  24 * 60 * 60 * 1000,
);

server.listen(port, () =>
  console.log(
    `Visitgram is running on port ${(server.address() as { port: number }).port}`,
  ),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    setTimeout(() => process.exit(0), 15000).unref();
    clearInterval(cleanup);
    await stopTracking();
    await stopTelegram();
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  });
}
