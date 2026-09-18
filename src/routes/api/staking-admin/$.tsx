import { createFileRoute } from "@tanstack/react-router";

const upstream = "https://api.terawallet.app";

async function proxy({ request, params }: { request: Request; params: { _splat?: string } }) {
  const url = new URL(request.url);
  const path = params._splat ? `/${params._splat}` : "";
  const headers = new Headers();
  const type = request.headers.get("content-type");
  const cookie = request.headers.get("cookie");
  if (type) headers.set("content-type", type);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${upstream}/api/admin/staking${path}${url.search}`, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
  });
  const out = new Headers();
  const contentType = response.headers.get("content-type");
  const setCookie = response.headers.get("set-cookie");
  if (contentType) out.set("content-type", contentType);
  // The browser receives this cookie from the Tera site, rather than directly
  // from api.terawallet.app. Scope it to this proxy path so later admin calls
  // send it back here and the proxy can forward it upstream.
  if (setCookie) {
    out.set("set-cookie", setCookie.replace(/Path=\/api\/admin\/staking/gi, "Path=/api/staking-admin"));
  }
  return new Response(response.body, { status: response.status, headers: out });
}

export const Route = createFileRoute("/api/staking-admin/$")({
  server: { handlers: {
    GET: proxy, POST: proxy, PATCH: proxy, PUT: proxy, DELETE: proxy,
  } },
  component: () => null,
});
