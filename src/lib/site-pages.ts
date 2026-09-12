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

  const html = await loader();
  return new Response(html, {
    status: found ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
