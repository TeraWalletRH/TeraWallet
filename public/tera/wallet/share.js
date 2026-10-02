/**
 * Copy and Share utilities for TeraWallet Web surfaces.
 * Provides resilient clipboard copy and native share integration for addresses and tx hashes.
 * STRICT SECURITY: Private keys, seed phrases, and secrets are strictly forbidden from export.
 */

const BLOCKED_PATTERNS = [/mnemonic/i, /seed/i, /privatekey/i, /secret/i];

export function isShareable(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

export async function copyToClipboard(text) {
  if (!isShareable(text)) {
    throw new Error("Security policy violation: Cannot copy private credentials.");
  }
  const clean = text.trim();
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(clean);
      return true;
    }
  } catch (_) {
    // Fallback to DOM execCommand if writeText fails
  }

  try {
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = clean;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) return true;
    }
  } catch (_) {
    // Fallback failure
  }
  return false;
}

export async function shareText({ title = "TeraWallet", text, url }) {
  if (!isShareable(text) || (url && !isShareable(url))) {
    throw new Error("Security policy violation: Cannot share private credentials.");
  }
  const payload = { title, text: text?.trim(), url: url?.trim() };
  if (navigator?.share) {
    try {
      await navigator.share(payload);
      return { shared: true, method: "native" };
    } catch (err) {
      if (err.name === "AbortError") {
        return { shared: false, method: "canceled" };
      }
    }
  }
  const target = payload.url || payload.text;
  if (target) {
    const copied = await copyToClipboard(target);
    return { shared: copied, method: "clipboard" };
  }
  return { shared: false, method: "none" };
}
