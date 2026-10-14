import { API } from "./config";
/**
 * The exact request api() sends for these arguments. api() builds its fetch
 * from this, so a screen that shows the owner "what was sent" is showing the
 * request itself, not a description of it.
 */
export function requestFor(path: string, body?: unknown, method?: string) {
  return {
    url: `${API}${path}`,
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json" } as Record<string, string>,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
export async function api(path: string, body?: unknown, method?: string) {
  if (!API.startsWith("https://")) throw new Error("HTTPS is required.");
  const request = requestFor(path, body, method);
  const httpMethod = request.method;
  // Retried only for a GET, and only a network-level failure to reach the
  // server at all (a dropped connection, a timeout) — not a well-formed
  // HTTP error response. A POST is never retried here: resending one could
  // resubmit something with a real side effect (creating a job, issuing a
  // session), the same reason the wallet-sending RPC client isn't retried.
  const attempts = httpMethod === "GET" ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: httpMethod,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        continue;
      }
      throw new Error("Service unavailable. Please retry. / 服务不可用，请重试。");
    }
    const result = await response.json();
    if (!response.ok || result.success === false)
      throw new Error(
        typeof result.error === "string" ? result.error : "Request failed. / 请求失败。",
      );
    return result;
  }
  throw new Error("Service unavailable. Please retry. / 服务不可用，请重试。");
}
