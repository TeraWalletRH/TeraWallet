// An owner-supplied endpoint for balance reads.
//
// By default every balance in this wallet is read through the wallet
// extension's own network provider, which means that provider learns every
// address the owner looks at. Pointing those reads at the owner's own node, or
// at an endpoint they chose, moves that knowledge to a party they picked.
//
// Only reads come here. Signing, simulation, gas estimation and receipts stay
// with the wallet, because what the wallet signs must be what the wallet saw.
// The allow list below is what enforces that, not a convention.

export class EndpointError extends Error {}

// Everything this wallet is willing to ask an owner-supplied endpoint.
export const READ_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_getLogs",
];

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

/**
 * Validate an endpoint the owner typed. Returns the normalised URL, or throws
 * with a message that is safe to display — the URL can carry an API key, so no
 * error from this module ever repeats it.
 */
export function normaliseEndpoint(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new EndpointError("Enter the address of your node or endpoint.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new EndpointError("That is not a valid URL. It should start with https://");
  }
  if (url.username || url.password)
    throw new EndpointError(
      "Remove the username and password from the URL. Credentials written into a URL leak into browser history and error messages. Use an endpoint that carries its key in the path instead.",
    );
  if (!["http:", "https:"].includes(url.protocol))
    throw new EndpointError("Use an http or https JSON-RPC endpoint.");
  const local = LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol === "http:" && !local)
    throw new EndpointError(
      "Use https, or a node running on this machine. Over plain http every balance you read is visible to the network between you and the endpoint.",
    );
  return url.toString();
}

/** Host only. The full URL is never shown, logged or exported. */
export function describeEndpoint(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      local: LOCAL_HOSTS.includes(parsed.hostname),
      secure: parsed.protocol === "https:",
    };
  } catch {
    return { host: "", local: false, secure: false };
  }
}

/**
 * A JSON-RPC reader for one endpoint. It refuses any method outside the read
 * list, so a mistake elsewhere in the wallet cannot send a signing request or
 * an account enumeration to a third party.
 */
export function createRpc(url, fetcher = fetch) {
  const { host } = describeEndpoint(url);
  return async ({ method, params = [] }) => {
    if (!READ_METHODS.includes(method))
      throw new EndpointError(`This wallet never sends ${method} to your endpoint.`);
    let response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        // Nothing about this page travels with the read: no cookies, no
        // credentials, and no referrer naming the page the owner is on.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new EndpointError(`${host} could not be reached.`);
    }
    if (!response.ok) throw new EndpointError(`${host} answered with status ${response.status}.`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new EndpointError(`${host} returned a response this wallet could not read.`);
    }
    if (payload?.error)
      throw new EndpointError(
        `${host} refused the read: ${payload.error.message || "no reason given"}.`,
      );
    if (typeof payload?.result === "undefined")
      throw new EndpointError(`${host} returned no result for ${method}.`);
    return payload.result;
  };
}

/**
 * Confirm an endpoint answers, and answers for the right network. A balance
 * read against the wrong chain is not an error the owner would see in the
 * numbers, so it is checked before the endpoint is ever used.
 */
export async function probeEndpoint(rpc, expectedChainId) {
  const result = await rpc({ method: "eth_chainId" });
  const id = Number(result);
  if (!Number.isFinite(id) || id <= 0)
    throw new EndpointError("Your endpoint did not report which network it is on.");
  if (id !== expectedChainId)
    throw new EndpointError(
      `Your endpoint is on network ${id}, but this wallet is on ${expectedChainId}. Balances read from it would be wrong, so it was not saved.`,
    );
  return id;
}

// ---------------------------------------------------------------------------
// Reading more than one account without handing one party the whole portfolio.
//
// A single endpoint that answers for every account the owner switches between
// learns that those accounts are one person: same connection, same session, same
// moment. Splitting the reads across endpoints run by different operators means
// no single operator sees the set.
//
// What this does not do:
//
//   It does not hide the owner from the operator it assigns them to. That
//   operator sees that account, every asset read for it, and the network address
//   the read came from. The gain is that it sees one account, not all of them.
//
//   It does nothing against operators who compare notes. The network address is
//   the same for every read this browser makes, so two operators who pool what
//   they hold can rejoin the accounts. This is protection against one party, not
//   against collusion.
//
//   It does not reach the signing path. Transactions, gas estimation and receipt
//   checks still go through the wallet extension's own provider, which sees every
//   account regardless of what is configured here.
// ---------------------------------------------------------------------------

