/** Muted members (lib/room-client/mute.ts): per room, in a storage that may fail. */
import { describe, expect, it } from "vitest";

import {
  MUTE_MAX,
  MUTE_TTL_MS,
  loadMuted,
  mutedStorageKey,
  saveMuted,
  withMuted,
  type KeyValueStorage,
} from "../../lib/room-client/mute";

/** A plain-object storage, like localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return { storage, data };
}

/** A storage whose every access throws (blocked site data, some private windows). */
const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const NOW = Date.parse("2026-11-02T12:00:00Z");

describe("muted members storage", () => {
  it("round-trips per room, under a key with the room code", () => {
    const { storage, data } = memoryStorage();
    saveMuted(storage, "BCDFG", ["abcd2345", "zz99"], NOW);
    expect(mutedStorageKey("BCDFG")).toBe("sh:muted:BCDFG");
    expect(JSON.parse(data.get("sh:muted:BCDFG") ?? "null")).toEqual({
      pids: ["abcd2345", "zz99"],
      at: NOW,
    });
    expect([...loadMuted(storage, "BCDFG", NOW + 60_000)]).toEqual(["abcd2345", "zz99"]);
    // Another room knows nothing of it.
    expect(loadMuted(storage, "HJKLM", NOW).size).toBe(0);
  });

  it("removes the key when nobody is muted any more", () => {
    const { storage, data } = memoryStorage();
    saveMuted(storage, "BCDFG", ["abcd2345"], NOW);
    saveMuted(storage, "BCDFG", [], NOW);
    expect(data.has("sh:muted:BCDFG")).toBe(false);
  });

  it("forgets a list older than a week, and ignores what it cannot read", () => {
    const { storage, data } = memoryStorage({
      "sh:muted:BCDFG": JSON.stringify({ pids: ["abcd2345"], at: NOW - MUTE_TTL_MS - 1 }),
      "sh:muted:HJKLM": "{not json",
      "sh:muted:NPQRS": JSON.stringify(["abcd2345"]),
      "sh:muted:TVWXZ": JSON.stringify({ pids: ["ok", 42, "<script>", ""], at: NOW }),
    });
    expect(loadMuted(storage, "BCDFG", NOW).size).toBe(0);
    expect(data.has("sh:muted:BCDFG")).toBe(false);
    expect(loadMuted(storage, "HJKLM", NOW).size).toBe(0);
    expect(loadMuted(storage, "NPQRS", NOW).size).toBe(0);
    expect([...loadMuted(storage, "TVWXZ", NOW)]).toEqual(["ok"]);
  });

  it("keeps at most MUTE_MAX members", () => {
    const { storage } = memoryStorage();
    const many = Array.from({ length: MUTE_MAX + 20 }, (_, i) => `p${i}`);
    saveMuted(storage, "BCDFG", many, NOW);
    expect(loadMuted(storage, "BCDFG", NOW).size).toBe(MUTE_MAX);
  });

  it("never throws when storage is missing or failing", () => {
    expect(loadMuted(null, "BCDFG", NOW).size).toBe(0);
    expect(loadMuted(throwing, "BCDFG", NOW).size).toBe(0);
    expect(() => saveMuted(null, "BCDFG", ["a"], NOW)).not.toThrow();
    expect(() => saveMuted(throwing, "BCDFG", ["a"], NOW)).not.toThrow();
    expect(() => saveMuted(throwing, "BCDFG", [], NOW)).not.toThrow();
  });

  it("withMuted adds and removes without touching the original set", () => {
    const none: ReadonlySet<string> = new Set();
    const one = withMuted(none, "a", true);
    expect([...one]).toEqual(["a"]);
    expect(none.size).toBe(0);
    expect(withMuted(one, "a", true)).toBe(one);
    expect(withMuted(one, "a", false).size).toBe(0);
  });
});
