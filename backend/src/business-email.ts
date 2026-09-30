// Business emails, and who decides what one means.
//
// The same shape as the tag register (tags.ts), with one more proof: a tag is
// only ever claimed by the wallet that signs for it, but an email belongs to
// whoever reads the inbox. So linking takes both — the wallet's signature over
// the exact text in core/business-email.js, and a six-digit code sent to the
// inbox and typed back. Either alone would let someone route a business's
// incoming payments to a wallet the business does not hold.
//
// Resolving an email tells the caller which address a business is paid at,
// and so what it holds on-chain. That is the point of the feature and also
// its cost, so lookups are rate-limited per caller and every answer says
// `source: "service"`, as a tag's does.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { cleanName, linkMessage, parseEmail, unlinkMessage } from "./business-email-core";
import pool from "./db";
import { env } from "./env";

const SIGNATURE_WINDOW_MS = 5 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
/** A new code for one inbox at most this often, and this many an hour. */
const RESEND_AFTER_MS = 60_000;
const CODES_PER_HOUR = 5;

export class BusinessEmailError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const must = (condition: unknown, message: string, status = 422) => {
  if (!condition) throw new BusinessEmailError(message, status);
};

export const mailerReady = () => Boolean(env.resendApiKey);
export const enabled = () => Boolean(env.businessEmailEnabled && pool && mailerReady());

export function config() {
  return {
    enabled: enabled(),
    requires: {
      flag: env.businessEmailEnabled,
      database: Boolean(pool),
      mailer: mailerReady(),
    },
    authority:
      "Tera keeps the business email register. Paying an email means trusting this service to answer with the address its owner proved, so the address is always shown before you sign.",
    note: "An email only receives payments. It cannot sign in or recover a wallet: the recovery phrase is the only way back in.",
  };
}

function canonical(input: unknown) {
  const parsed = parseEmail(input);
  must(parsed.ok, parsed.reason);
  return parsed.email;
}

function owned(input: unknown) {
  must(
    typeof input === "string" && isAddress(input, { strict: false }),
    "A wallet address is required.",
  );
  return getAddress(input as string);
}

async function signedBy(
  message: string,
  address: `0x${string}`,
  signature: unknown,
  timestamp: number,
) {
  must(
    typeof signature === "string" && /^0x[\da-fA-F]{130}$/.test(signature),
    "A wallet signature is required.",
  );
  must(
    Number.isSafeInteger(timestamp) && Math.abs(Date.now() - timestamp) < SIGNATURE_WINDOW_MS,
    "This request has expired. Sign a new one and try again.",
  );
  let valid = false;
  try {
    valid = await verifyMessage({ address, message, signature: signature as Hex });
  } catch {
    valid = false;
  }
  must(valid, "That signature did not match this wallet.");
}

// A per-process key when none is configured: codes live ten minutes, so the
// only cost of a restart is that a code sent just before it stops working.
const secret = env.emailCodeSecret || randomBytes(32).toString("hex");

/** Bound to the email and the wallet, so a code only finishes the link it was sent for. */
export const hashCode = (email: string, owner: string, code: string) =>
  createHmac("sha256", secret).update(`${email}\n${owner.toLowerCase()}\n${code}`).digest("hex");

const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Six digits, leading zeros kept. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// --- Lookups, rate-limited per caller ------------------------------------------

const LOOKUP_WINDOW_MS = 60_000;
const LOOKUPS_PER_WINDOW = 30;
const lookups = new Map<string, { start: number; count: number }>();

