// NFTs held by an account: finding them, reading what they are, and sending one.
//
// Finding them reads the chain through the connection each surface already
// uses for balances: every Transfer, TransferSingle and TransferBatch sent to
// the account, then a question to each contract about whether it is still
// held. No NFT indexer or marketplace API is involved.
//
// Pictures and metadata are loaded straight from where each token says they
// live, the way most wallets do it. IPFS addresses go through a public gateway.
// That means the gateway, or the collection's own server, sees the device's
// network address and which token it asked for. On-chain `data:` tokens are
// decoded here and nothing is fetched.
//
// Sending builds `safeTransferFrom` and nothing else. The surfaces rebuild the
// calldata from what the owner reviewed before it is signed, with
// `checkTransfer`, so a transfer that does not match the review is refused.

export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const TRANSFER_SINGLE = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
export const TRANSFER_BATCH = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

export const ERC721 = "erc721";
export const ERC1155 = "erc1155";

/** At most this many tokens are shown, newest first. Each costs reads and fetches. */
export const MAX_TOKENS = 48;

// ---------------------------------------------------------------------------
// ABI, just enough of it.
// ---------------------------------------------------------------------------

const HEX = /^0x[0-9a-f]*$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

const word = (value) => BigInt(value).toString(16).padStart(64, "0");

/** The topic an indexed address occupies in a log. */
export function addressTopic(address) {
  if (!ADDRESS.test(String(address))) throw new Error("Not an address.");
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

const topicAddress = (topic) => `0x${String(topic).slice(26).toLowerCase()}`;

function words(hex) {
  const body = String(hex || "0x").slice(2);
  const out = [];
  for (let at = 0; at + 64 <= body.length; at += 64) out.push(`0x${body.slice(at, at + 64)}`);
  return out;
}

export const call = {
  ownerOf: (token) => ({ to: token.contract, data: `0x6352211e${word(token.tokenId)}` }),
  balanceOf: (token, owner) => ({
    to: token.contract,
    data: `0x00fdd58e${addressTopic(owner).slice(2)}${word(token.tokenId)}`,
  }),
  tokenURI: (token) => ({ to: token.contract, data: `0xc87b56dd${word(token.tokenId)}` }),
  uri: (token) => ({ to: token.contract, data: `0x0e89341c${word(token.tokenId)}` }),
  name: (contract) => ({ to: contract, data: "0x06fdde03" }),
};

export function decodeAddress(hex) {
  const [first] = words(hex);
  return first ? topicAddress(first) : null;
}

export function decodeUint(hex) {
  const [first] = words(hex);
  return first ? BigInt(first) : null;
}

const MAX_STRING_BYTES = 256 * 1024;

/** An ABI-encoded `string` return value, or null if it is not one. */
export function decodeString(hex) {
  if (typeof hex !== "string" || !HEX.test(hex) || hex.length < 2 + 128) return null;
  const body = hex.slice(2);
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  if (!Number.isSafeInteger(offset) || offset * 2 + 64 > body.length) return null;
  const length = Number(BigInt(`0x${body.slice(offset * 2, offset * 2 + 64)}`));
  if (!Number.isSafeInteger(length) || length > MAX_STRING_BYTES) return null;
  const start = offset * 2 + 64;
  if (start + length * 2 > body.length) return null;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1)
    bytes[index] = parseInt(body.slice(start + index * 2, start + index * 2 + 2), 16);
  return utf8(bytes);
}

// ---------------------------------------------------------------------------
// Bytes. Written out rather than taken from the platform, because TextDecoder
// is not everywhere this runs.
// ---------------------------------------------------------------------------

