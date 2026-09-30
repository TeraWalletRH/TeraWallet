import { createFileRoute } from "@tanstack/react-router";

const upstream =
  process.env["VITE_BACKEND_URL"] ||
  process.env["VITE_API_URL"] ||
  "http://127.0.0.1:3001";

async function proxy({ request, params }: { request: Request; params: { _splat?: string } }) {
  const url = new URL(request.url);
  const path = params._splat ? `/${params._splat}` : "";
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  const adminToken = request.headers.get("x-admin-token");

  if (contentType) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  if (adminToken) headers.set("x-admin-token", adminToken);

  const targetUrl = `${upstream}/api/admin${path}${url.search}`;

  try {
    const isGetOrHead = ["GET", "HEAD"].includes(request.method);
    const bodyData = isGetOrHead ? null : await request.arrayBuffer();

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };
    if (bodyData !== null) {
      fetchOptions.body = bodyData;
    }

    const response = await fetch(targetUrl, fetchOptions);

    const outHeaders = new Headers();
    const respContentType = response.headers.get("content-type");
    const setCookie = response.headers.get("set-cookie");

    if (respContentType) outHeaders.set("content-type", respContentType);
    if (setCookie) outHeaders.set("set-cookie", setCookie);

    return new Response(response.body, { status: response.status, headers: outHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Failed to proxy admin request" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/admin/$" as any)({
  server: {
    handlers: {
      GET: proxy,
      POST: proxy,
      PATCH: proxy,
      PUT: proxy,
      DELETE: proxy,
    },
  },
  component: () => null,
});
