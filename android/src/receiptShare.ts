import { Linking, Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

export interface ReceiptShareData {
  hash: string;
  title: string;
  status: string;
  amount?: string;
  symbol?: string;
  payee?: string;
  recipient?: string;
  recipientName?: string;
  sender?: string;
  createdAt?: string | number;
  block?: number;
  feeEth?: string;
  reference?: string;
  payoutHash?: string;
  delivery?: string;
  isPrivate?: boolean;
}

const EXPLORER_BASE = "https://robinhoodchain.blockscout.com";

export function getExplorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

function shortAddress(addr?: string): string {
  if (!addr) return "—";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function formatReceiptDate(timestamp?: string | number): string {
  if (!timestamp) return new Date().toLocaleString();
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? String(timestamp) : d.toLocaleString();
}

/**
 * Format receipt text for sharing or copying.
 */
export function formatReceiptText(data: ReceiptShareData): string {
  const explorerUrl = getExplorerTxUrl(data.hash);
  const target = data.recipientName
    ? `${data.recipientName} (${data.payee || data.recipient || "—"})`
    : data.payee || data.recipient || "—";
  const amountStr = data.amount && data.symbol ? `${data.amount} ${data.symbol}` : data.amount || "—";

  return [
    `🧾 Tera Wallet · Transaction Receipt`,
    `--------------------------------------`,
    `Action: ${data.title}`,
    `Status: ${data.status.toUpperCase()}`,
    `Amount: ${amountStr}`,
    `To: ${target}`,
    data.sender ? `From: ${data.sender}` : null,
    `Date: ${formatReceiptDate(data.createdAt)}`,
    data.feeEth ? `Network Fee: ${data.feeEth} ETH` : null,
    data.block ? `Block: #${data.block}` : null,
    `Tx Hash: ${data.hash}`,
    `--------------------------------------`,
    `View on Explorer: ${explorerUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Share receipt via Link (copies to clipboard and opens system share).
 */
export async function shareReceiptViaLink(
  data: ReceiptShareData,
  onNotice?: (title: string, body: string, tone?: "success" | "error") => void,
): Promise<void> {
  const url = getExplorerTxUrl(data.hash);
  const text = formatReceiptText(data);

  try {
    await Clipboard.setStringAsync(url);
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Tera Wallet Receipt",
          text,
          url,
        });
        onNotice?.("Receipt shared", "Transaction link shared successfully.", "success");
        return;
      } catch {
        // Fallback to clipboard
      }
    } else if (Platform.OS !== "web") {
      try {
        await Share.share({
          message: `${text}\n\n${url}`,
          url,
          title: "Tera Wallet Receipt",
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    onNotice?.("Link copied", "Transaction explorer link copied to clipboard.", "success");
  } catch (e) {
    onNotice?.("Share failed", e instanceof Error ? e.message : "Couldn't share receipt.", "error");
  }
}

/**
 * Share / Save receipt as an Image (Canvas PNG).
 */
export async function shareReceiptViaImage(
  data: ReceiptShareData,
  onNotice?: (title: string, body: string, tone?: "success" | "error") => void,
): Promise<void> {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    // For non-web environments, fall back to link sharing
    return shareReceiptViaLink(data, onNotice);
  }

  try {
    const canvas = document.createElement("canvas");
    const width = 840;
    const height = 1060;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context");

    // Background gradient
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, "#0c1510");
    bgGradient.addColorStop(0.5, "#132119");
    bgGradient.addColorStop(1, "#0d1711");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Subtle outer border
    ctx.strokeStyle = "#25402f";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // Decorative inner card
    ctx.fillStyle = "#16281e";
    ctx.beginPath();
    ctx.roundRect(40, 40, width - 80, height - 80, 16);
    ctx.fill();
    ctx.strokeStyle = "#2f523c";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Header: TERA WALLET
    ctx.fillStyle = "#6be48a";
    ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillText("TERA WALLET · OFFICIAL RECEIPT", 70, 95);

    // Main Title / Action
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(data.title, 70, 145);

    // Status Pill
    const isSuccess = data.status.toLowerCase().includes("confirm") || data.status.toLowerCase() === "delivered" || data.status.toLowerCase() === "success";
    const statusText = isSuccess ? "✓ CONFIRMED ON-CHAIN" : data.status.toUpperCase();
    ctx.fillStyle = isSuccess ? "#1e4d30" : "#4a3319";
    ctx.beginPath();
    ctx.roundRect(70, 175, ctx.measureText(statusText).width + 36, 34, 17);
    ctx.fill();
    ctx.fillStyle = isSuccess ? "#6ee7b7" : "#fcd34d";
    ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(statusText, 88, 197);

    // Amount Banner
    ctx.fillStyle = "#1b3326";
    ctx.beginPath();
    ctx.roundRect(70, 235, width - 140, 110, 14);
    ctx.fill();
    ctx.strokeStyle = "#2d5740";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#a1cbb1";
    ctx.font = "13px monospace";
    ctx.fillText("TOTAL AMOUNT", 95, 270);

    const amountDisplay = data.amount && data.symbol ? `${data.amount} ${data.symbol}` : data.amount || "—";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(amountDisplay, 95, 322);

    // Details Grid
    let y = 390;
    const drawRow = (label: string, value: string, isMono = false) => {
      ctx.fillStyle = "#8fa395";
      ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillText(label, 70, y);

      ctx.fillStyle = "#f3f5f3";
      ctx.font = isMono
        ? "13px monospace"
        : "500 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const valueX = width - 70 - ctx.measureText(value).width;
      ctx.fillText(value, Math.max(260, valueX), y);

      // Hairline divider
      ctx.strokeStyle = "#203628";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(70, y + 16);
      ctx.lineTo(width - 70, y + 16);
      ctx.stroke();

      y += 46;
    };

    drawRow("Date & Time", formatReceiptDate(data.createdAt));
    const toDisplay = data.recipientName
      ? `${data.recipientName} (${shortAddress(data.payee || data.recipient)})`
      : data.payee || data.recipient || "—";
    drawRow("Recipient", toDisplay);
    if (data.sender) drawRow("Sender", shortAddress(data.sender));
    drawRow("Network", "Robinhood Chain (ID: 4663)");
    if (data.block) drawRow("Block Number", `#${data.block.toLocaleString()}`);
    if (data.feeEth) drawRow("Network Fee", `${data.feeEth} ETH`);
    if (data.delivery) drawRow("Delivery Status", data.delivery);

    // Full Transaction Hash Section
    y += 10;
    ctx.fillStyle = "#8fa395";
    ctx.font = "13px monospace";
    ctx.fillText("TRANSACTION HASH", 70, y);
    y += 24;

    ctx.fillStyle = "#122018";
    ctx.beginPath();
    ctx.roundRect(70, y, width - 140, 48, 8);
    ctx.fill();
    ctx.fillStyle = "#6de39c";
    ctx.font = "13px monospace";
    ctx.fillText(data.hash, 86, y + 29);

    // Footer info & seal
    y += 85;
    ctx.fillStyle = "#607567";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("Verified on-chain · Robinhood Chain Blockscout Explorer", 70, y);
    ctx.fillText("Tera Wallet Secure Enclave", 70, y + 20);

    // Trigger image download / share
    canvas.toBlob(async (blob) => {
      if (!blob) throw new Error("Canvas blob conversion failed");
      const filename = `tera-receipt-${data.hash.slice(0, 10)}.png`;

      // Try Web Share with file first if supported
      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.share
      ) {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: "Tera Wallet Receipt",
              text: `Receipt for ${amountDisplay} to ${toDisplay}`,
            });
            onNotice?.("Receipt shared", "Receipt image shared successfully.", "success");
            return;
          } catch {
            // User cancelled or share failed, fallback to download
          }
        }
      }

      // Download fallback
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onNotice?.("Receipt downloaded", `Saved ${filename} to your device.`, "success");
    }, "image/png");
  } catch (e) {
    onNotice?.("Image failed", e instanceof Error ? e.message : "Couldn't generate receipt image.", "error");
  }
}

