// The third-party egress panel. The privacy status centre describes what Tera
// receives; this describes everyone else — who sees the network address this
// browser connects from, who only receives data forwarded by Tera, and who this
// page cannot observe at all.
//
// The distinction matters and is easy to get wrong: a party that receives your
// address inside a request body is not the same as a party that sees the
// connection it arrived on. Both are listed, and each row says which it is.

export const REACH = {
  // This browser opens the connection, so the party sees the address it comes from.
  direct: {
    id: "direct",
    label: "Connects to you",
    detail: "This browser opens the connection, so this party sees the network address you are on.",
  },
  // Tera opens the connection on the server, so the party sees Tera's address.
  relayed: {
    id: "relayed",
    label: "Receives your data through Tera",
    detail:
      "Tera makes this request from its own server, so this party sees Tera's network address and not yours. It still receives the data described below.",
  },
  // The wallet extension opens the connection. This page never sees the host.
  wallet: {
    id: "wallet",
    label: "Connects to you, through your wallet",
    detail:
      "Your wallet extension opens this connection, not this page. It sees the network address you are on. This page cannot see which provider your wallet uses or what it sends, so nothing here is counted.",
  },
  // Not a company at all.
  ledger: {
    id: "ledger",
    label: "Public and permanent",
    detail:
      "Not a company that can be switched off. Anyone can read it, now and in the future, without asking you or Tera.",
  },
  // Reached only when the owner deliberately opens it.
  onDemand: {
    id: "onDemand",
    label: "Connects to you when you open a link",
    detail: "Nothing is sent to this party until you click a link that goes to it.",
  },
};

const host = (url, fallback) => {
  try {
    return new URL(url).host;
  } catch {
    return fallback;
  }
};

// The transport and explorer this dashboard is configured with. They mirror the
// defaults in the wallet connection island, so the panel names the host that is
// actually configured rather than a host we hope is in use.
const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
const DEFAULT_EXPLORER = "https://robinhoodchain.blockscout.com";

/**
 * Build the catalogue for the running configuration. `apiUrl`, `rpcUrl` and
 * `explorerUrl` come from the page config; `siteHost` is where this page itself
 * was served from.
 */
