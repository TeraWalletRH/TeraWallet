// The Oblivious HTTP gateway (RFC 9458).
//
// A client seals a request to this gateway's key and hands it to a relay run by
// somebody else. The relay opens the connection here, so this server sees the
// relay's network address instead of the owner's. What arrives is opened,
// dispatched to an allow-listed route on this same service, and the reply is
// sealed back to the client.
//
// Two properties this file is responsible for, both easy to lose by accident:
//
//   The gateway must learn nothing about the client from the transport. The
//   relay's address, its headers and its TLS session are all discarded, and the
//   inner request is dispatched over loopback so the inner route sees no client
//   address at all.
//
//   Every failure must look the same from outside. A gateway that answers
//   "unknown key" differently from "bad ciphertext" lets a prober map which key
//   identifiers are live and confirm whether a capsule was well formed, so every
//   error below returns one status with no body.

import { Router, type Request, type Response } from "express";
import express from "express";
import { env } from "../env";
import { logEvent } from "../logging";
import {
  HpkeError,
  REQUEST_MEDIA_TYPE,
  RESPONSE_MEDIA_TYPE,
  encodeKeyConfig,
  openRequest,
  privateKeyFromRaw,
  sealResponse,
  type GatewayKey,
} from "../ohttp/hpke";
import { decodeRequest, encodeResponse } from "../ohttp/bhttp";

const router = Router();

export const KEYS_MEDIA_TYPE = "application/ohttp-keys";
export const KEY_CONFIG_PATH = "/.well-known/ohttp-gateway";
export const GATEWAY_PATH = "/ohttp";

// The assistant call is what this exists for. Anything not listed is refused:
// an open gateway is a proxy, and a proxy on this origin would let a caller
// borrow the service's own network position.
export const DEFAULT_ALLOWED_PATHS = ["/api/agent/chat", "/api/agent/propose"] as const;

const MAX_CAPSULE_BYTES = 64 * 1024;

const allowedPaths = (): Set<string> =>
  new Set<string>(env.ohttpAllowedPaths.length ? env.ohttpAllowedPaths : DEFAULT_ALLOWED_PATHS);

/**
 * Load the gateway key from configuration.
 *
 * An unconfigured gateway stays off. Generating a key at boot would work for one
 * process and break every time the service restarted or scaled to a second
 * instance, and a client that cannot reach the key it sealed to gets a failure
 * it cannot interpret. Off and honest beats intermittently broken.
 */
export function loadKeys(): GatewayKey[] {
  if (!env.ohttpPrivateKey) return [];
  let raw: Buffer;
  try {
    raw = Buffer.from(env.ohttpPrivateKey.replace(/^0x/, ""), "hex");
  } catch {
    throw new Error("OHTTP_PRIVATE_KEY is not valid hex.");
  }
  if (raw.length !== 32) throw new Error("OHTTP_PRIVATE_KEY must be 32 bytes of hex.");
  return [{ keyId: env.ohttpKeyId, privateKey: privateKeyFromRaw(raw) }];
}

// Resolved on use rather than at import, and memoised on the configured value.
//
// Reading the key when this module is first imported ties the feature to import
// order: anything that pulls in the app before the environment is loaded leaves
// the gateway permanently off, and it fails by disappearing rather than by
// complaining. Deriving the key is the only cost here, and it happens once per
// distinct value.
let cache: { source: string; id: number; keys: GatewayKey[] } | null = null;

function activeKeys(): GatewayKey[] {
  const source = env.ohttpPrivateKey;
  const id = env.ohttpKeyId;
  if (cache && cache.source === source && cache.id === id) return cache.keys;
  let keys: GatewayKey[] = [];
  try {
    keys = loadKeys();
  } catch (error) {
    logEvent("error", undefined, "ohttp_key_invalid", { reason: (error as Error).message });
  }
  cache = { source, id, keys };
  return keys;
}

export const gatewayEnabled = (): boolean => activeKeys().length > 0;

router.get(KEY_CONFIG_PATH, (_req: Request, res: Response) => {
  if (!gatewayEnabled()) {
    res.status(404).end();
    return;
  }
  res
    .status(200)
    .type(KEYS_MEDIA_TYPE)
    // The key configuration is public and identical for every client, so it can
    // be cached hard. A client that fetches it on each request would hand the
    // gateway a timing signal it does not otherwise have.
    .header("Cache-Control", "public, max-age=3600")
    .send(encodeKeyConfig(activeKeys()));
});

router.post(
  GATEWAY_PATH,
  express.raw({ type: REQUEST_MEDIA_TYPE, limit: MAX_CAPSULE_BYTES }),
  async (req: Request, res: Response) => {
    if (!gatewayEnabled()) {
      res.status(404).end();
      return;
    }
    // One shape for every failure before the reply can be sealed. The client
    // cannot tell an unknown key from a corrupt capsule, and neither can anyone
    // probing this endpoint.
    const refuse = (reason: string) => {
      logEvent("warn", req.requestId, "ohttp_refused", { reason });
      res.status(400).end();
    };

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      refuse("empty_body");
      return;
    }

    let opened;
    try {
      opened = openRequest(req.body, activeKeys());
    } catch (error) {
      refuse(error instanceof HpkeError ? "hpke" : "malformed");
      return;
    }

    let inner;
    try {
      inner = decodeRequest(opened.body);
    } catch {
      refuse("bhttp");
      return;
    }

    // From here the client is authenticated to the extent that matters: it holds
    // a context this gateway can seal to. Failures below are answered inside the
    // capsule, because the client can read them and nobody else can.
    const sealed = async (status: number, payload: unknown) =>
      sealResponse(
        opened.context,
        encodeResponse(
          status,
          { "content-type": "application/json" },
          Buffer.from(JSON.stringify(payload)),
        ),
      );

    const path = inner.path.split("?")[0] ?? "";
    if (!allowedPaths().has(path)) {
      res
        .status(200)
        .type(RESPONSE_MEDIA_TYPE)
        .send(
          await sealed(404, {
            success: false,
            error: "This route is not available through the gateway.",
          }),
        );
      return;
    }

    try {
      const upstream = await fetch(`${env.ohttpDispatchOrigin}${inner.path}`, {
        method: inner.method,
        headers: {
          // Only what the inner route needs to parse the body. Nothing from the
          // relay's connection is forwarded, including anything that could
          // re-identify the client.
          "Content-Type": inner.headers["content-type"] ?? "application/json",
          Accept: "application/json",
          "X-Forwarded-For": "",
        },
        body:
          inner.method === "GET" || inner.method === "HEAD"
            ? undefined
            : new Uint8Array(inner.body),
        signal: AbortSignal.timeout(20000),
      });
      const text = await upstream.text();
      res
        .status(200)
        .type(RESPONSE_MEDIA_TYPE)
        .send(
          sealResponse(
            opened.context,
            encodeResponse(
              upstream.status,
              { "content-type": upstream.headers.get("content-type") ?? "application/json" },
              Buffer.from(text),
            ),
          ),
        );
    } catch (error) {
      logEvent("error", req.requestId, "ohttp_dispatch_failed", {
        reason: (error as Error).message,
      });
      res
        .status(200)
        .type(RESPONSE_MEDIA_TYPE)
        .send(
          await sealed(502, { success: false, error: "The gateway could not reach the service." }),
        );
    }
  },
);

export default router;
