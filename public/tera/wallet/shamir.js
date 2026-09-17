// Shamir secret sharing over GF(2^8), used to split the vault recovery key.
//
// A secret is split into `shares` pieces of which any `threshold` reconstruct
// it. Fewer than `threshold` shares reveal nothing about the secret — that is
// the property the scheme actually provides.
//
// It says nothing about the people holding the shares. Any `threshold` holders
// who co-operate reconstruct the secret without the owner, and nothing here
// prevents or detects that. Say so wherever this is offered.

// Field arithmetic over GF(2^8) with the 0x11d primitive polynomial and 2 as
// the generator. Both halves of that pair matter: 2 has order 255 under 0x11d,
// so the exponent table is a full cycle over every non-zero element. Pairing
// 0x11d with 3, or 0x11b with 2, gives a generator of order 51 and a field that
// silently computes the wrong products.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => {
  if (b === 0) throw new Error("Division by zero in the sharing field.");
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
};

/** Evaluate a polynomial given lowest-degree-first coefficients. */
function evaluate(coefficients, x) {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) result = mul(result, x) ^ coefficients[i];
  return result;
}

export const MAX_SHARES = 255;

/**
 * Split `secret` into `shares` pieces, `threshold` of which rebuild it.
 * `randomBytes` is injectable so the tests can pin the polynomial; production
 * always uses the platform's CSPRNG.
 */
export function split(secret, { shares, threshold, randomBytes } = {}) {
  const bytes = secret instanceof Uint8Array ? secret : new Uint8Array(secret);
  if (!bytes.length) throw new Error("There is no secret to split.");
  if (!Number.isInteger(shares) || !Number.isInteger(threshold))
    throw new Error("The share count and threshold must be whole numbers.");
  if (threshold < 2) throw new Error("A threshold below two would not be a split at all.");
  if (shares < threshold)
    throw new Error("There must be at least as many shares as the threshold.");
  if (shares > MAX_SHARES) throw new Error(`At most ${MAX_SHARES} shares can be produced.`);
  const random = randomBytes || ((length) => crypto.getRandomValues(new Uint8Array(length)));
  const outputs = Array.from({ length: shares }, (_, index) => ({
    x: index + 1,
    y: new Uint8Array(bytes.length),
  }));
  for (let position = 0; position < bytes.length; position++) {
    // A fresh polynomial per byte, with the secret byte as the constant term.
    const coefficients = new Uint8Array(threshold);
    coefficients[0] = bytes[position];
    const noise = random(threshold - 1);
    for (let i = 1; i < threshold; i++) coefficients[i] = noise[i - 1];
    // The top coefficient must not be zero, or the polynomial has a lower
    // degree than the threshold claims.
    if (threshold > 1 && coefficients[threshold - 1] === 0) coefficients[threshold - 1] = 1;
    for (const share of outputs) share.y[position] = evaluate(coefficients, share.x);
  }
  return outputs.map((share) => ({ x: share.x, y: share.y, threshold, shares }));
}

/** Rebuild the secret by Lagrange interpolation at x = 0. */
export function combine(parts) {
  if (!Array.isArray(parts) || parts.length < 2)
    throw new Error("At least two shares are needed to rebuild the secret.");
  const length = parts[0].y.length;
  if (parts.some((part) => part.y.length !== length))
    throw new Error("These shares are not from the same secret.");
  const xs = parts.map((part) => part.x);
  if (xs.some((x) => !Number.isInteger(x) || x < 1 || x > MAX_SHARES))
    throw new Error("A share is numbered outside the valid range.");
  if (new Set(xs).size !== xs.length) throw new Error("The same share was supplied twice.");
  const secret = new Uint8Array(length);
  for (let position = 0; position < length; position++) {
    let accumulator = 0;
    for (let i = 0; i < parts.length; i++) {
      let basis = 1;
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue;
        basis = mul(basis, div(xs[j], xs[i] ^ xs[j]));
      }
      accumulator ^= mul(parts[i].y[position], basis);
    }
    secret[position] = accumulator;
  }
  return secret;
}
