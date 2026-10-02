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

export async function shareText({ title = "Tera Wallet", text, url }: { title?: string; text?: string; url?: string }): Promise<boolean> {
  if ((text && !isShareable(text)) || (url && !isShareable(url))) {
    throw new Error("Security policy violation: Cannot share private credentials.");
  }
  const message = [text?.trim(), url?.trim()].filter(Boolean).join("\n");
  if (!message) return false;

  try {
    const rn = require("react-native");
    if (rn?.Share?.share) {
      const result = await rn.Share.share({ title, message });
      return result.action === rn.Share.sharedAction;
    }
  } catch (_) {
    // Fallback if react-native Share isn't available
  }

  return copyToClipboard(message);
}