/** UTF-8 to a string, replacing anything malformed. */
export function utf8(bytes) {
  let out = "";
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index];
    let code = 0xfffd;
    let size = 1;
    if (byte < 0x80) code = byte;
    else if (byte >= 0xc2 && byte < 0xe0 && index + 1 < bytes.length) {
      code = ((byte & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
      size = 2;
    } else if (byte >= 0xe0 && byte < 0xf0 && index + 2 < bytes.length) {
      code = ((byte & 0x0f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f);
      size = 3;
    } else if (byte >= 0xf0 && byte < 0xf5 && index + 3 < bytes.length) {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[index + 1] & 0x3f) << 12) |
        ((bytes[index + 2] & 0x3f) << 6) |
        (bytes[index + 3] & 0x3f);
      size = 4;
    }
    out += String.fromCodePoint(code > 0x10ffff ? 0xfffd : code);
    index += size;
  }
  return out;
}

/** A string to UTF-8. */
export function utf8Bytes(text) {
  const out = [];
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < B64.length; index += 1) table[B64.charCodeAt(index)] = index;
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

export function base64ToBytes(text) {
  const clean = String(text).replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const code = clean.charCodeAt(index);
    const digit = code < 128 ? B64_INDEX[code] : -1;
    if (digit < 0) throw new Error("Not base64.");
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

export function bytesToBase64(bytes) {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at];
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Finding the tokens.
// ---------------------------------------------------------------------------

/**
 * The log filters that find every token ever sent to `owner`. Receipt is enough
 * to find a candidate; whether it is still held is asked of the contract.
 */
export function discoveryFilters(owner) {
  const topic = addressTopic(owner);
  return [
    { topics: [TRANSFER, null, topic] },
    { topics: [TRANSFER_SINGLE, null, null, topic] },
    { topics: [TRANSFER_BATCH, null, null, topic] },
  ];
}

// What a node says when a range holds too many logs to return at once. Not a
// rate limit: "too many requests" is a reason to wait, not to split.
const TOO_MANY =
  /exceed|too many (?:logs|results|blocks)|limit of|block range|range is too|query returned more than|timed out|timeout/i;

// Failures that say nothing about the answer: the connection dropped, or the
// node asked to slow down. Worth asking again after a pause.
const TRANSIENT =
  /failed to fetch|fetch failed|network|429|too many requests|rate.?limit|could not be reached|ECONNRESET|socket/i;
const transient = (error) => TRANSIENT.test(String(error?.message || error));

/** The same read connection, asking again after a pause when the failure was transient. */
export function patient(rpc, { attempts = 4, pauseMs = 500 } = {}) {
  return async (request) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await rpc(request);
      } catch (error) {
        if (attempt >= attempts || !transient(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, pauseMs * 2 ** (attempt - 1)));
      }
    }
  };
}

/**
 * Every log matching `filter` between two blocks. A node that refuses a range
 * as too large is asked for each half instead.
 */
export async function scanLogs(rpc, filter, fromBlock, toBlock, depth = 0) {
  try {
    const logs = await rpc({
      method: "eth_getLogs",
      params: [
        {
          ...filter,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
        },
      ],
    });
    return Array.isArray(logs) ? logs : [];
  } catch (error) {
    if (depth >= 24 || toBlock <= fromBlock || !TOO_MANY.test(String(error?.message || error)))
      throw error;
    const middle = fromBlock + Math.floor((toBlock - fromBlock) / 2);
    const early = await scanLogs(rpc, filter, fromBlock, middle, depth + 1);
    const late = await scanLogs(rpc, filter, middle + 1, toBlock, depth + 1);
    return [...early, ...late];
  }
}

const tokenKey = (token) => `${token.contract}:${token.tokenId}`;

/**
 * The tokens these logs could have delivered, newest first. ERC-20 transfers
 * share the Transfer topic and are left out by shape: an ERC-721 transfer
 * indexes its token ID, so it has four topics and no data.
 */
