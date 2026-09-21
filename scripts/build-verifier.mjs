#!/usr/bin/env node
// Build the offline receipt verifier: one HTML file, openable from disk.
//
// The page is assembled rather than served so it can be used with the network
// off. Everything it runs is inlined — the bundle built from the wallet's own
// receipt, verdict and report modules — and there is no fetch, no CDN and no
// import of anything outside the file. A verifier that reaches the network to do
// its job can be changed by whoever answers that request, which is the party it
// exists to check.
//
// The bundle is produced by vite rather than pasted together here. `receipt.js`
// and `verdict.js` both define the four state constants, so concatenating them
// into one scope is a redeclaration; rollup renames them correctly, and a build
// script guessing at that is one rename away from shipping a page that throws on
// open with nobody watching a console.
//
//   bun run build:verifier   ->   public/tera/verify.html

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const core = join(root, "public", "tera", "core");
const output = join(root, "public", "tera", "verify.html");
const bundle = join(root, "build", "verify", "verifier.js");

// Listed in the page's footer with their hashes. These are the files a reader
// checks the bundle against, so the list has to be every source it was built
// from, not the interesting subset.
const SOURCES = [
  ["core/receipt.js", join(core, "receipt.js")],
  ["core/verdict.js", join(core, "verdict.js")],
  ["core/registry.js", join(core, "registry.js")],
  ["core/anchor.js", join(core, "anchor.js")],
  ["core/report.js", join(core, "report.js")],
  ["src/verify/verifier.js", join(root, "src", "verify", "verifier.js")],
];

const esc = (value) =>
  String(value).replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
  );

