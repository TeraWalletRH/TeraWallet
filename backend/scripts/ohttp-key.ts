#!/usr/bin/env bun
// Generate a gateway key for the Oblivious HTTP endpoint.
//
//   bun run ohttp:key
//
// The key is printed once and never stored by this script. It is the key clients
// seal their requests to, so rotating it makes every previously published key
// configuration unusable: clients that cached the old configuration will fail
// until they refetch it. Rotate deliberately, not on a whim.
//
// The public half is derived from this and published at
// /.well-known/ohttp-gateway. Only the private half goes in the environment.

import { createPublicKey } from "node:crypto";
import { generateKeyPair, rawPrivateKey, rawPublicKey } from "../src/ohttp/hpke";

const { privateKey } = generateKeyPair();
const keyId = Number(process.env.OHTTP_KEY_ID ?? 1);

if (!Number.isInteger(keyId) || keyId < 0 || keyId > 255) {
  console.error("OHTTP_KEY_ID must be a whole number from 0 to 255.");
  process.exit(1);
}

console.log(`OHTTP_PRIVATE_KEY=${rawPrivateKey(privateKey).toString("hex")}`);
console.log(`OHTTP_KEY_ID=${keyId}`);
console.log("");
console.log(
  `# public key (published, not secret): ${rawPublicKey(createPublicKey(privateKey)).toString("hex")}`,
);
console.log("# Put the first two lines in backend/.env. Do not commit them.");