export function candidatesFromLogs(logs) {
  const found = new Map();
  const add = (log, standard, id) => {
    const token = {
      standard,
      contract: String(log.address).toLowerCase(),
      tokenId: BigInt(id).toString(),
    };
    const block = Number(BigInt(log.blockNumber ?? 0));
    const index = Number(BigInt(log.logIndex ?? 0));
    const key = tokenKey(token);
    const seen = found.get(key);
    if (!seen || seen.block < block || (seen.block === block && seen.index < index))
      found.set(key, { token, block, index });
  };
  for (const log of Array.isArray(logs) ? logs : []) {
    if (!log || !ADDRESS.test(String(log.address)) || !Array.isArray(log.topics)) continue;
    const [topic] = log.topics;
    try {
      if (topic === TRANSFER && log.topics.length === 4 && (!log.data || log.data === "0x"))
        add(log, ERC721, log.topics[3]);
      else if (topic === TRANSFER_SINGLE && log.topics.length === 4) {
        const [id] = words(log.data);
        if (id) add(log, ERC1155, id);
      } else if (topic === TRANSFER_BATCH && log.topics.length === 4) {
        const all = words(log.data);
        const offset = Number(BigInt(all[0] ?? 0) / 32n);
        const count = Number(BigInt(all[offset] ?? 0));
        if (count > 0 && count <= 256)
          for (const id of all.slice(offset + 1, offset + 1 + count)) add(log, ERC1155, id);
      }
    } catch {
      // A malformed log is skipped, not allowed to stop the rest.
    }
  }
  return [...found.values()]
    .sort((a, b) => b.block - a.block || b.index - a.index)
    .map((entry) => entry.token);
}

/** Whether a contract's answer says `owner` holds the token now. */
export function stillHeld(token, owner, result) {
  if (token.standard === ERC721) return decodeAddress(result) === String(owner).toLowerCase();
  const balance = decodeUint(result);
  return balance !== null && balance > 0n;
}

/** ERC-1155 URIs may say `{id}`, meaning the token ID as 64 lowercase hex digits. */
export function expandTokenUri(uri, token) {
  if (typeof uri !== "string") return null;
  const value = uri.trim();
  if (token.standard !== ERC1155) return value;
  return value.replace(/\{id\}/gi, BigInt(token.tokenId).toString(16).padStart(64, "0"));
}

const clip = (value, max) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max)
    : "";

/**
 * Find the owner's tokens. `rpc({ method, params })` is the surface's existing
 * read connection. Returns at most MAX_TOKENS, and up to how many more were left out.
 */
// Reads run a few at a time: one after another takes most of a minute for a
// wallet with a few dozen tokens, and all at once is how public nodes decide
// to stop answering.
const PARALLEL_READS = 4;

async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

const ethCall = (rpc, request) => rpc({ method: "eth_call", params: [request, "latest"] });

export async function discover({ rpc: direct, owner, limit = MAX_TOKENS, pauseMs = 500 }) {
  const rpc = patient(direct, { pauseMs });
  const head = Number(BigInt(await rpc({ method: "eth_blockNumber", params: [] })));
  const logs = (
    await Promise.all(discoveryFilters(owner).map((filter) => scanLogs(rpc, filter, 0, head)))
  ).flat();
  const candidates = candidatesFromLogs(logs);

  // Newest first, in batches, stopping once enough are known to be held.
  const held = [];
  let checked = 0;
  let overflow = 0;
  let unanswered = 0;
  while (checked < candidates.length && held.length < limit) {
    const batch = candidates.slice(checked, checked + PARALLEL_READS * 2);
    checked += batch.length;
    const answers = await mapLimit(batch, PARALLEL_READS, async (token) => {
      const probe = token.standard === ERC721 ? call.ownerOf(token) : call.balanceOf(token, owner);
      try {
        return stillHeld(token, owner, await ethCall(rpc, probe));
      } catch (error) {
        // A contract that refuses (a burned token reverts) is not held. A node
        // that could not be reached said nothing either way, so the token is
        // counted as not shown rather than as not owned.
        if (transient(error)) unanswered += 1;
        return false;
      }
    });
    batch.forEach((token, index) => {
      if (!answers[index]) return;
      if (held.length < limit) held.push(token);
      else overflow += 1;
    });
  }

  const contracts = [...new Set(held.map((token) => token.contract))];
  const names = new Map(
    await mapLimit(contracts, PARALLEL_READS, async (contract) => {
      try {
        return [contract, clip(decodeString(await ethCall(rpc, call.name(contract))), 80)];
      } catch {
        return [contract, ""];
      }
    }),
  );
  const tokens = await mapLimit(held, PARALLEL_READS, async (token) => {
    let uri = null;
    try {
      const read = token.standard === ERC721 ? call.tokenURI(token) : call.uri(token);
      uri = expandTokenUri(decodeString(await ethCall(rpc, read)), token);
    } catch {
      uri = null;
    }
    return { ...token, collection: names.get(token.contract) || "", uri };
  });
  // What is not shown: tokens known to be held past the limit, tokens never
  // asked about, and tokens the node would not answer for. Counted together as
  // "up to", never as a firm number.
  return { tokens, notShown: overflow + unanswered + (candidates.length - checked) };
}