export function parties(config = {}) {
  const apiHost = host(config.apiUrl, "api.terawallet.app");
  const rpcHost = host(config.rpcUrl || DEFAULT_RPC, "rpc.mainnet.chain.robinhood.com");
  const explorerHost = host(
    config.explorerUrl || DEFAULT_EXPLORER,
    "robinhoodchain.blockscout.com",
  );
  // When the owner points balance reads at their own endpoint, that knowledge
  // moves: it does not disappear. The panel gains a row and the wallet's own
  // provider loses the line about every address the owner looks at.
  // An Oblivious HTTP relay splits what one party used to hold. It is listed as
  // a party in its own right, because it is one: it gains the network address
  // this browser connects from. What it cannot do is read anything it forwards.
  const relayHost = config.ohttpRelayHost || "";
  const obliviousPaths = config.ohttpPaths || [];
  const obliviousRelay = relayHost
    ? [
        {
          id: "ohttp-relay",
          name: "Oblivious HTTP relay",
          host: relayHost,
          reach: "direct",
          learns: [
            "The network address you are on",
            "That you are using Tera, and at what times",
            "The size of each sealed request and reply",
          ],
          withheld: [
            "The contents of anything it forwards, which are sealed to Tera's key",
            "Which route you asked for",
            "Your wallet address",
            "Private keys",
          ],
          control:
            "Only the requests listed as sealed go this way. The protection depends on this relay and Tera being different companies: if one party ran both, it would hold your address and your request together and nothing would be gained.",
        },
      ]
    : [];
  const balanceHost = config.balanceEndpointHost || "";
  const ownEndpoint = balanceHost
    ? [
        {
          id: "owner-endpoint",
          name: "Your own endpoint, for balance reads",
          host: balanceHost,
          reach: "direct",
          learns: [
            "The network address you are on, unless it is running on this machine",
            "Every address whose balance you view, including ones you only look at",
          ],
          withheld: [
            "Anything you sign",
            "Assistant messages",
            "Private keys",
            "Your private policy presets",
          ],
          control:
            "You chose this one, and you can change or remove it in Settings. A node on your own machine tells nobody anything.",
          owned: true,
        },
      ]
    : [];
  return [
    {
      id: "page-host",
      name: "Tera, serving this page",
      host: config.siteHost || "terawallet.app",
      reach: "direct",
      learns: [
        "The network address you are on",
        "That you opened the wallet dashboard, and when",
        "Which page of it, on every navigation",
      ],
      withheld: ["Your wallet address", "Balances", "Assistant messages", "Private keys"],
      control:
        "Unavoidable while the page is open. A VPN or Tor changes the address it sees; nothing in this wallet can.",
    },
    {
      id: "tera-service",
      name: "Tera service API",
      host: apiHost,
      reach: "direct",
      learns: [
        // Sealing the assistant call removes the address from those requests and
        // from nothing else. Saying "Tera no longer sees your address" would be
        // false while any request on this page still connects directly.
        relayHost
          ? "The network address you are on, on every request except the sealed ones listed below"
          : "The network address you are on",
        "Every field listed in the request log below",
        "Your wallet address, on the requests marked as carrying it",
      ],
      withheld: [
        ...(relayHost ? ["The network address behind a sealed request"] : []),
        "Balances",
        "Private keys",
        "Your private policy presets",
        "Local records",
      ],
      control: relayHost
        ? `The request log below is the complete list of what this page sends. ${obliviousPaths.length} of those routes are sealed and sent through a relay, so Tera reads them without learning where they came from. It still reads them, and a request that carries your wallet address still tells it who you are.`
        : "The request log below is the complete list of what this page sends.",
    },
    ...obliviousRelay,
    {
      id: "wallet-rpc",
      name: "Your wallet's own network provider",
      host: "Chosen by your wallet extension · not visible to this page",
      reach: "wallet",
      learns: balanceHost
        ? [
            "The network address you are on",
            "Every transaction you submit, before the network sees it",
            "The contract and gas checks made in the moments before you sign",
          ]
        : [
            "The network address you are on",
            "Every address whose balance you view, including ones you only look at",
            "Every transaction you submit, before the network sees it",
          ],
      withheld: balanceHost
        ? [
            "The balances you read, which now go to your own endpoint",
            "Assistant messages",
            "Your private policy presets",
            "Local records",
          ]
        : ["Assistant messages", "Your private policy presets", "Local records"],
      control: balanceHost
        ? "Balance reads already go to your endpoint. What remains here is the signing path, which stays with your wallet on purpose: what it signs must be what it saw."
        : "Point balance reads at your own node in Settings, or set a different RPC endpoint in your wallet extension. Most wallets default to their vendor's provider.",
      unobservable: true,
    },
    {
      id: "chain-rpc",
      name: "Robinhood Chain public RPC",
      host: rpcHost,
      reach: "direct",
      learns: [
        "The network address you are on, for any read this page's transport makes",
        "Which contracts and addresses that read concerned",
      ],
      withheld: ["Assistant messages", "Private keys", "Your private policy presets"],
      control:
        "This page configures this endpoint for its wallet connection layer. Balance reads you see in the wallet go through your extension's provider instead, so this row is listed as reachable, not as counted.",
      unobservable: true,
    },
    {
      id: "model-provider",
      name: "Assistant model provider",
      host: "Reached by Tera's server",
      reach: "relayed",
      learns: [
        "The text of the assistant message, as it was sent",
        "What you are asking about, even when every value in it was replaced",
      ],
      withheld: [
        "The network address you are on",
        "Your wallet address",
        "Your session token",
        "Balances",
      ],
      control:
        "Prompt minimisation replaces the values in the message before it leaves this device. It does not hide the question.",
    },
    {
      id: "relay",
      name: "Relay, for bridge routing",
      host: "Reached by Tera's server",
      reach: "relayed",
      learns: [
        "The source and destination addresses of a bridge you quote",
        "The amount and the destination network",
      ],
      withheld: ["The network address you are on", "Assistant messages", "Balances"],
      control: "Only reached when you request a bridge quote or check a delivery.",
    },
    {
      id: "explorer",
      name: "Block explorer",
      host: explorerHost,
      reach: "onDemand",
      learns: [
        "The network address you are on, once you open a link",
        "Which transaction you opened, which links it to you",
      ],
      withheld: ["Assistant messages", "Private keys", "Local records"],
      control: "Copy the hash instead of opening the link, and look it up somewhere else.",
    },
    ...ownEndpoint,
    {
      id: "ledger",
      name: "Robinhood Chain itself",
      host: `Chain ID ${config.chainId ?? 4663}`,
      reach: "ledger",
      learns: [
        "Every confirmed transfer: sender, recipient, asset, amount and time",
        "The full history of any address, linked together, permanently",
      ],
      withheld: ["The network address you are on", "Assistant messages", "Your policy presets"],
      control:
        "Nothing in this wallet makes a confirmed transfer private. Metadata protection is not transaction privacy.",
    },
  ];
}

