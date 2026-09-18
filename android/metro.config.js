// Metro resolution for the shared core.
//
// Feature logic lives once, in public/tera/core/, and both surfaces import it:
// the browser fetches it from /tera/core/, and this app bundles it from disk.
// Before this, android/src/minimise.ts was a hand-written parallel of the web's
// minimise.js — two copies of the same privacy rules and the same user-facing
// copy, free to drift. A limit reworded on one surface and not the other is a
// false statement on the other, which is the one failure this product cannot
// afford.
//
// `watchFolders` is what lets Metro read a path outside the project root at
// all; without it the import resolves to nothing and the bundle fails loudly,
// which is the right way for this to break.

const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");
const core = path.resolve(repoRoot, "public", "tera", "core");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders || []), core];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

module.exports = config;
