const BLOCKED_PATTERNS = [/mnemonic/i, /seed/i, /privatekey/i, /secret/i];

export function isShareable(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!isShareable(text)) {
    throw new Error("Security policy violation: Cannot copy private credentials.");
  }
  try {
    const Clipboard = require("expo-clipboard");
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(text.trim());
      return true;
    }
  } catch (_) {
    // Fallback if expo-clipboard isn't available
  }
  return false;
}

// "shared" means the OS share sheet actually handed it off; "copied" means
// no share sheet was available (e.g. desktop web, where navigator.share
// doesn't exist) and it landed on the clipboard instead -- callers need to
// tell those two apart so a silent clipboard fallback doesn't look like
// nothing happened, see the web Share buttons in App.tsx.
export type ShareOutcome = "shared" | "copied" | "failed";

export async function shareText({ title = "Tera Wallet", text, url }: { title?: string; text?: string; url?: string }): Promise<ShareOutcome> {
  if ((text && !isShareable(text)) || (url && !isShareable(url))) {
    throw new Error("Security policy violation: Cannot share private credentials.");
  }
  const message = [text?.trim(), url?.trim()].filter(Boolean).join("\n");
  if (!message) return "failed";

  try {
    const rn = require("react-native");
    if (rn?.Share?.share) {
      const result = await rn.Share.share({ title, message });
      return result.action === rn.Share.sharedAction ? "shared" : "failed";
    }
  } catch (_) {
    // Fallback if react-native Share isn't available (e.g. desktop web,
    // where navigator.share doesn't exist) -- not reached once a native
    // Share.share call has actually started, so a dismissed native share
    // sheet above returns "failed" rather than falling through to here.
  }

  return (await copyToClipboard(message)) ? "copied" : "failed";
}

export function generateActivityCsv(history: any[]): string {
  const headers = ["Date", "TxHash", "Action", "Payee", "Status", "ChainID"];
  const escapeCsv = (str: string | number | undefined) => {
    const val = str === undefined || str === null ? "" : String(str);
    return `"${val.replace(/"/g, '""')}"`;
  };

  const rows = Array.isArray(history)
    ? history.map((item) => {
        const date = item.createdAt || item.timestamp || "";
        const hash = item.txHash || item.hash || "";
        const action = item.action || item.actionType || "TRANSFER";
        const payee = item.payee || item.to || item.recipient || "";
        const status = item.status || "confirmed";
        const chainId = item.chainId || 4663;
        return [date, hash, action, payee, status, chainId].map(escapeCsv).join(",");
      })
    : [];

  return [headers.map(escapeCsv).join(","), ...rows].join("\n");
}
