/**
 * build-sitemap.ts — regenerates `public/sitemap.xml` from `src/config/states.ts`.
 *
 *   node scripts/build-sitemap.ts
 *
 * Generated rather than hand-maintained so enabling or disabling a state cannot
 * leave the sitemap advertising a page that 404s, or hiding one that works.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ENABLED_STATES } from "../src/config/states.ts";

const SITE = "https://www.humanbeinginformed.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = path.join(ROOT, "public", "sitemap.xml");

async function main(): Promise<void> {
  const slugs = ENABLED_STATES.map((s) => s.slug).sort();
  const urls = ["", ...slugs].map((slug) => `  <url>\n    <loc>${SITE}/${slug}</loc>\n  </url>`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

  await fs.writeFile(OUT_FILE, xml, "utf8");
  console.log(`[build-sitemap] wrote ${urls.length} URLs (homepage + ${slugs.length} states)`);
}

main().catch((err) => {
  console.error("[build-sitemap] FAILED:", err);
  process.exit(1);
});
