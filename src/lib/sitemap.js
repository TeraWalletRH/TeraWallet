// /sitemap.xml: every public page of terawallet.app, built from the same
// src/site/**/index.html files site-pages.ts serves, so a new page is listed
// the day it ships and a removed one drops out.
//
// Left out: the admin console and the dashboard (signed-in tools, not pages
// to find), the 404 page, anything marked noindex, and pages that only
// redirect elsewhere.

export const SITE = "https://terawallet.app";

const PRIVATE = /^\/(?:admin|dashboard|404)(?:\/|$)/;

/** "../site/legal/terms-of-service/index.html" -> "/legal/terms-of-service/" */
export function pathFor(key) {
  const inner = key.replace(/^(?:\.\.\/)?(?:src\/)?site\/?/, "").replace(/index\.html$/, "");
  return `/${inner}`;
}

export function listed(path, html) {
  if (PRIVATE.test(path)) return false;
  if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) return false;
  if (/<meta[^>]+http-equiv=["']refresh["']/i.test(html)) return false;
  return true;
}

const escape = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
  );

/** The sitemap for these paths, the home page first, the rest in order. */
export function sitemapXml(paths) {
  const sorted = [...new Set(paths)].sort((a, b) =>
    a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b),
  );
  const urls = sorted.map((path) => `  <url><loc>${escape(SITE + path)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