/** What an owner is owed before a pool is described to them as isolation. */
export const POOL_LIMITS = [
  "Each account is read by one operator, and that operator sees every asset you hold on it.",
  "Every read comes from the same network address, so operators who compare notes can rejoin your accounts.",
  "Signing, gas estimation and receipts still go through your wallet extension's provider, which sees every account.",
  "Changing the pool reassigns accounts. An endpoint that has already answered for an account does not forget it.",
];

export const LOCAL_PARTY = "this machine";

/**
 * Which operator an endpoint belongs to.
 *
 * Two hosts under one registrable domain are one company, and treating them as
 * two would offer isolation that does not exist. The last two labels are a rough
 * stand-in for that domain: it is wrong for multi-part suffixes like `co.uk`,
 * where it merges operators that are in fact separate. That error understates
 * how much isolation the pool provides, which is the only direction this is
 * allowed to be wrong in.
 */
export function partyOf(url) {
  const { host, local } = describeEndpoint(url);
  if (!host) return "";
  if (local) return LOCAL_PARTY;
  const labels = host.split(":")[0].split(".").filter(Boolean);
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
}

/**
 * Build a pool from what the owner typed, one endpoint per line.
 *
 * Endpoints are grouped by operator rather than listed, because the operator is
 * the unit that learns something. Three URLs at one company are one party and
 * are reported as one, so the panel can never say "three endpoints" about a
 * arrangement that isolates nothing.
 */
export function createPool(values) {
  const list = (Array.isArray(values) ? values : String(values ?? "").split(/[\n,]/))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const parties = [];
  const seen = new Map();
  for (const value of list) {
    const url = normaliseEndpoint(value);
    const party = partyOf(url);
    if (seen.has(party)) {
      // Kept, so the owner's list round-trips, but it answers for nothing: a
      // second URL at the same company is the same company.
      seen.get(party).extras.push(url);
      continue;
    }
    const entry = { party, url, extras: [], ...describeEndpoint(url) };
    seen.set(party, entry);
    parties.push(entry);
  }
  return parties;
}

/** Every URL in the pool, in the order the owner gave them. */
export const poolUrls = (pool) => pool.flatMap((entry) => [entry.url, ...entry.extras]);

// FNV-1a. The assignment only has to be stable and evenly spread; it is not a
// secret, and the operator it selects already knows the account it is reading.
function hash(value) {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The operator that reads for one account.
 *
 * Deterministic, so an account goes to the same operator on every refresh and on
 * every reload. Choosing at random per read would spread every account across
 * the whole pool within a session, which is the opposite of what this is for.
 */
export function assignEndpoint(pool, owner) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const key = String(owner ?? "").toLowerCase();
  if (!key) return pool[0];
  return pool[hash(key) % pool.length];
}

/** What the panel says about a pool, counted rather than asserted. */
export function poolSummary(pool) {
  const parties = Array.isArray(pool) ? pool.length : 0;
  return {
    parties,
    endpoints: Array.isArray(pool) ? poolUrls(pool).length : 0,
    // One operator is not isolation, and must never be presented as any.
    isolating: parties > 1,
    localOnly: parties > 0 && pool.every((entry) => entry.local),
  };
}

/**
 * Read one balance. Mirrors exactly what the wallet asks its own provider for,
 * so the number shown does not depend on where it was read from.
 */
export function balanceReader(rpc, zeroAddress) {
  return ({ assetAddress, owner }) =>
    assetAddress === zeroAddress
      ? rpc({ method: "eth_getBalance", params: [owner, "latest"] })
      : rpc({
          method: "eth_call",
          params: [
            { to: assetAddress, data: `0x70a08231${owner.slice(2).padStart(64, "0")}` },
            "latest",
          ],
        });
}
