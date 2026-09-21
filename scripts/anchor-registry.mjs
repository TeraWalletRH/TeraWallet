#!/usr/bin/env node
// Anchor published builds on chain, so the approved-build list stops being a file Tera
// can quietly rewrite.
//
//   bun run anchor:registry                  what would be anchored, and nothing else
//   bun run anchor:registry -- --send        anchor the current build
//   bun run anchor:registry -- --backfill    every release in registry.json that is missing
//
// It does nothing without --send. Anchoring is a write to a public record that can never
// be undone — a release is anchored once, and taking one back is a seven-day timelocked
// proposal — so the default is to print the plan and stop.
//
// Why --backfill exists, and why it is not optional in practice:
//
//   `anchor.js` tells a build that was never published apart from a record that has not
//   caught up by comparing the receipt's date against the most recent anchoring. That is
//   the right rule, and it has one sharp edge: the moment the second build is anchored,
//   every earlier release that was never anchored starts reporting as a build that was
//   never published — about receipts that are perfectly sound.
//
//   So the first run backfills everything in registry.json. After that, anchoring belongs
//   beside `build:registry` in the deploy, and a release that is published without being
//   anchored is a release whose receipts will eventually accuse themselves.
//
// Environment:
//   TERA_BUILD_ANCHOR_ADDRESS   the contract
//   TERA_BUILD_ANCHOR_RPC_URL   the endpoint to write through
//   TERA_BUILD_ANCHOR_KEY       the owner key, only needed with --send

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, env, exit, stdout, stderr } from "node:process";
import {
  codeHashWord,
  verifyReceiptCall,
  decodeVerifyReceipt,
  UNKNOWN,
  ANCHORED,
  MISMATCH,
  WITHDRAWN,
  STATUS_NAMES,
} from "../public/tera/core/anchor.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "public", "tera", "wallet", "manifest.json");
const modelPath = join(root, "public", "tera", "model", "manifest.json");
const registryPath = join(root, "public", "tera", "registry.json");

// anchorBuild(bytes32 codeHash, bytes32 modelHash)
const ANCHOR_BUILD = "0x44181249";
const ZERO_WORD = "0".repeat(64);

const flags = new Set(argv.slice(2).filter((arg) => arg.startsWith("--")));
const contract = env["TERA_BUILD_ANCHOR_ADDRESS"] || "";
const rpcUrl = env["TERA_BUILD_ANCHOR_RPC_URL"] || "";

if (!/^0x[\da-fA-F]{40}$/.test(contract) || !rpcUrl) {
  stderr.write(
    "Set TERA_BUILD_ANCHOR_ADDRESS and TERA_BUILD_ANCHOR_RPC_URL before anchoring anything.\n",
  );
  exit(3);
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.error.message || "the endpoint refused the call");
  return payload.result;
}

const statusOf = async (release) =>
  decodeVerifyReceipt(
    await rpc("eth_call", [{ to: contract, data: verifyReceiptCall(release) }, "latest"]),
  );

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Everything that could be anchored, newest first.
 *
 * The current build comes from the manifest rather than from the registry, because the
 * manifest is what a release id is derived from and the registry is a copy of it. When
 * the two disagree the manifest is the one to believe, and a disagreement is a reason to
 * rebuild rather than to anchor either.
 */
async function candidates() {
  const manifest = await readJson(manifestPath);
  if (!manifest?.release || !manifest?.filesHash)
    throw new Error("No build manifest to anchor. Run `bun run build:manifest` first.");

  const model = await readJson(modelPath);
  const current = {
    release: manifest.release,
    filesHash: manifest.filesHash,
    // Anchored beside the code, and zero when the build ships no on-device model. It is
    // the hash of the model this site serves, which is the only model the wallet will
    // load — not a claim about which model answered any particular turn.
    modelHash: model?.filesHash || "",
  };
  if (!flags.has("--backfill")) return [current];

  const registry = await readJson(registryPath);
  const builds = Array.isArray(registry?.builds) ? registry.builds : [];
  const seen = new Set([current.release]);
  const older = builds
    .filter((build) => build?.release && build?.filesHash && !seen.has(build.release))
    .map((build) => ({ release: build.release, filesHash: build.filesHash, modelHash: "" }));
  return [current, ...older];
}

async function main() {
  const planned = await candidates();
  const todo = [];

  for (const build of planned) {
    let state;
    try {
      state = await statusOf(build.release);
    } catch (error) {
      stderr.write(`${build.release}: could not be read — ${error.message}\n`);
      exit(3);
    }
    const name = STATUS_NAMES[state.status];
    if (state.status === ANCHORED || state.status === WITHDRAWN) {
      stdout.write(`${build.release}  already ${name}\n`);
      continue;
    }
    if (state.status === MISMATCH) {
      // The contract derives a release id from the code hash, so this cannot happen from
      // a correct anchoring. It means the local manifest and the anchored build disagree
      // about what this release is, and writing anything on top of that would make it
      // permanent.
      stderr.write(
        `${build.release}: anchored against different code than the local manifest names. Do not anchor over it; find out which build is wrong.\n`,
      );
      exit(1);
    }
    if (state.status === UNKNOWN) todo.push(build);
  }

  if (!todo.length) {
    stdout.write("Nothing to anchor.\n");
    return;
  }

  for (const build of todo)
    stdout.write(
      `${build.release}  to anchor  code ${build.filesHash}${build.modelHash ? `  model ${build.modelHash}` : "  no model"}\n`,
    );

  if (!flags.has("--send")) {
    stdout.write(
      `\n${todo.length} ${todo.length === 1 ? "build" : "builds"} would be anchored. Nothing was sent. Add --send to write them.\n`,
    );
    return;
  }

  const key = env["TERA_BUILD_ANCHOR_KEY"] || "";
  if (!/^(0x)?[\da-fA-F]{64}$/.test(key))
    throw new Error("TERA_BUILD_ANCHOR_KEY is not set to the anchoring key.");

  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  // The chain is read from the endpoint rather than configured, so this cannot be
  // pointed at one network while believing it is on another.
  const chainId = Number(await rpc("eth_chainId", []));
  const chain = {
    id: chainId,
    name: `chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const client = createWalletClient({ account, chain, transport: http(rpcUrl) });

  for (const build of todo) {
    // Encoded here rather than through an ABI object so the call is readable beside the
    // selector it uses, and so this script needs nothing from viem but the signing.
    const data = `${ANCHOR_BUILD}${codeHashWord(build.filesHash)}${build.modelHash ? codeHashWord(build.modelHash) : ZERO_WORD}`;
    const hash = await client.sendTransaction({ to: contract, data });
    stdout.write(`${build.release}  anchored in ${hash}\n`);
    // Checked against the chain rather than assumed from a receipt: a transaction that
    // was mined is not the same as a release that is now readable as anchored, and this
    // script's whole job is the second thing.
    const confirmed = await statusOf(build.release);
    if (confirmed.status !== ANCHORED)
      throw new Error(
        `${build.release} still reads as ${STATUS_NAMES[confirmed.status]} after its transaction. Do not run again until you know why.`,
      );
  }
}

// A malformed release id throws inside `verifyReceiptCall` before anything is encoded,
// which is where it should: the alternative is a call that reads the wrong six bytes and
// reports the answer as though it were about this build.
await main().catch((error) => {
  stderr.write(`${error.message}\n`);
  exit(1);
});
