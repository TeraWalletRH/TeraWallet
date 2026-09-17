// The published contract of the Oblivious HTTP transport. The wallet modules are
// plain browser JavaScript; this exists so the gateway's tests — which import
// this module directly, on purpose — are typechecked against the same shape the
// page uses. The build manifest hashes .js and .css only, so this file is not
// part of what the page verifies about itself.

export declare class OhttpError extends Error {
  constructor(message?: string);
  /** Marks a failure the transport can explain, so `createApi` does not flatten
   *  it into a generic connection error. */
  readonly transport: true;
}

/** What an owner is owed before this transport is described to them as privacy. */
export declare const LIMITS: readonly string[];

export declare const KEM_X25519_HKDF_SHA256: 0x0020;
export declare const KDF_HKDF_SHA256: 0x0001;
export declare const AEAD_AES_128_GCM: 0x0001;

export declare const REQUEST_MEDIA_TYPE: "message/ohttp-req";
export declare const RESPONSE_MEDIA_TYPE: "message/ohttp-res";
export declare const KEYS_MEDIA_TYPE: "application/ohttp-keys";

export interface KeyConfig {
  keyId: number;
  kemId: number;
  publicKey: Uint8Array;
  algorithms: { kdfId: number; aeadId: number }[];
}

/** A key configuration narrowed to the one suite this wallet implements. */
export interface SelectedKeyConfig extends KeyConfig {
  kdfId: number;
  aeadId: number;
}

/** The sender's HPKE context, needed to open the reply to a sealed request. */
export interface HpkeContext {
  key: Uint8Array;
  baseNonce: Uint8Array;
  exporterSecret: Uint8Array;
  suiteId: Uint8Array;
  enc: Uint8Array;
}

export interface BhttpRequestInit {
  method: string;
  scheme: string;
  authority: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface BhttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export declare function varint(value: number): Uint8Array;
export declare function readVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; offset: number };

export declare function encodeRequest(init: BhttpRequestInit): Uint8Array;
export declare function decodeResponse(bytes: Uint8Array): BhttpResponse;

export declare function parseKeyConfigs(bytes: Uint8Array): KeyConfig[];
export declare function selectKeyConfig(configs: KeyConfig[]): SelectedKeyConfig;

export declare function encapsulate(
  bhttpRequest: Uint8Array,
  config: SelectedKeyConfig,
): Promise<{ body: Uint8Array; context: HpkeContext }>;

export declare function decapsulate(
  context: HpkeContext,
  sealedResponse: Uint8Array,
): Promise<Uint8Array>;

/** What the privacy status centre is told about a sealed request: hosts and a
 *  route, never a header, a body or a value. */
export interface ObliviousLogEntry {
  relayHost: string;
  gatewayHost: string;
  path: string;
}

/** The part of `Response` that `createApi` actually uses. */
export interface OhttpResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface OhttpFetcherOptions {
  /** Must be operated by someone other than the gateway, or this is refused. */
  relayUrl: string;
  keyConfigUrl: string;
  gatewayUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  onRequest?: ((entry: ObliviousLogEntry) => void) | null;
}

export declare function createOhttpFetcher(
  options: OhttpFetcherOptions,
): (url: string, init?: RequestInit) => Promise<OhttpResponse>;
