// Tax-ready CSV export for Tera Wallet transactions.
//
// Supports Standard (Internal audit), Koinly tax profile, and CoinTracker tax profile.

export const CSV_PRESETS = {
  STANDARD: "standard",
  KOINLY: "koinly",
  COINTRACKER: "cointracker",
};

export const escapeCsv = (str) => {
  const val = str === undefined || str === null ? "" : String(str);
  return `"${val.replace(/"/g, '""')}"`;
};

export function parseRecordTransaction(row) {
  const date =
    row.createdAt ||
    row.created_at ||
    (row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString());
  const hash = row.txHash || row.tx_hash || row.hash || "";
  const action = (row.action || row.actionType || row.intent_type || "TRANSFER").toUpperCase();
  const payee = row.payee || row.recipient || row.to || "";
  const status = row.status || "confirmed";
  const chainId = row.chainId || 4663;

  // Extract amount and symbol
  let rawAmount = row.amount ?? "";
  let symbol = row.symbol || "";

  if (!symbol && row.activityAmount) {
    const parts = String(row.activityAmount).trim().split(/\s+/);
    if (parts.length >= 2) {
      rawAmount = rawAmount || parts[0];
      symbol = parts[1].toUpperCase();
    } else if (parts.length === 1 && !/^\d/.test(parts[0])) {
      symbol = parts[0].toUpperCase();
    }
  }

  if (!symbol && row.asset) {
    symbol = String(row.asset).toUpperCase();
  }
  if (!symbol) symbol = "USDG";

  const fee = row.fee || row.gasFee || (row.gasUsed ? "0.0001" : "");
  const feeCurrency = fee ? "ETH" : "";

  const isIncoming =
    /RECEIVE|CLAIM|REWARD|INCOMING|AIRDROP|DEPOSIT/.test(action) || row.direction === "receive";
  const isSwap = /SWAP|TRADE|EXCHANGE/.test(action);

  let sentAmount = "";
  let sentCurrency = "";
  let receivedAmount = "";
  let receivedCurrency = "";

  if (isSwap) {
    sentAmount = row.sentAmount || rawAmount || "";
    sentCurrency = row.sentCurrency || symbol || "ETH";
    receivedAmount = row.receivedAmount || "";
    receivedCurrency = row.receivedCurrency || "USDG";
  } else if (isIncoming) {
    receivedAmount = rawAmount;
    receivedCurrency = symbol;
  } else {
    sentAmount = rawAmount;
    sentCurrency = symbol;
  }

  let label = "";
  if (/CLAIM|REWARD|YIELD/.test(action)) label = "reward";
  else if (/SWAP/.test(action)) label = "trade";
  else if (isIncoming) label = "income";

  let tag = "";
  if (/CLAIM|REWARD|YIELD/.test(action)) tag = "staked";
  else if (isIncoming) tag = "payment";

  let description = `${action} ${rawAmount ? `${rawAmount} ` : ""}${symbol}`.trim();
  if (payee) description += ` to ${payee}`;

  return {
    date,
    hash,
    action,
    payee,
    status,
    chainId,
    sentAmount: sentAmount ? String(sentAmount) : "",
    sentCurrency,
    receivedAmount: receivedAmount ? String(receivedAmount) : "",
    receivedCurrency,
    fee: fee ? String(fee) : "",
    feeCurrency,
    label,
    tag,
    description,
  };
}

/**
 * Formats activity records into a CSV string based on selected preset:
 * - 'standard': Internal audit format
 * - 'koinly': Koinly Tax import format
 * - 'cointracker': CoinTracker Tax import format
 */
export function generateActivityCsv(records = [], history = [], options = {}) {
  const preset = typeof options === "string" ? options : options.preset || "standard";
  const defaultChainId = typeof options === "object" ? options.chainId || 4663 : 4663;

  const combined = [
    ...(Array.isArray(records) ? records : []),
    ...(Array.isArray(history) ? history : []),
  ];

  if (preset === "koinly") {
    const headers = [
      "Date",
      "Sent Amount",
      "Sent Currency",
      "Received Amount",
      "Received Currency",
      "Fee Amount",
      "Fee Currency",
      "Net Worth Amount",
      "Net Worth Currency",
      "Label",
      "Description",
      "TxHash",
    ];
    const rows = combined.map((item) => {
      const tx = parseRecordTransaction(item);
      return [
        tx.date,
        tx.sentAmount,
        tx.sentCurrency,
        tx.receivedAmount,
        tx.receivedCurrency,
        tx.fee,
        tx.feeCurrency,
        "",
        "",
        tx.label,
        tx.description,
        tx.hash,
      ]
        .map(escapeCsv)
        .join(",");
    });
    return [headers.map(escapeCsv).join(","), ...rows].join("\n");
  }

  if (preset === "cointracker") {
    const headers = [
      "Date",
      "Received Quantity",
      "Received Currency",
      "Sent Quantity",
      "Sent Currency",
      "Fee Amount",
      "Fee Currency",
      "Tag",
      "Transaction Hash",
    ];
    const rows = combined.map((item) => {
      const tx = parseRecordTransaction(item);
      return [
        tx.date,
        tx.receivedAmount,
        tx.receivedCurrency,
        tx.sentAmount,
        tx.sentCurrency,
        tx.fee,
        tx.feeCurrency,
        tx.tag,
        tx.hash,
      ]
        .map(escapeCsv)
        .join(",");
    });
    return [headers.map(escapeCsv).join(","), ...rows].join("\n");
  }

  // Standard preset (default)
  const headers = ["Date", "TxHash", "Action", "Payee", "Status", "ChainID"];
  const rows = combined.map((r) =>
    [
      r.createdAt || r.created_at || "",
      r.txHash || r.tx_hash || r.hash || "",
      r.action || r.actionType || r.intent_type || "TRANSFER",
      r.payee || r.recipient || r.to || "",
      r.status || "confirmed",
      r.chainId || defaultChainId || 4663,
    ]
      .map(escapeCsv)
      .join(","),
  );

  return [headers.map(escapeCsv).join(","), ...rows].join("\n");
}
