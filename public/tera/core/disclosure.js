// The assistant disclosure view: exactly what one assistant message sent.
// No network access of its own; android/src/api.ts builds the request (the
// same object its fetch uses) and android/App.tsx shows it under the message.
//
// "Private by default" is a claim. This makes it checkable: under each
// message the owner can open the request as it went over the wire — address,
// method, headers and body — and see what it holds and what it doesn't.
//
// The rules, each one a test:
//
//   The body is shown as sent, pretty-printed. The one exception is a
//   session token: it is masked to its last 4 characters, because this view
//   can end up in a screenshot and the token is a credential. The view says
//   the token was sent; it just doesn't print it.
//
//   The view lists every field the body contains, so "contains only:
//   message" is read off the request, not asserted.
//
//   It says whether the wallet address is anywhere in the request, checked
//   by searching the whole request (any case), not by field name.

const SECRET_KEYS = new Set(["sessionToken", "token", "authorization"]);

/** A credential shown as its last 4 characters. */
export const mask = (value) => {
  const s = String(value ?? "");
  return s.length > 4 ? `••••••${s.slice(-4)}` : "••••";
};

function masked(value) {
  if (Array.isArray(value)) return value.map(masked);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.has(k) ? mask(v) : masked(v)]),
    );
  return value;
}

/**
 * The disclosure for one request.
 * request: { url, method, headers, body (the JSON string as sent) }
 * options: { owner, at }
 */
export function disclose(request, options = {}) {
  let parsed;
  try {
    parsed = request.body === undefined ? undefined : JSON.parse(request.body);
  } catch {
    parsed = request.body;
  }
  const fields = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  const owner = String(options.owner ?? "").toLowerCase();
  const haystack = `${request.url} ${JSON.stringify(request.headers ?? {})} ${request.body ?? ""}`.toLowerCase();
  return {
    at: options.at ?? Date.now(),
    url: request.url,
    method: request.method,
    headers: { ...(request.headers || {}) },
    body: parsed === undefined ? "" : typeof parsed === "string" ? parsed : JSON.stringify(masked(parsed), null, 2),
    fields,
    secrets: fields.filter((k) => SECRET_KEYS.has(k)),
    addressSent: !!owner && haystack.includes(owner),
  };
}
