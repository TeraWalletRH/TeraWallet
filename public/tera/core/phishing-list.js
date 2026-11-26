// Known-phishing dApp domains: a hostname the extension refuses to connect
// to before the approval window even opens.
//
// This resolves nothing and fetches nothing itself, same discipline as
// tags.js and dapp-connect.js: extension/src/phishing.ts owns the list
// (fetched from a maintained source, cached, refreshed) and asks this module
// the one question it answers -- is this hostname on it.
//
// A hostname, not an origin: https://evil.io and http://evil.io are the same
// site for this purpose, and a blocklist entry should catch both.

/** The hostname a check compares against, or "" when the origin can't give one. */
export function hostnameOf(origin) {
  try {
    return new URL(String(origin ?? "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Whether a hostname is on a blocklist. `list` may be an array or a Set.
 *
 * Checks the hostname itself and each of its parent domains (but never a
 * bare TLD on its own) -- phishing operators routinely stand up a fresh
 * subdomain of an already-blocklisted domain, and the dataset this checks
 * against (see extension/src/phishing.ts) expects that suffix match.
 */
export function isListed(hostname, list) {
  if (!hostname) return false;
  const set = list instanceof Set ? list : new Set(Array.isArray(list) ? list : []);
  const labels = hostname.split(".");
  const minLabels = labels.length > 1 ? 2 : 1;
  for (let i = 0; i <= labels.length - minLabels; i++) {
    if (set.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
