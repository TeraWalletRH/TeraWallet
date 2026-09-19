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
  const loader = pages[keyFor(pathname)] ?? pages["../site/404/index.html"];
  const found = Boolean(pages[keyFor(pathname)]);

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
      // The tag registry. Unset means this deployment has none deployed, and
      // the wallet hides every tag control rather than offering a lookup it
      // cannot make.
      tagRegistryAddress: import.meta.env["VITE_TAG_REGISTRY_ADDRESS"] || "",
      policyBundleUrl: import.meta.env["VITE_POLICY_BUNDLE_URL"] || "",
      policyBundleMaxAgeSeconds: Number(
        import.meta.env["VITE_POLICY_BUNDLE_MAX_AGE_SECONDS"] || 86400,
      ),
      // Oblivious HTTP. Unset means the wallet connects to Tera directly, which
      // is what it has always done. The relay must be operated by someone other
      // than Tera: the wallet refuses to run when it is not, because one party
      // holding both the address and the request is the thing this prevents.
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
