import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_OPEN, isNotificationOpen, salesChanged, shouldRefreshScreen, watermarkAfterRead } from "./resumeSales";

describe("notification open", () => {
  it("recognizes the message the service worker sends", () => {
    expect(isNotificationOpen({ type: NOTIFICATION_OPEN })).toBe(true);
    expect(isNotificationOpen({ type: "other" })).toBe(false);
    expect(isNotificationOpen(null)).toBe(false);
  });

  it("uses the same message the service worker posts", () => {
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    expect(sw).toContain(NOTIFICATION_OPEN);
  });
});

describe("watermark after a resume read", () => {
  const older = new Date("2026-10-10T12:00:00.000Z").getTime();
  const newer = new Date("2026-10-10T12:30:00.000Z");

  it("keeps the previous mark when the read comes back empty", () => {
    expect(watermarkAfterRead(older, null)).toBe(older);
  });

  it("stores a newer mark and treats it as a change", () => {
    const stored = watermarkAfterRead(older, newer);
    expect(stored).toBe(newer.getTime());
    expect(salesChanged(older, stored)).toBe(true);
  });

  it("does not report a change when there was no previous mark", () => {
    const stored = watermarkAfterRead(null, newer);
    expect(salesChanged(null, stored)).toBe(false);
  });
});

describe("screen refresh", () => {
  const older = new Date("2026-10-10T12:00:00.000Z").getTime();
  const newer = new Date("2026-10-10T12:30:00.000Z").getTime();

  it("leaves the screen when the round did not change a sale", () => {
    expect(shouldRefreshScreen(older, newer, false)).toBe(false);
  });

  it("refreshes when a newer round changed a sale", () => {
    expect(shouldRefreshScreen(older, newer, true)).toBe(true);
  });

  it("refreshes when the round could not be read", () => {
    expect(shouldRefreshScreen(older, newer, null)).toBe(true);
  });

  it("does nothing when the mark did not move", () => {
    expect(shouldRefreshScreen(older, older, true)).toBe(false);
  });
});
