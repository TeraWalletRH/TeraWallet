import { describe, expect, test } from "bun:test";
import { APP_SHORTCUTS, resolveAppShortcut } from "../src/shortcuts";

describe("APP_SHORTCUTS and resolveAppShortcut", () => {
  test("defines standard app shortcuts for quick navigation", () => {
    expect(APP_SHORTCUTS.length).toBeGreaterThanOrEqual(4);
    const ids = APP_SHORTCUTS.map((s) => s.id);
    expect(ids).toContain("send");
    expect(ids).toContain("swap");
    expect(ids).toContain("scan");
    expect(ids).toContain("activity");
  });

  test("resolves shortcut id to target page name", () => {
    expect(resolveAppShortcut("send")).toBe("send");
    expect(resolveAppShortcut("swap")).toBe("swap");
    expect(resolveAppShortcut("scan")).toBe("scan");
    expect(resolveAppShortcut("invalid")).toBeNull();
  });
});
