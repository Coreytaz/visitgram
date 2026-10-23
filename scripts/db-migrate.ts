try {
  const { migrateSites } = await import("../src/services/database/sites.js");
  const { closeDatabase, config } =
    await import("../src/services/database/connection.js");
  try {
    await migrateSites();
    console.log(`Database migrations complete (${config.dialect})`);
  } finally {
    await closeDatabase();
  }
} catch {
  console.error(
    "Database migration failed; check configuration and database permissions. Connection details are hidden.",
  );
  process.exitCode = 1;
}
