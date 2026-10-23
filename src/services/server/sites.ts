export * from "./site-types.js";
export * from "../database/sites.js";
export { notificationsEnabled } from "./event-types.js";
export function trackerSnippet(id: string) {
  const base = new URL(
    process.env.VISITGRAM_PUBLIC_URL || "http://localhost:3000",
  );
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error(
      "VISITGRAM_PUBLIC_URL должен быть HTTP/HTTPS origin без пути и пароля.",
    );
  return `<script defer src="${base.origin}/tracker.js" data-site-id="${id}"></script>`;
}
