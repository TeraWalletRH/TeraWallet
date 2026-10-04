import { describe, expect, it } from "bun:test";
import request from "supertest";
import { pad, toHex } from "viem";
import app from "../src/app";
import { USDG } from "../src/bridge";
import { newId } from "../src/pay-links";
import * as backendCore from "../src/pay-links-core";
import * as siteCore from "../../public/tera/core/pay-links.js";

const MERCHANT = "0xcd3B766CCDd6AE721141F452C550Ca635964ce71";
const PAYER = "0x00000000000000000000000000000000000000bb";

const transfer = (to: string, value: bigint, token = USDG, from = PAYER) => ({
  address: token,
  topics: [
    backendCore.TRANSFER_TOPIC,
    pad(from.toLowerCase() as `0x${string}`),
    pad(to.toLowerCase() as `0x${string}`),
  ],
  data: toHex(value, { size: 32 }),
});

// PAY_LINKS_ENABLED is unset and there is no database: every route refuses.
describe("Payment link API, register off", () => {
  it("reports itself off", async () => {
    const res = await request(app).get("/api/pay-links/config");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.requires).toEqual({ flag: false, database: false });
    expect(res.body.token).toBe(USDG);
  });

  it("refuses every call", async () => {
    for (const name of ["create", "view", "mine", "cancel", "paid", "invoice", "qr"]) {
      const res = await request(app).post(`/api/pay-links/${name}`).send({});
      expect(res.status).toBe(503);
    }
  });
});

describe("What a merchant signs, and what counts as paying a link", () => {
  it("the web app and the service build the same text", () => {
    const input = { merchant: MERCHANT, amount: "25000000", note: "Invoice #104", timestamp: 1 };
    expect(siteCore.createMessage(input)).toBe(backendCore.createMessage(input));
    expect(siteCore.listMessage(input)).toBe(backendCore.listMessage(input));
    expect(siteCore.cancelMessage({ ...input, id: "abc" })).toBe(
      backendCore.cancelMessage({ ...input, id: "abc" }),
    );
    expect(backendCore.createMessage(input)).toContain(`Merchant: ${MERCHANT.toLowerCase()}`);
  });

  it("asks for whole cents, above zero, up to a million dollars", () => {
    for (const core of [siteCore, backendCore]) {
      expect(core.checkAmount("25000000").ok).toBe(true);
      expect(core.checkAmount("25000001").ok).toBe(false);
      expect(core.checkAmount("0").ok).toBe(false);
      expect(core.checkAmount("1000000000001").ok).toBe(false);
      expect(core.checkAmount("abc").ok).toBe(false);
    }
  });

  it("keeps a note to one line", () => {
    expect(backendCore.cleanNote("Invoice\n#104\u0000").note).toBe("Invoice #104");
    expect(siteCore.cleanNote("x".repeat(141)).ok).toBe(false);
  });

  it("reads a link id from a link or on its own, and nothing else", () => {
    const id = newId();
    expect(backendCore.isLinkId(id)).toBe(true);
    for (const core of [siteCore, backendCore]) {
      expect(core.parseLink(core.linkUrl(id))).toBe(id);
      expect(core.parseLink(`  ${id} `)).toBe(id);
      expect(core.parseLink("https://terawallet.app/app/?pay=0OIl00000000")).toBe(null);
      expect(core.parseLink("hello")).toBe(null);
    }
  });

  it("counts only an exact USDG transfer to the merchant", () => {
    const want = { token: USDG, merchant: MERCHANT, amount: "25000000" };
    for (const core of [siteCore, backendCore]) {
      expect(core.paymentIn([transfer(MERCHANT, 25000000n)], want)?.from).toBe(PAYER);
      expect(core.paymentIn([transfer(MERCHANT, 24990000n)], want)).toBe(null);
      expect(core.paymentIn([transfer(PAYER, 25000000n)], want)).toBe(null);
      expect(
        core.paymentIn(
          [transfer(MERCHANT, 25000000n, "0x0000000000000000000000000000000000000001")],
          want,
        ),
      ).toBe(null);
      expect(core.paymentIn([], want)).toBe(null);
    }
  });

  it("formats invoice amount and tracks status across both cores identically", () => {
    for (const core of [siteCore, backendCore]) {
      expect(core.formatInvoiceAmount("25000000")).toBe("$25.00");
      expect(core.formatInvoiceAmount("1500000")).toBe("$1.50");
      expect(core.formatInvoiceAmount("1000000000000")).toBe("$1,000,000.00");

      expect(core.invoiceStatus({ status: "open" })).toBe("waiting");
      expect(core.invoiceStatus({ status: "paid" })).toBe("settled");
      expect(core.invoiceStatus({ paidTx: "0x1234" })).toBe("settled");
      expect(core.invoiceStatus({ status: "cancelled" })).toBe("cancelled");
    }
  });

  it("creates invoice cards and renders HTML views with QR and settled states", () => {
    const link = {
      id: "23456789ABCD",
      merchant: MERCHANT,
      amount: "25000000",
      note: "Coffee & Pastries",
      status: "open",
    };
    const card = backendCore.createInvoiceCard(link);
    expect(card.amountFormatted).toBe("$25.00");
    expect(card.status).toBe("waiting");
    expect(card.isSettled).toBe(false);

    const htmlWaiting = backendCore.renderInvoiceCardHtml(card);
    expect(htmlWaiting).toContain("Waiting for payment...");
    expect(htmlWaiting).toContain("Coffee & Pastries");
    expect(htmlWaiting).toContain("$25.00");

    const paidLink = { ...link, status: "paid", paidTx: "0xabcd1234", payer: PAYER };
    const paidCard = backendCore.createInvoiceCard(paidLink);
    expect(paidCard.status).toBe("settled");
    expect(paidCard.isSettled).toBe(true);

    const htmlSettled = backendCore.renderInvoiceCardHtml(paidCard);
    expect(htmlSettled).toContain("Paid & Verified");
    expect(htmlSettled).toContain("Payment Received");
  });
});