const countBy = (log, test) => log.filter((entry) => !entry.simulated && test(entry)).length;

/**
 * Add live status to each row from what this page can actually account for.
 * A party this page cannot observe is reported as unobservable, never as zero:
 * "we did not count it" and "it did not happen" are different claims.
 */
export function egressStatus(rows, context = {}) {
  const log = context.log || [];
  const demo = Boolean(context.demo);
  const connected = Boolean(context.owner);
  const counts = {
    "tera-service": countBy(log, () => true),
    "model-provider": countBy(log, (entry) =>
      entry.processors?.includes("Assistant model provider"),
    ),
    relay: countBy(log, (entry) => entry.processors?.includes("Relay")),
    "ohttp-relay": countBy(log, (entry) => entry.oblivious),
  };
  return rows.map((row) => {
    const requests = counts[row.id];
    if (row.id === "owner-endpoint") {
      const reads = context.balanceReads || 0;
      return {
        ...row,
        requests: reads,
        seesYouNow: reads > 0,
        note: reads
          ? `${reads} balance read${reads === 1 ? "" : "s"} in this page session.`
          : "Configured, but no balance has been read from it yet.",
      };
    }
    if (row.id === "page-host")
      return { ...row, seesYouNow: true, note: "This page was served from it." };
    if (row.id === "ledger")
      return {
        ...row,
        seesYouNow: (context.records || 0) > 0,
        note:
          context.records || 0
            ? `${context.records} transaction${context.records === 1 ? "" : "s"} from this device are on the public ledger.`
            : "Nothing has been submitted from this device in this session.",
      };
    if (row.id === "explorer")
      return {
        ...row,
        seesYouNow: false,
        note: "Nothing is sent until you open a transaction link.",
      };
    if (row.unobservable)
      return {
        ...row,
        seesYouNow: row.id === "wallet-rpc" ? connected && !demo : false,
        note:
          row.id === "wallet-rpc"
            ? connected && !demo
              ? "Your wallet is connected, so its provider is answering reads for this page. This page cannot count them."
              : "No wallet is connected, so this page is not asking it for anything."
            : "Reachable from this page's connection layer. This page does not count requests to it.",
        uncounted: true,
      };
    if (demo)
      return {
        ...row,
        seesYouNow: false,
        note: "The guided demo answers every request locally. Nothing reached this party.",
        requests: 0,
      };
    return {
      ...row,
      requests,
      seesYouNow: requests > 0,
      note: requests
        ? `${requests} request${requests === 1 ? "" : "s"} in this page session.`
        : "Not contacted in this page session.",
    };
  });
}

/** The headline the panel opens with, counted rather than asserted. */
export function egressSummary(rows) {
  return {
    parties: rows.length,
    seeingYouNow: rows.filter((row) => row.seesYouNow).length,
    direct: rows.filter((row) => row.reach === "direct" || row.reach === "wallet").length,
    relayed: rows.filter((row) => row.reach === "relayed").length,
    uncounted: rows.filter((row) => row.uncounted).length,
  };
}

/** The panel as a record, for the privacy log export. */
export function exportableEgress(rows) {
  return {
    note: "Every party this page can account for. Parties marked uncounted are reachable but not observable from this page, and parties reached by Tera's server never see your network address.",
    parties: rows.map((row) => ({
      party: row.name,
      host: row.host,
      reach: REACH[row.reach].label,
      seesYourNetworkAddress: row.reach === "direct" || row.reach === "wallet",
      contactedThisSession: Boolean(row.seesYouNow),
      countedByThisPage: !row.uncounted,
      learns: row.learns,
      withheld: row.withheld,
    })),
  };
}