const PAGE = (script, built, sources) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tera receipt verifier (offline)</title>
<style>
:root { color-scheme: light }
* { box-sizing: border-box }
body { margin:0; background:#f2f0ee; color:#18251e; font:15px/1.65 Inter,Arial,sans-serif }
main { max-width:860px; margin:auto; padding:32px 20px 80px }
h1 { font-size:clamp(28px,4vw,42px); font-weight:450; letter-spacing:-1.6px; margin:0 0 8px }
.mono,.eyebrow,th,.mark { font-family:"IBM Plex Mono","Courier New",monospace }
.eyebrow { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:#68734f }
.lead { color:#5c6857; max-width:62ch }
.drop { border:1px dashed #9aa787; background:#e9ecdf; padding:38px 24px; text-align:center; margin:26px 0 }
.drop.over { border-color:#4c622f; background:#e0e6cd }
.drop input { display:block; margin:14px auto 0; max-width:100% }
.note { padding:14px 16px; border-left:2px solid #a2ac7a; background:#e7eadc; font-size:13px; margin:20px 0 }
.note.heavy { border-left-color:#945f3d }
.headline { font-size:19px; line-height:1.5; margin:26px 0 6px }
.table-scroll { overflow-x:auto }
table { border-collapse:collapse; width:100%; font-size:13px; margin-top:10px }
th { text-align:left; font-size:11px; text-transform:uppercase; font-weight:400; color:#6c7663; padding:14px 10px; border-bottom:1px solid #9eab8f }
td { padding:15px 10px; border-bottom:1px solid #ccd2c1; vertical-align:top }
.mark { font-size:11px; white-space:nowrap }
.pass { color:#566b3e } .fail { color:#945f3d } .unverifiable { color:#8a6d2f } .skipped { color:#77806f }
.claims td:first-child { color:#6b7663; white-space:nowrap }
.section { text-transform:uppercase; font:12px/1.5 monospace; margin:34px 0 0 }
footer { margin-top:44px; border-top:1px solid #bdc5b5; padding-top:18px; font-size:12px; color:#6c7763 }
footer .mono { font-size:11px; overflow-wrap:anywhere }
code { background:#e2e5d5; padding:2px 5px; font-size:12px; overflow-wrap:anywhere }
[hidden] { display:none !important }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Tera Wallet</p>
  <h1>Receipt verifier</h1>
  <p class="lead">Drop a receipt file here to check it. This page does the checking itself, with the
  same code the wallet uses. Nothing is uploaded, and once this file is saved to disk it works with
  the network switched off &mdash; which is the point. The page that wrote a receipt is the one
  thing that cannot vouch for it.</p>

  <div class="drop" id="drop">
    <b>Drop a receipt file</b>
    <input type="file" id="file" accept="application/json,.json">
  </div>

  <details class="optional">
    <summary>Check the release against an approved-build registry (optional)</summary>
    <p>A receipt names the build that produced it. On its own that name proves nothing &mdash; any
    file can claim any release. Give this page a registry you fetched yourself and the name becomes
    checkable: a release absent from the list was never published.</p>
    <p>The wallet fetching its own copy of that list is not a second opinion, which is why this
    belongs here and not there.</p>
    <label>Registry file <input type="file" id="registry" accept="application/json,.json"></label>
    <label>Signer address you expect <input type="text" id="signer" placeholder="0x&hellip;" spellcheck="false"></label>
    <p class="micro">Without the signer address the list is read but not authenticated, and the
    release check stays unproven &mdash; an unsigned list is one anybody could have written.</p>
  </details>

  <div id="out" hidden></div>

  <footer>
    <p>Built ${esc(built)}. The bundle in this page was compiled from these sources, and the hash of
    each is listed so you can check this page against the published repository rather than trusting
    the copy you were handed:</p>
    <p class="mono">${sources.map((entry) => `${esc(entry.name)} &nbsp;sha256-${esc(entry.hash)}`).join("<br>")}</p>
    <p>Check one yourself: <code>openssl dgst -binary -sha256 public/tera/core/receipt.js | openssl base64 -A</code></p>
    <p>There is also a command-line version that runs the same checks:
    <code>node scripts/verify-receipt.mjs receipt.json</code></p>
  </footer>
</main>

<script type="module">
${script}

const { check } = globalThis.TeraVerify;
const out = document.getElementById("out");
const drop = document.getElementById("drop");
const esc = (value) => String(value ?? "").replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" })[c]);

function render({ summary, rows, claims, registryNote }) {
  out.hidden = false;
  out.innerHTML = \`
    <p class="headline"><b class="\${summary.status}">\${esc(summary.line)}</b></p>
    \${registryNote ? \`<div class="note">\${esc(registryNote)}</div>\` : ""}
    \${summary.status === "fail" ? '<div class="note heavy"><b>Do not rely on this file.</b> A failed check means the receipt does not describe the turn it claims to.</div>' : ""}
    <p class="section">Checks</p>
    <div class="table-scroll"><table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>
    \${rows.map((row) => \`<tr><td><b>\${esc(row.label)}</b></td><td class="mark \${row.status}">\${esc(row.mark.toUpperCase())}</td><td>\${esc(row.detail)}</td></tr>\`).join("")}
    </tbody></table></div>
    \${claims.length ? \`<p class="section">What the file states about itself</p>
      <div class="table-scroll"><table class="claims"><tbody>\${claims.map((entry) => \`<tr><td>\${esc(entry.label)}</td><td>\${esc(entry.value)}</td></tr>\`).join("")}</tbody></table></div>
      <div class="note">None of the rows above is checked by this page. They are the file's own claims, and a modified build writes whatever it likes into them.</div>\` : ""}\`;
  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The registry and the signer are read at the moment a receipt is checked, not
// stored, so changing either and dropping the file again re-runs everything.
const registryText = async () => {
  const [file] = document.getElementById("registry").files || [];
  return file ? file.text() : "";
};

const read = (file) =>
  Promise.all([file.text(), registryText()])
    .then(([raw, registry]) =>
      check(raw, registry, document.getElementById("signer").value.trim()),
    )
    .then(render)
    .catch((error) => {
      out.hidden = false;
      out.innerHTML = '<p class="headline"><b class="fail">' + esc(error.message) + "</b></p>";
    });

document.getElementById("file").addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) void read(file);
});
for (const name of ["dragenter", "dragover"])
  drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("over"); });
for (const name of ["dragleave", "drop"])
  drop.addEventListener(name, () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  const [file] = event.dataTransfer?.files || [];
  if (file) void read(file);
});
</script>
</body>
</html>
`;

async function main() {
  // Built here rather than assumed, so running this on a clean checkout cannot
  // quietly inline a stale bundle from an earlier build.
  // vite's JS entry under the current node, rather than the `vite` shim: on
  // Windows that shim is a .cmd, which execFileSync refuses to spawn without a
  // shell, and passing arguments through a shell is how paths with spaces break.
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--config",
      "vite.verify.config.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const sources = [];
  for (const [name, path] of SOURCES) {
    const source = await readFile(path);
    sources.push({ name, hash: createHash("sha256").update(source).digest("base64") });
  }

  const script = await readFile(bundle, "utf8");
  if (/^\s*import\s/m.test(script))
    throw new Error("The bundle still imports something. The page would fetch it at open time.");

  const page = PAGE(script, new Date().toISOString().slice(0, 10), sources);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, page, "utf8");
  console.log(
    `Wrote public/tera/verify.html (${(Buffer.byteLength(page) / 1024).toFixed(0)} kB, no network requests).`,
  );
}

await main();
