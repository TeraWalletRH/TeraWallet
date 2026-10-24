import { describe, expect, it } from "bun:test";
import { exportContacts, importContacts } from "../src/contact-export";

const MUM = "0x5b2759f9620f54a5e1651a567ebd8381f07f9f05";

describe("exportContacts and importContacts", () => {
  it("round-trips a book under the file's own password", async () => {
    const book = [{ address: MUM, name: "Mum", savedAt: 1 }];
    const json = await exportContacts(book, "file-password-123");
    expect(json).not.toContain("Mum"); // the name is inside the ciphertext, not the file's own JSON
    const imported = await importContacts(json, "file-password-123");
    expect(imported).toEqual(book);
  });

  it("refuses the wrong password with a message fit to show", async () => {
    const json = await exportContacts([{ address: MUM, name: "Mum", savedAt: 1 }], "right-password");
    await expect(importContacts(json, "wrong-password")).rejects.toThrow(
      "Wrong password, or a corrupted file.",
    );
  });

  it("refuses a file that isn't a Tera contacts export", async () => {
    await expect(importContacts("not json at all", "any")).rejects.toThrow(
      "Not a valid export file.",
    );
    await expect(
      importContacts(JSON.stringify({ v: 1, kind: "something-else" }), "any"),
    ).rejects.toThrow("Not a Tera contacts export file.");
  });

  it("requires a password for both export and import", async () => {
    await expect(exportContacts([], "")).rejects.toThrow("Enter a password for the export file.");
    const json = await exportContacts([{ address: MUM, name: "Mum", savedAt: 1 }], "a-password");
    await expect(importContacts(json, "")).rejects.toThrow("Enter the file's password.");
  });
});
