import { afterEach, describe, expect, it } from "vitest";
import { loadDraftComments, persistDraftComments } from "./comments";
import type { DraftComment } from "./types";

const storage = new Map<string, string>();
const originalDateNow = Date.now;

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  },
  configurable: true,
});

function makeDraft(overrides: Partial<DraftComment> = {}): DraftComment {
  return {
    id: "draft-1",
    hunkId: "hunk-1",
    filePath: "src/example.ts",
    header: "@@ -1,2 +1,2 @@",
    selectedText: "const x = 1;",
    note: "draft note",
    ...overrides,
  };
}

describe("draft comment persistence", () => {
  afterEach(() => {
    Date.now = originalDateNow;
  });

  it("round-trips multiple drafts", () => {
    storage.clear();
    const drafts = [makeDraft(), makeDraft({ id: "draft-2", selectedText: "const y = 2;" })];

    persistDraftComments("session-1", drafts);

    expect(loadDraftComments("session-1")).toEqual(drafts);
  });

  it("clears persisted drafts when empty", () => {
    storage.clear();
    persistDraftComments("session-2", [makeDraft()]);

    persistDraftComments("session-2", []);

    expect(loadDraftComments("session-2")).toEqual([]);
  });

  it("expires drafts after one week", () => {
    storage.clear();
    Date.now = () => 1_000;

    persistDraftComments("session-3", [makeDraft()]);

    Date.now = () => 1_000 + 7 * 24 * 60 * 60 * 1000 + 1;

    expect(loadDraftComments("session-3")).toEqual([]);
  });

  it("cleans up expired draft entries from other sessions", () => {
    storage.clear();
    storage.set(
      "moonreview:comments:expired-session",
      JSON.stringify({
        savedAt: 1_000,
        comments: [makeDraft()],
      }),
    );
    storage.set(
      "moonreview:comments:active-session",
      JSON.stringify({
        savedAt: 1_000 + 7 * 24 * 60 * 60 * 1000,
        comments: [makeDraft({ id: "draft-2" })],
      }),
    );
    Date.now = () => 1_000 + 7 * 24 * 60 * 60 * 1000 + 1;

    loadDraftComments("active-session");

    expect(storage.has("moonreview:comments:expired-session")).toBe(false);
    expect(storage.has("moonreview:comments:active-session")).toBe(true);
  });

  it("loads legacy draft comment storage entries", () => {
    storage.clear();
    storage.set(
      "moonreview:draft-comments:legacy-session",
      JSON.stringify({
        savedAt: 1_000,
        drafts: [makeDraft()],
      }),
    );
    Date.now = () => 1_000;

    expect(loadDraftComments("legacy-session")).toEqual([makeDraft()]);
  });

  it("replaces legacy storage when persisting", () => {
    storage.clear();
    storage.set(
      "moonreview:draft-comments:legacy-session",
      JSON.stringify({
        savedAt: 1_000,
        drafts: [makeDraft()],
      }),
    );
    Date.now = () => 2_000;

    persistDraftComments("legacy-session", [makeDraft({ id: "draft-2" })]);

    expect(storage.has("moonreview:draft-comments:legacy-session")).toBe(false);
    expect(storage.get("moonreview:comments:legacy-session")).toBe(
      JSON.stringify({
        savedAt: 2_000,
        comments: [makeDraft({ id: "draft-2" })],
      }),
    );
  });
});
