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

/** Whether a hostname is on a blocklist. `list` may be an array or a Set. */
export function isListed(hostname, list) {
  if (!hostname) return false;
  const set = list instanceof Set ? list : new Set(Array.isArray(list) ? list : []);
  return set.has(hostname);
}
