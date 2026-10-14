// Content-Security-Policy for the web wallet (/app) and the dashboard
// (/dashboard). site-pages.ts adds the header when it serves those pages.
//
// The policy decides what a page may load and run. If an attacker gets a
// script tag into one of these pages (a poisoned dependency's injected
// markup, an XSS in rendered data), the browser refuses to run it, and on
// /app it can't send anything to a server that isn't on the list either.
// Both pages hold a wallet, so this is the backstop for everything else.
//
// The rules, each one a test:
//
//   Scripts run only from this site. Inline scripts are allowed one by one,
//   by the SHA-256 hash of their exact text, computed from the page as it is
//   served, so an edited page can't drift out of its own policy and an
//   injected inline script never matches. No eval.
//
//   /app connects only to Tera's API, the four Robinhood Chain nodes and the
//   explorer, which is everything it calls. The dashboard connects to any
//   https/wss host, because WalletConnect and the wallet SDKs it carries
//   reach relays and RPCs that change per wallet; its scripts are still
//   locked down.
//
//   Neither page can be framed by another site, plugins are off, and <base>
//   can't be used to re-point relative URLs.
//
//   Styles allow inline: React Native Web and the dashboard set styles from
//   script, and a style can't run code.

export const APP_CONNECT = [
  "https://api.terawallet.app",
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://4663.rpc.thirdweb.com",
  "https://robinhoodchain.blockscout.com",
];

// WalletConnect's verify and embedded-wallet frames, and Coinbase's popup host.
export const DASHBOARD_FRAMES = [
  "https://verify.walletconnect.org",
  "https://verify.walletconnect.com",
  "https://secure.walletconnect.org",
  "https://secure-mobile.walletconnect.org",
  "https://secure-mobile.walletconnect.com",
  "https://keys.coinbase.com",
];

/** Which policy a path gets: "app", "dashboard", or null for none. */
export function surfaceFor(pathname) {
  if (/^\/app(?:\/|$)/.test(pathname)) return "app";
  if (/^\/dashboard(?:\/|$)/.test(pathname)) return "dashboard";
  return null;
}

/**
 * The text of every inline script the browser would run: <script> without a
 * src, whose type is absent or a JavaScript type. A JSON data block (the
 * dashboard's tera-config) is never run, so it needs no hash.
 */
export function inlineScripts(html) {
  const out = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !["text/javascript", "module", "application/javascript"].includes(type)) continue;
    out.push(match[2]);
  }
  return out;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * The header value for a page.
 * options.connect: extra origins /app may reach (a configured API or RPC).
 */
export async function policyFor(surface, html, options = {}) {
  const hashes = await Promise.all([...new Set(inlineScripts(html))].map(sha256));
  const common = [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: mediastream:",
  ];
  if (surface === "app") {
    const connect = [...new Set([...APP_CONNECT, ...(options.connect || []).map(origin).filter(Boolean)])];
    return [
      ...common,
      ["script-src", "'self'", ...hashes].join(" "),
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      ["connect-src", "'self'", ...connect].join(" "),
      "frame-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
  }
  return [
    ...common,
    // The on-device assistant runs ONNX in WebAssembly, which needs compiling;
    // that is all 'wasm-unsafe-eval' allows — not eval of script text.
    ["script-src", "'self'", "'wasm-unsafe-eval'", ...hashes].join(" "),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com",
    "connect-src 'self' https: wss:",
    ["frame-src", ...DASHBOARD_FRAMES].join(" "),
    "upgrade-insecure-requests",
  ].join("; ");
}
