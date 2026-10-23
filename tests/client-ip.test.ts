import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { clientIp } from "../src/services/server/client-ip.js";

test("client IP follows only trusted proxy hops", () => {
  const original = process.env.VISITGRAM_TRUSTED_PROXIES;
  const request = (peer: string, forwarded?: string) =>
    ({
      socket: { remoteAddress: peer },
      headers: { "x-forwarded-for": forwarded },
    }) as unknown as IncomingMessage;
  try {
    delete process.env.VISITGRAM_TRUSTED_PROXIES;
    assert.equal(
      clientIp(request("::ffff:127.0.0.1", "203.0.113.7")),
      "203.0.113.7",
    );
    assert.equal(clientIp(request("::1", "2001:db8::1")), "2001:db8::1");
    assert.equal(clientIp(request("203.0.113.7", "1.1.1.1")), "203.0.113.7");
    assert.equal(
      clientIp(request("127.0.0.1", "1.1.1.1, 203.0.113.7")),
      "203.0.113.7",
    );
    assert.equal(clientIp(request("127.0.0.1", "invalid")), "127.0.0.1");
    assert.equal(clientIp(request("127.0.0.1")), "127.0.0.1");
    process.env.VISITGRAM_TRUSTED_PROXIES = "127.0.0.1,10.0.0.2";
    assert.equal(
      clientIp(request("127.0.0.1", "203.0.113.7, 10.0.0.2")),
      "203.0.113.7",
    );
    process.env.VISITGRAM_TRUSTED_PROXIES = "";
    assert.equal(clientIp(request("127.0.0.1", "203.0.113.7")), "127.0.0.1");
  } finally {
    if (original === undefined) delete process.env.VISITGRAM_TRUSTED_PROXIES;
    else process.env.VISITGRAM_TRUSTED_PROXIES = original;
  }
});
