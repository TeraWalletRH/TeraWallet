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
export const READ_METHODS = ["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call"];

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
