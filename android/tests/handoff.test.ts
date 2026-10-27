import { expect, it } from "bun:test";
import { inviteHash, isSealed, makeInvite, openSealed, parseInvite, sealFor } from "../src/handoff";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const PHRASE = "test test test test test test test test test test test junk";

it("an invite survives the URL fragment", async () => {
  const { invite } = await makeInvite(EXT);
  const parsed = parseInvite(inviteHash(invite))!;
  expect(parsed.extension).toBe(EXT);
  expect([...parsed.publicKey]).toEqual([...invite.publicKey]);
  expect([...parsed.session]).toEqual([...invite.session]);
});

it("malformed invites are refused", async () => {
  const { invite } = await makeInvite(EXT);
  const good = inviteHash(invite);
  expect(parseInvite(null)).toBeNull();
  expect(parseInvite("#claim=abc")).toBeNull();
  expect(parseInvite(good.replace(EXT, "not-an-extension-id-at-all-00000"))).toBeNull();
  expect(parseInvite(good.replace(/\.[^.]+$/, ".AAAA"))).toBeNull();
  expect(parseInvite(`${good}&x=1`)).toBeNull();
});

it("only the invite's holder opens the phrase", async () => {
  const { invite, privateKey } = await makeInvite(EXT);
  const sealed = await sealFor(parseInvite(inviteHash(invite))!, PHRASE);
  expect(isSealed(sealed)).toBe(true);
  expect(JSON.stringify(sealed)).not.toContain("junk");
  expect(await openSealed(sealed, invite, privateKey)).toBe(PHRASE);

  const other = await makeInvite(EXT);
  await expect(openSealed(sealed, invite, other.privateKey)).rejects.toThrow();
  await expect(openSealed(sealed, other.invite, other.privateKey)).rejects.toThrow("another setup");
});

it("a changed byte is refused", async () => {
  const { invite, privateKey } = await makeInvite(EXT);
  const sealed = await sealFor(invite, PHRASE);
  const flipped = sealed.data[5] === "A" ? "B" : "A";
  const tampered = { ...sealed, data: sealed.data.slice(0, 5) + flipped + sealed.data.slice(6) };
  await expect(openSealed(tampered, invite, privateKey)).rejects.toThrow("couldn't be opened");
  expect(isSealed({ ...sealed, v: 2 })).toBe(false);
  expect(isSealed({ ...sealed, data: "x".repeat(5000) })).toBe(false);
});
