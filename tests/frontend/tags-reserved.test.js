import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RESERVED, skeleton } from "../../public/tera/core/tags.js";

const published = JSON.parse(
  await readFile(fileURLToPath(new URL("../../contracts/reserved-tags.json", import.meta.url))),
);

test("the published reserved list matches the one the wallet enforces", () => {
  // The wallet refusing `@support` means nothing on its own: TagRegistry.claim
  // can be called directly. This file is what gets seeded on-chain, so a name
  // added to tags.js and not re-published is a name anyone can still take.
  assert.deepEqual(published.tags, [...RESERVED].sort(), "run: bun run build:reserved-tags");
});

test("no two reserved names fold to the same skeleton", () => {
  // Not a correctness bug on-chain — the second write is a no-op — but it does
  // mean the list is claiming to withhold more names than it does.
  const seen = new Map();
  for (const tag of published.tags) {
    const folded = skeleton(tag);
    assert.equal(seen.has(folded), false, `${tag} folds onto ${seen.get(folded)}`);
    seen.set(folded, tag);
  }
});
