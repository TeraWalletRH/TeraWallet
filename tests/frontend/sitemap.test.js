import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, listed, pathFor, sitemapXml } from "../../src/lib/sitemap.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pages = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pages(path) : name === "index.html" ? [path] : [];
  });
const site = pages(join(root, "src/site")).map((file) => ({
  path: pathFor(`../${relative(join(root, "src"), file)}`),
  html: readFileSync(file, "utf8"),
}));
const paths = site.filter(({ path, html }) => listed(path, html)).map(({ path }) => path);

test("paths come from the page files, as served", () => {
  assert.equal(pathFor("../site/index.html"), "/");
  assert.equal(pathFor("../site/legal/terms-of-service/index.html"), "/legal/terms-of-service/");
});

test("the public pages are listed", () => {
  for (const path of [
    "/",
    "/about/",
    "/app/",
    "/whitepaper/",
    "/legal/privacy-policy/",
    "/delete-account/",
  ])
    assert.ok(paths.includes(path), `${path} missing`);
});

test("admin, dashboard, 404 and redirect pages are not", () => {
  assert.ok(paths.length > 10);
  for (const path of paths) assert.doesNotMatch(path, /^\/(admin|dashboard|404)(\/|$)/);
  assert.ok(!paths.includes("/legal/delete-account/"), "a redirect page is listed");
  assert.equal(listed("/x/", '<meta name="robots" content="noindex">'), false);
});

test("the XML lists each page once, home first, on www.terawallet.app", () => {
  const xml = sitemapXml([...paths, "/"]);
  assert.match(
    xml,
    /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/,
  );
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, paths.length);
  assert.equal(locs[0], `${SITE}/`);
  assert.equal(
    sitemapXml(["/a&b/"]).includes("<loc>https://www.terawallet.app/a&amp;b/</loc>"),
    true,
  );
});

test("robots.txt points to it", () => {
  assert.match(
    readFileSync(join(root, "public/robots.txt"), "utf8"),
    /^Sitemap: https:\/\/www\.terawallet\.app\/sitemap\.xml$/m,
  );
});
