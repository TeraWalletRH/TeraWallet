import { test } from "node:test";
import assert from "node:assert/strict";

function generateActivityCsv(records = [], history = [], chainId = 4663) {
  const headers = ["Date", "TxHash", "Action", "Payee", "Status", "ChainID"];
  const escapeCsv = (str) => {
    const val = str === undefined || str === null ? "" : String(str);
    return `"${val.replace(/"/g, '""')}"`;
  };
  const rows = [
    ...records.map((r) => [
      r.createdAt || "",
      r.txHash || "",
      r.action || "TRANSFER",
      r.payee || "",
      r.status || "confirmed",
      r.chainId || chainId || 4663,
    ]),
    ...history.map((h) => [
      h.created_at || h.createdAt || "",
      h.tx_hash || h.txHash || "",
      h.intent_type || h.action || "TRANSFER",
      h.payee || "",
      h.status || "confirmed",
      h.chainId || chainId || 4663,
    ]),
  ].map((row) => row.map(escapeCsv).join(","));
  return [headers.map(escapeCsv).join(","), ...rows].join("\n");
}

test("generateActivityCsv formats records and history into CSV", () => {
  const records = [
    {
      createdAt: "2026-10-02T12:00:00Z",
      txHash: "0x123",
      action: "TRANSFER",
      payee: "0x456",
      status: "confirmed",
      chainId: 4663,
    },
  ];
  const history = [
    {
      created_at: "2026-10-02T13:00:00Z",
      tx_hash: "0x789",
      intent_type: "SWAP",
      payee: "0xabc",
      status: "confirmed",
      chainId: 4663,
    },
  ];

  const csv = generateActivityCsv(records, history);
  const lines = csv.split("\n");

  assert.equal(lines.length, 3);
  assert.equal(lines[0], '"Date","TxHash","Action","Payee","Status","ChainID"');
  assert.equal(lines[1], '"2026-10-02T12:00:00Z","0x123","TRANSFER","0x456","confirmed","4663"');
  assert.equal(lines[2], '"2026-10-02T13:00:00Z","0x789","SWAP","0xabc","confirmed","4663"');
});

test("generateActivityCsv handles empty inputs gracefully", () => {
  const csv = generateActivityCsv([], []);
  assert.equal(csv, '"Date","TxHash","Action","Payee","Status","ChainID"');
});
