// Serves the exported Tera Wallet static pages (src/site/**) at pretty URLs.
import { policyFor, surfaceFor } from "./csp.js";

const pages = import.meta.glob("../site/**/index.html", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function keyFor(pathname: string) {
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  return clean ? `../site/${clean}/index.html` : "../site/index.html";
}

export async function serveSitePage(pathname: string): Promise<Response> {
  const pageKey = keyFor(pathname);
  const isAdminRoute = /^\/admin(?:\/|$)/.test(pathname);

  // Check for direct key match or admin fallback
  let loader = pages[pageKey];
  let found = Boolean(loader);

  if (!found && isAdminRoute) {
    loader = pages["../site/admin/index.html"] || pages["../site/admin/login/index.html"] || pages["../site/admin/staking/index.html"];
    found = Boolean(loader);
  }

  if (!loader) {
    loader = pages["../site/404/index.html"];
  }

  if (!loader) {
    return new Response("Not found", { status: 404 });
  }

  let html = await loader();

  if (/^\/dashboard(?:\/|$)/.test(pathname)) {
    const configuration = {
      apiUrl:
        import.meta.env["VITE_BACKEND_URL"] ||
        import.meta.env["VITE_API_URL"] ||
        "https://api.terawallet.app",
      chainId: Number(import.meta.env["VITE_CHAIN_ID"] || 4663),
      rpcUrl: import.meta.env["VITE_RPC_URL"] || "https://rpc.mainnet.chain.robinhood.com",
      walletConnectProjectId: import.meta.env["VITE_WALLETCONNECT_PROJECT_ID"] || "",
      explorerUrl: import.meta.env["VITE_EXPLORER_URL"] || "https://robinhoodchain.blockscout.com",
      policySignerAddress: import.meta.env["VITE_POLICY_SIGNER_ADDRESS"] || "",
      policyBundleUrl: import.meta.env["VITE_POLICY_BUNDLE_URL"] || "",
      policyBundleMaxAgeSeconds: Number(
        import.meta.env["VITE_POLICY_BUNDLE_MAX_AGE_SECONDS"] || 86400,
      ),
      ohttpRelayUrl: import.meta.env["VITE_OHTTP_RELAY_URL"] || "",
      ohttpKeyConfigUrl: import.meta.env["VITE_OHTTP_KEY_CONFIG_URL"] || "",
      ohttpPaths: (
        import.meta.env["VITE_OHTTP_PATHS"] ||
        "/api/agent/chat,/api/agent/propose,/api/tags/resolve"
      )
        .split(",")
        .map((path: string) => path.trim())
        .filter(Boolean),
    };
    const json = JSON.stringify(configuration).replace(/</g, "\\u003c");
    html = html.replace(
      "</head>",
      `<script id="tera-config" type="application/json">${json}</script></head>`,
    );
  }

  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    // Never let the browser guess a content type from a response body.
    "x-content-type-options": "nosniff",
    // The full URL (which can carry a tag, a referral code, a wallet address
    // in a share link) is never sent to a site a link on this page opens --
    // only the origin is, and nothing at all cross-scheme.
    "referrer-policy": "strict-origin-when-cross-origin",
    // Nothing on these pages asks for a camera, microphone or location.
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  // /app and the dashboard hold a wallet: limit what they may load and run.
  const surface = found ? surfaceFor(pathname) : null;
  if (surface)
    headers["content-security-policy"] = await policyFor(surface, html, {
      connect: [
        import.meta.env["VITE_BACKEND_URL"],
        import.meta.env["VITE_API_URL"],
        import.meta.env["VITE_RPC_URL"],
        import.meta.env["VITE_EXPLORER_URL"],
      ].filter(Boolean),
    });

  return new Response(html, {
    status: found ? 200 : 404,
    headers,
  });
}
