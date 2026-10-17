import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_CONNECT, inlineScripts, policyFor, surfaceFor } from "../../src/lib/csp.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directive = (policy, name) =>
  policy.split("; ").find((d) => d.split(" ")[0] === name)?.split(" ").slice(1) ?? null;
const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
const pages = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pages(path) : name === "index.html" ? [path] : [];
  });

test("only /app and the dashboard get a policy", () => {
  assert.equal(surfaceFor("/app"), "app");
  assert.equal(surfaceFor("/app/"), "app");
  assert.equal(surfaceFor("/dashboard/receipts"), "dashboard");
  assert.equal(surfaceFor("/"), null);
  assert.equal(surfaceFor("/apps"), null);
  assert.equal(surfaceFor("/admin"), null);
});

test("inline scripts are allowed by the hash of their exact text; JSON data blocks aren't scripts", async () => {
  const html = `<script>one()</script><script type="module">two()</script>
    <script src="/x.js"></script><script id="tera-config" type="application/json">{"a":1}</script>`;
  assert.deepEqual(inlineScripts(html), ["one()", "two()"]);
  const scripts = directive(await policyFor("app", html), "script-src");
  assert.deepEqual(scripts, ["'self'", hash("one()"), hash("two()")]);
  assert.ok(!scripts.includes("'unsafe-inline'"));
  assert.ok(!scripts.includes("'unsafe-eval'"));
});

test("/app connects only to the API, the four nodes and the explorer", async () => {
  const policy = await policyFor("app", "", { connect: ["https://api.example.org/v1", "not a url"] });
  assert.deepEqual(directive(policy, "connect-src"), ["'self'", ...APP_CONNECT, "https://api.example.org"]);
  assert.deepEqual(directive(policy, "frame-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "base-uri"), ["'none'"]);
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
});

test("every host the app is configured to call is allowed", () => {
  const config = readFileSync(join(root, "android/src/config.ts"), "utf8");
  const explorer = readFileSync(join(root, "android/src/explorer.ts"), "utf8");
  const hosts = new Set(
    [...`${config}\n${explorer}`.matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => new URL(m[0]).origin),
  );
  assert.ok(hosts.size >= 5);
  for (const host of hosts) assert.ok(APP_CONNECT.includes(host), `${host} missing from APP_CONNECT`);
});

test("the dashboard keeps scripts locked but may reach WalletConnect's hosts", async () => {
  const policy = await policyFor("dashboard", "<script>x()</script>");
  assert.deepEqual(directive(policy, "script-src"), ["'self'", "'wasm-unsafe-eval'", hash("x()")]);
  assert.deepEqual(directive(policy, "connect-src"), ["'self'", "https:", "wss:"]);
  assert.ok(directive(policy, "frame-src").includes("https://verify.walletconnect.org"));
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
});

test("the real pages: no inline event handlers, and every inline script is hashed", async () => {
  const files = [join(root, "src/site/app/index.html"), ...pages(join(root, "src/site/dashboard"))];
  assert.ok(files.length > 5);
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=\s*["']/i, `${file} has an inline event handler`);
    const policy = await policyFor(file.includes("/site/app/") ? "app" : "dashboard", html);
    for (const script of inlineScripts(html)) assert.ok(policy.includes(hash(script)), file);
  }
  const gallery = readFileSync(join(root, "public/tera/wallet/gallery.js"), "latin1");
  assert.doesNotMatch(gallery, /\sonerror\s*=/);
});