/** False once a caller has looked up too many emails in the last minute. */
export function allowLookup(caller: string, now = Date.now()) {
  const entry = lookups.get(caller);
  if (!entry || now - entry.start > LOOKUP_WINDOW_MS) {
    lookups.set(caller, { start: now, count: 1 });
    if (lookups.size > 10_000) {
      for (const [key, value] of lookups)
        if (now - value.start > LOOKUP_WINDOW_MS) lookups.delete(key);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= LOOKUPS_PER_WINDOW;
}

export async function resolveEmail(input: unknown) {
  const email = canonical(input);
  const found = await pool!.query(
    "SELECT owner_address, business_name FROM business_emails WHERE email=$1",
    [email],
  );
  const row = found.rows[0];
  return {
    email,
    address: row ? getAddress(row.owner_address) : null,
    name: row?.business_name || "",
    resolvedAt: new Date().toISOString(),
    source: "service" as const,
  };
}

export async function emailForAddress(input: unknown) {
  const address = owned(input);
  const found = await pool!.query(
    "SELECT email, business_name, verified_at FROM business_emails WHERE owner_address=$1",
    [address],
  );
  const row = found.rows[0];
  return {
    address,
    email: row?.email ?? null,
    name: row?.business_name ?? "",
    verifiedAt: row?.verified_at ? new Date(row.verified_at).toISOString() : null,
    source: "service" as const,
  };
}

// --- Linking -------------------------------------------------------------------

async function deliver(email: string, code: string, name: string) {
  const who = name ? ` for ${name}` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [email],
      subject: `${code} is your Tera Business code`,
      text: [
        `Your Tera Business verification code is ${code}.`,
        "",
        `Enter it in Tera Business to receive payments at this email${who}. It expires in 10 minutes.`,
        "",
        "If you did not ask for this, ignore this email: nothing is linked until the code is entered.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Resend says why in its body ("domain is not verified", "API key is
    // invalid"). Logged in full for whoever runs this service, and passed on
    // in short, because "could not be reached" sent the owner looking in the
    // wrong place when the real answer was a setting.
    const detail = await response
      .json()
      .then((body: { message?: unknown }) => String(body?.message ?? ""))
      .catch(() => "");
    console.error(`business_email.deliver_failed status=${response.status} ${detail}`);
    throw new BusinessEmailError(
      `The code could not be sent${detail ? `: ${detail}` : ` (mail provider answered ${response.status})`}.`,
      502,
    );
  }
}

/**
 * Send a code to the inbox, after the wallet has signed for the email.
 *
 * The signature comes first so this cannot be used to mail codes at anyone
 * from an address nobody controls, and the per-inbox limits stop one wallet
 * from using it to flood someone's inbox.
 */
export async function startLink(body: {
  email?: unknown;
  name?: unknown;
  owner?: unknown;
  timestamp?: unknown;
  signature?: unknown;
}) {
  must(enabled(), "Business emails are unavailable.", 503);
  const email = canonical(body.email);
  const owner = owned(body.owner);
  const name = cleanName(body.name);
  const timestamp = Number(body.timestamp);
  await signedBy(
    linkMessage({ email, name, address: owner, timestamp }),
    owner,
    body.signature,
    timestamp,
  );

  const recent = await pool!.query(
    "SELECT created_at FROM business_email_codes WHERE email=$1 AND created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at DESC",
    [email],
  );
  const last = recent.rows[0]?.created_at ? new Date(recent.rows[0].created_at).getTime() : 0;
  must(
    Date.now() - last > RESEND_AFTER_MS,
    "A code was just sent. Wait a minute before asking for another.",
    429,
  );
  must(
    recent.rowCount! < CODES_PER_HOUR,
    "Too many codes for this email. Try again in an hour.",
    429,
  );

  const code = newCode();
  await pool!.query(
    `INSERT INTO business_email_codes(email, owner_address, business_name, code_hash, attempts, expires_at, created_at)
     VALUES($1,$2,$3,$4,0,$5,NOW())
     ON CONFLICT (email, owner_address) DO UPDATE
       SET business_name=EXCLUDED.business_name, code_hash=EXCLUDED.code_hash, attempts=0,
           expires_at=EXCLUDED.expires_at, created_at=NOW()`,
    [email, owner, name, hashCode(email, owner, code), new Date(Date.now() + CODE_TTL_MS)],
  );
  try {
    await deliver(email, code, name);
  } catch (error) {
    // A code that never arrived must not count toward the wait before the
    // next one, or a failed send would lock the owner out for a minute.
    await pool!
      .query("DELETE FROM business_email_codes WHERE email=$1 AND owner_address=$2", [email, owner])
      .catch(() => {});
    if (error instanceof BusinessEmailError) throw error;
    console.error("business_email.deliver_failed", error);
    throw new BusinessEmailError("The code could not be sent. Try again in a minute.", 502);
  }
  return { email, owner, sent: true, expiresInSeconds: CODE_TTL_MS / 1000 };
}

/**
 * Finish a link with the code from the inbox.
 *
 * The email moves to this wallet even if another wallet held it: whoever reads
 * the inbox is who the email belongs to. The wallet's own previous email is
 * released in the same transaction, so it never holds two.
 */
export async function verifyLink(body: { email?: unknown; owner?: unknown; code?: unknown }) {
  must(enabled(), "Business emails are unavailable.", 503);
  const email = canonical(body.email);
  const owner = owned(body.owner);
  const code = String(body.code ?? "").trim();
  must(/^\d{6}$/.test(code), "Enter the six-digit code from the email.");

  const db = await pool!.connect();
  try {
    await db.query("BEGIN");
    const pending = await db.query(
      "SELECT business_name, code_hash, attempts, expires_at FROM business_email_codes WHERE email=$1 AND owner_address=$2 FOR UPDATE",
      [email, owner],
    );
    const row = pending.rows[0];
    must(row, "Ask for a code first.");
    must(
      new Date(row.expires_at).getTime() > Date.now(),
      "That code has expired. Ask for a new one.",
    );
    must(row.attempts < MAX_ATTEMPTS, "Too many wrong codes. Ask for a new one.");
    if (!sameHash(row.code_hash, hashCode(email, owner, code))) {
      await db.query(
        "UPDATE business_email_codes SET attempts=attempts+1 WHERE email=$1 AND owner_address=$2",
        [email, owner],
      );
      await db.query("COMMIT");
      throw new BusinessEmailError("That code is not right. Check the email and try again.");
    }
    await db.query("DELETE FROM business_emails WHERE email=$1 OR owner_address=$2", [
      email,
      owner,
    ]);
    await db.query(
      "INSERT INTO business_emails(email, owner_address, business_name, verified_at) VALUES($1,$2,$3,NOW())",
      [email, owner, row.business_name || ""],
    );
    await db.query("DELETE FROM business_email_codes WHERE email=$1", [email]);
    await db.query("COMMIT");
    return { email, owner, name: row.business_name || "", verifiedAt: new Date().toISOString() };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

export async function unlink(body: {
  email?: unknown;
  owner?: unknown;
  timestamp?: unknown;
  signature?: unknown;
}) {
  must(enabled(), "Business emails are unavailable.", 503);
  const email = canonical(body.email);
  const owner = owned(body.owner);
  const timestamp = Number(body.timestamp);
  await signedBy(
    unlinkMessage({ email, address: owner, timestamp }),
    owner,
    body.signature,
    timestamp,
  );
  const gone = await pool!.query(
    "DELETE FROM business_emails WHERE email=$1 AND owner_address=$2",
    [email, owner],
  );
  must(gone.rowCount, "This wallet is not paid at that email.");
  return { email, owner, unlinked: true };
}