// ---------------------------------------------------------------------------
// Where a URI points.
// ---------------------------------------------------------------------------

export const ONCHAIN = "onchain";
export const IPFS = "ipfs";
export const ARWEAVE = "arweave";
export const WEB = "web";
export const UNSUPPORTED = "unsupported";

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;

/** Classify a token or image URI. */
export function locate(uri) {
  if (typeof uri !== "string" || !uri.trim()) return { kind: UNSUPPORTED };
  const value = uri.trim();
  if (/^data:/i.test(value)) return { kind: ONCHAIN };
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?([^/?#]+)(\/[^?#]*)?$/i.exec(value);
  if (ipfs && CID.test(ipfs[1]))
    return { kind: IPFS, cid: ipfs[1], path: ipfs[2] || "", host: null };
  if (/^ar:\/\/[A-Za-z0-9_-]{43}/.test(value)) return { kind: ARWEAVE, host: "arweave.net" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { kind: UNSUPPORTED };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: UNSUPPORTED };
  const gateway = /^\/ipfs\/([^/?#]+)(\/[^?#]*)?$/.exec(url.pathname);
  if (gateway && CID.test(gateway[1]))
    return { kind: IPFS, cid: gateway[1], path: gateway[2] || "", host: url.host };
  return { kind: WEB, host: url.host, insecure: url.protocol === "http:" };
}

/** The public gateway IPFS addresses are loaded through. */
export const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const ARWEAVE_GATEWAY = "https://arweave.net/";

/**
 * A URL a browser or phone can load for a token or image URI, or "" when there
 * is none. `data:` URIs are returned as they are; only images and JSON are
 * ever asked of them.
 */
export function mediaUrl(uri) {
  const location = locate(uri);
  const value = String(uri || "").trim();
  if (location.kind === ONCHAIN) return value;
  if (location.kind === IPFS) return `${IPFS_GATEWAY}${location.cid}${location.path}`;
  if (location.kind === ARWEAVE) return `${ARWEAVE_GATEWAY}${value.slice("ar://".length)}`;
  if (location.kind === WEB) return value;
  return "";
}

/** A picture URL safe to put in an image element: https, or an inline image. */
export function imageUrl(uri) {
  const url = mediaUrl(uri);
  if (/^https:\/\//i.test(url)) return url;
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(url)) return url;
  return "";
}

export const MAX_MEDIA_BYTES = 1_500_000;

/** The bytes a `data:` URI carries, and what it says they are. */
export function parseDataUri(uri) {
  const match = /^data:([^,]*?),(.*)$/is.exec(String(uri || "").trim());
  if (!match) return null;
  const params = match[1].split(";").map((part) => part.trim().toLowerCase());
  const mediaType = params[0] || "text/plain";
  const base64 = params.includes("base64");
  let bytes;
  try {
    if (base64) bytes = base64ToBytes(match[2]);
    else {
      let text;
      try {
        text = decodeURIComponent(match[2]);
      } catch {
        text = match[2];
      }
      bytes = utf8Bytes(text);
    }
  } catch {
    return null;
  }
  if (bytes.length > MAX_MEDIA_BYTES) return null;
  return { mediaType, bytes };
}

/**
 * Metadata cut down to what the gallery shows, every string bounded. Anything
 * else the file carries is dropped, including any other URL in it.
 */
export function parseMetadata(value) {
  let data = value;
  if (data instanceof Uint8Array) data = utf8(data).replace(/^﻿/, "");
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  // An on-chain image is often a long data URI and is kept whole, up to what
  // the gallery would accept from a fetch; a URL is kept to a sane length.
  const raw = typeof data.image === "string" && data.image ? data.image : data.image_url;
  let image =
    typeof raw === "string" && /^\s*data:/i.test(raw)
      ? raw.trim().slice(0, MAX_MEDIA_BYTES * 2)
      : clip(raw, 2048) || null;
  if (!image && typeof data.image_data === "string" && /<svg[\s/>]/i.test(data.image_data))
    image = `data:image/svg+xml;base64,${bytesToBase64(utf8Bytes(data.image_data.slice(0, MAX_MEDIA_BYTES)))}`;
  const attributes = (Array.isArray(data.attributes) ? data.attributes : [])
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 24)
    .map((entry) => ({ trait: clip(entry.trait_type, 60), value: clip(entry.value, 80) }))
    .filter((entry) => entry.value);
  return {
    name: clip(data.name, 120),
    description: clip(data.description, 1200),
    image,
    animation: clip(data.animation_url, 2048) || null,
    attributes,
  };
}

/**
 * Load a token's metadata. `fetcher` is the platform's `fetch`. Returns null
 * when there is none, or when the host would not let this device read it.
 * @param {any} token
 */
export async function loadMetadata(token, fetcher = globalThis.fetch, timeoutMs = 15000) {
  const location = locate(token.uri);
  if (location.kind === UNSUPPORTED) return null;
  if (location.kind === ONCHAIN) {
    const parsed = parseDataUri(token.uri);
    return parsed ? parseMetadata(parsed.bytes) : null;
  }
  try {
    const response = await fetcher(mediaUrl(token.uri), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > MAX_MEDIA_BYTES * 2) return null;
    return parseMetadata(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending.
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

/**
 * The one transaction that sends `token` from `from` to `to`: ERC-721
 * `safeTransferFrom(from, to, id)`, or ERC-1155
 * `safeTransferFrom(from, to, id, 1, "")`, which sends one of them.
 */
export function transferCall(token, from, to) {
  if (!ADDRESS.test(String(token?.contract))) throw new Error("Not an NFT contract.");
  if (!ADDRESS.test(String(from))) throw new Error("Not a sending address.");
  if (!ADDRESS.test(String(to)) || String(to).toLowerCase() === ZERO_ADDRESS)
    throw new Error("Enter a valid recipient address.");
  if (String(to).toLowerCase() === String(from).toLowerCase())
    throw new Error("That is the address it is already in.");
  if (!/^\d+$/.test(String(token.tokenId))) throw new Error("Not a token ID.");
  const head = `${addressTopic(from).slice(2)}${addressTopic(to).slice(2)}${word(token.tokenId)}`;
  const data =
    token.standard === ERC1155
      ? `0xf242432a${head}${word(1)}${word(160)}${word(0)}`
      : `0x42842e0e${head}`;
  return { to: String(token.contract).toLowerCase(), data, value: "0" };
}

/**
 * Refuse a transaction that is not exactly the transfer that was reviewed.
 * Called on the way to the signer, so nothing between the review and the
 * wallet can change where the token goes.
 */
export function checkTransfer(tx, token, from, to) {
  const expected = transferCall(token, from, to);
  if (
    String(tx?.to).toLowerCase() !== expected.to ||
    String(tx?.data).toLowerCase() !== expected.data ||
    BigInt(tx?.value ?? 0) !== 0n
  )
    throw new Error("This transfer does not match what you reviewed. Nothing was sent.");
}

/**
 * A short, stable label for a token.
 * @param {any} token
 * @param {any} [metadata]
 */
export function tokenLabel(token, metadata = null) {
  const id =
    token.tokenId.length > 12
      ? `${token.tokenId.slice(0, 6)}…${token.tokenId.slice(-4)}`
      : token.tokenId;
  return metadata?.name || `${token.collection || "Token"} #${id}`;
}
