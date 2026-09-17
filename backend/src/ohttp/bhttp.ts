// Binary HTTP (RFC 9292), known-length form: the message format carried inside
// an Oblivious HTTP capsule. The gateway decodes a request and encodes a reply;
// it never needs the indeterminate-length form, so that is not implemented.

export class BhttpError extends Error {}

export interface BhttpRequest {
  method: string;
  scheme: string;
  authority: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
}

export function encodeVarint(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0) throw new BhttpError("Length must be a whole number.");
  if (value < 1 << 6) return Buffer.from([value]);
  if (value < 1 << 14) {
    const out = Buffer.alloc(2);
    out.writeUInt16BE(value);
    out[0]! |= 0x40;
    return out;
  }
  if (value < 2 ** 30) {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value);
    out[0]! |= 0x80;
    return out;
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  out[0]! |= 0xc0;
  return out;
}

export function readVarint(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  if (offset >= bytes.length) throw new BhttpError("The message ended inside a length.");
  const length = 1 << (bytes[offset]! >> 6);
  if (offset + length > bytes.length) throw new BhttpError("The message ended inside a length.");
  let value = BigInt(bytes[offset]! & 0x3f);
  for (let index = 1; index < length; index += 1)
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new BhttpError("Length is out of range.");
  return { value: Number(value), offset: offset + length };
}

function readBytes(bytes: Uint8Array, offset: number, length: number) {
  if (offset + length > bytes.length) throw new BhttpError("The message ended early.");
  return { value: Buffer.from(bytes.subarray(offset, offset + length)), offset: offset + length };
}

function readString(bytes: Uint8Array, offset: number) {
  const length = readVarint(bytes, offset);
  const read = readBytes(bytes, length.offset, length.value);
  return { value: read.value.toString("utf8"), offset: read.offset };
}

const varstr = (value: string | Buffer): Buffer => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarint(bytes.length), bytes]);
};

/** Decode a known-length binary HTTP request. */
export function decodeRequest(bytes: Uint8Array): BhttpRequest {
  if (bytes.length === 0 || bytes[0] !== 0x00)
    throw new BhttpError("Not a known-length binary HTTP request.");
  let offset = 1;
  const method = readString(bytes, offset);
  const scheme = readString(bytes, method.offset);
  const authority = readString(bytes, scheme.offset);
  const path = readString(bytes, authority.offset);
  offset = path.offset;

  const fieldLength = readVarint(bytes, offset);
  const end = fieldLength.offset + fieldLength.value;
  if (end > bytes.length) throw new BhttpError("The message ended inside its headers.");
  const headers: Record<string, string> = {};
  offset = fieldLength.offset;
  while (offset < end) {
    const name = readString(bytes, offset);
    const value = readString(bytes, name.offset);
    if (value.offset > end) throw new BhttpError("A header ran past its section.");
    headers[name.value.toLowerCase()] = value.value;
    offset = value.offset;
  }

  const contentLength = readVarint(bytes, end);
  const content = readBytes(bytes, contentLength.offset, contentLength.value);
  // Trailers and padding may follow. Neither is used here, and neither is read.
  return {
    method: method.value,
    scheme: scheme.value,
    authority: authority.value,
    path: path.value,
    headers,
    body: content.value,
  };
}

/** Encode a known-length binary HTTP response. */
export function encodeResponse(
  status: number,
  headers: Record<string, string>,
  body: Uint8Array,
): Buffer {
  if (!Number.isInteger(status) || status < 200 || status > 599)
    throw new BhttpError("A final response status is between 200 and 599.");
  const fields = Buffer.concat(
    Object.entries(headers).map(([name, value]) =>
      Buffer.concat([varstr(name.toLowerCase()), varstr(String(value))]),
    ),
  );
  return Buffer.concat([
    Buffer.from([0x01]), // known-length response
    encodeVarint(status),
    encodeVarint(fields.length),
    fields,
    encodeVarint(body.length),
    Buffer.from(body),
    encodeVarint(0), // no trailers
  ]);
}
