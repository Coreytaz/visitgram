import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

const normalize = (value: string) => value.trim().replace(/^::ffff:/i, "");

// Trust only explicitly listed proxy addresses (a local reverse proxy by default).
export function clientIp(req: IncomingMessage): string {
  const peer = normalize(req.socket.remoteAddress || "");
  const trusted = new Set(
    (process.env.VISITGRAM_TRUSTED_PROXIES ?? "127.0.0.1,::1")
      .split(",")
      .map(normalize)
      .filter((ip) => isIP(ip)),
  );
  const header = req.headers["x-forwarded-for"];
  if (!trusted.has(peer) || typeof header !== "string") return peer;
  const chain = header.split(",").map(normalize);
  if (!chain.length || chain.some((ip) => !isIP(ip))) return peer;
  let address = peer;
  for (let i = chain.length - 1; i >= 0 && trusted.has(address); i--)
    address = chain[i];
  return address;
}
