// Serves the exported Tera Wallet static pages (src/site/**) at pretty URLs.
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

  return new Response(html, {
    status: found ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
