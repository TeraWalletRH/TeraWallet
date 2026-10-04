import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateActivityCsv,
  parseRecordTransaction,
  CSV_PRESETS,
} from "../../public/tera/core/csv-export.js";

test("generateActivityCsv formats records and history into standard CSV", () => {
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

test("generateActivityCsv formats records into Koinly tax profile", () => {
  const records = [
    {
      createdAt: "2026-10-02T12:00:00Z",
      txHash: "0x111",
      action: "SEND",
      amount: "250.5",
      symbol: "USDG",
      payee: "0xrecipient",
      fee: "0.0002",
    },
    {
      createdAt: "2026-10-02T14:30:00Z",
      txHash: "0x222",
      action: "CLAIM_YIELD",
      amount: "42.0",
      symbol: "UST",
    },
  ];

  const csv = generateActivityCsv(records, [], { preset: CSV_PRESETS.KOINLY });
  const lines = csv.split("\n");

  assert.equal(
    lines[0],
    '"Date","Sent Amount","Sent Currency","Received Amount","Received Currency","Fee Amount","Fee Currency","Net Worth Amount","Net Worth Currency","Label","Description","TxHash"',
  );

  // Send record
  assert.match(lines[1], /"2026-10-02T12:00:00Z","250\.5","USDG","","","0\.0002","ETH"/);
  assert.match(lines[1], /"0x111"/);

  // Claim yield record (incoming reward)
  assert.match(lines[2], /"2026-10-02T14:30:00Z","","","42\.0","UST"/);
  assert.match(lines[2], /"reward"/);
  assert.match(lines[2], /"0x222"/);
});

test("generateActivityCsv formats records into CoinTracker tax profile", () => {
  const records = [
    {
      createdAt: "2026-10-02T12:00:00Z",
      txHash: "0x333",
      action: "TRANSFER",
      amount: "100",
      symbol: "USDG",
      fee: "0.0001",
    },
    {
      createdAt: "2026-10-02T16:00:00Z",
      txHash: "0x444",
      action: "RECEIVE",
      amount: "0.5",
      symbol: "ETH",
    },
  ];

  const csv = generateActivityCsv(records, [], { preset: CSV_PRESETS.COINTRACKER });
  const lines = csv.split("\n");

  assert.equal(
    lines[0],
    '"Date","Received Quantity","Received Currency","Sent Quantity","Sent Currency","Fee Amount","Fee Currency","Tag","Transaction Hash"',
  );

  // Outgoing transfer
  assert.match(lines[1], /"2026-10-02T12:00:00Z","","","100","USDG","0\.0001","ETH"/);
  assert.match(lines[1], /"0x333"/);

  // Incoming receive
  assert.match(lines[2], /"2026-10-02T16:00:00Z","0\.5","ETH","",""/);
  assert.match(lines[2], /"payment"/);
  assert.match(lines[2], /"0x444"/);
});

