import { API } from "./config";
export async function api(path: string, body?: unknown, method?: string) {
  if (!API.startsWith("https://")) throw new Error("HTTPS is required.");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error("Service unavailable. Please retry. / 服务不可用，请重试。");
  }
  const result = await response.json();
  if (!response.ok || result.success === false)
    throw new Error(
      typeof result.error === "string" ? result.error : "Request failed. / 请求失败。",
    );
  return result;
}
