import assert from "node:assert/strict";

try {
  const { migrateSites, getSite, getInput } =
    await import("../../src/services/database/sites.js");
  const { eventsSince } = await import("../../src/services/database/events.js");
  const { closeDatabase } =
    await import("../../src/services/database/connection.js");
  try {
    await migrateSites();
    const site = await getSite(process.env.VISITGRAM_CONTRACT_SITE_ID!);
    assert.equal(site?.templateClick, "{element}");
    assert.equal(
      (await getInput(process.env.VISITGRAM_CONTRACT_OWNER!))?.draft,
      "{action}",
    );
    const events = await eventsSince(site!.id, 0);
    assert.equal(events.length, 7);
    assert.ok(events.every((event) => event.status === "pending"));
    console.log("Fresh-process persistence check passed");
  } finally {
    await closeDatabase();
  }
} catch {
  console.log("Fresh-process persistence check failed");
  process.exitCode = 1;
}