/**
 * Share / Export receipt as PDF.
 * Uses print-to-PDF formatting and client-side PDF document generation.
 */
export async function shareReceiptViaPdf(
  data: ReceiptShareData,
  onNotice?: (title: string, body: string, tone?: "success" | "error") => void,
): Promise<void> {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return shareReceiptViaLink(data, onNotice);
  }

  try {
    const explorerUrl = getExplorerTxUrl(data.hash);
    const amountStr = data.amount && data.symbol ? `${data.amount} ${data.symbol}` : data.amount || "—";
    const toStr = data.recipientName
      ? `${data.recipientName} (${data.payee || data.recipient || "—"})`
      : data.payee || data.recipient || "—";
    const isSuccess = data.status.toLowerCase().includes("confirm") || data.status.toLowerCase() === "delivered" || data.status.toLowerCase() === "success";

    const printHtml = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Tera Wallet Receipt - ${data.hash.slice(0, 10)}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            color: #17241c;
            background: #ffffff;
            margin: 0;
            padding: 24px;
            max-width: 680px;
            margin: auto;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #204e35;
            padding-bottom: 16px;
            margin-bottom: 24px;
          }
          .brand {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: #1d4330;
          }
          .badge {
            display: inline-block;
            padding: 5px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            background: ${isSuccess ? "#e2f3e8" : "#fef3c7"};
            color: ${isSuccess ? "#175231" : "#92400e"};
          }
          .amount-box {
            background: #f4f7f4;
            border: 1px solid #d4e0d7;
            border-radius: 12px;
            padding: 24px;
            text-align: center;
            margin-bottom: 28px;
          }
          .amount-label {
            font-size: 12px;
            color: #556c5e;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 6px;
          }
          .amount-value {
            font-size: 38px;
            font-weight: 800;
            color: #153724;
          }
          .table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 28px;
          }
          .table tr {
            border-bottom: 1px solid #e7ebe8;
          }
          .table td {
            padding: 12px 6px;
            font-size: 14px;
          }
          .table td.label {
            color: #617769;
            width: 35%;
          }
          .table td.value {
            font-weight: 600;
            color: #16291e;
            text-align: right;
            word-break: break-all;
          }
          .mono {
            font-family: "Courier New", Courier, monospace;
            font-size: 12px;
          }
          .hash-box {
            background: #f8faf8;
            border: 1px dashed #b9c7bd;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 24px;
            font-size: 11px;
            word-break: break-all;
            color: #274533;
          }
          .footer {
            font-size: 12px;
            color: #798e81;
            text-align: center;
            border-top: 1px solid #e0e6e2;
            padding-top: 18px;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">TERA WALLET</div>
          <div class="badge">${isSuccess ? "✓ CONFIRMED" : data.status.toUpperCase()}</div>
        </div>

        <div class="amount-box">
          <div class="amount-label">Transaction Receipt</div>
          <div class="amount-value">${amountStr}</div>
        </div>

        <table class="table">
          <tr>
            <td class="label">Action</td>
            <td class="value">${data.title}</td>
          </tr>
          <tr>
            <td class="label">Date & Time</td>
            <td class="value">${formatReceiptDate(data.createdAt)}</td>
          </tr>
          <tr>
            <td class="label">Recipient</td>
            <td class="value">${toStr}</td>
          </tr>
          ${data.sender ? `<tr><td class="label">Sender</td><td class="value mono">${data.sender}</td></tr>` : ""}
          <tr>
            <td class="label">Network</td>
            <td class="value">Robinhood Chain (ID: 4663)</td>
          </tr>
          ${data.block ? `<tr><td class="label">Block</td><td class="value">#${data.block.toLocaleString()}</td></tr>` : ""}
          ${data.feeEth ? `<tr><td class="label">Network Fee</td><td class="value">${data.feeEth} ETH</td></tr>` : ""}
          ${data.delivery ? `<tr><td class="label">Delivery</td><td class="value">${data.delivery}</td></tr>` : ""}
        </table>

        <div class="hash-box">
          <strong>Transaction Hash:</strong><br>
          <span class="mono">${data.hash}</span>
        </div>

        <div class="footer">
          Verified on Robinhood Chain Blockscout Explorer<br>
          <span class="mono">${explorerUrl}</span>
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    // Render print frame
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(printHtml);
      doc.close();
      onNotice?.("Print / PDF Ready", "Opening PDF print preview dialog.", "success");
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 60000);
    } else {
      throw new Error("Unable to open print document");
    }
  } catch (e) {
    onNotice?.("PDF failed", e instanceof Error ? e.message : "Couldn't generate PDF receipt.", "error");
  }
}
