import { describe, expect, it } from "vitest";
import {
  loadSelectionDraft,
  persistSelectionDraft,
  reconcileSelectionDraft,
} from "./selectionDraft";
import type { Hunk, SelectionDraft } from "./types";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
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

function makeHunk(overrides: Partial<Hunk>): Hunk {
  return {
    id: "hunk-1",
    file_path: "src/example.ts",
    header: "@@ -1,5 +1,5 @@",
    staged: false,
    reviewed: false,
    comment: "",
    comment_dispatches: [],
    patch_preview: "@@ -1,5 +1,5 @@\n export class Example {\n   value() {}\n }\n",
    patch_line_count: 4,
    added_line_count: 0,
    removed_line_count: 0,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<SelectionDraft> = {}): SelectionDraft {
  return {
    hunkId: "old-hunk",
    filePath: "src/example.ts",
    header: "@@ -10,8 +10,12 @@",
    selectedText: "export class Example {\n  value() {}\n}",
    note: "keep this comment",
    ...overrides,
  };
}

describe("reconcileSelectionDraft", () => {
  it("keeps a draft when the original hunk still exists", () => {
    storage.clear();
    const draft = makeDraft({ hunkId: "hunk-1" });
    const hunk = makeHunk({ id: "hunk-1" });

    expect(reconcileSelectionDraft(draft, [hunk])).toEqual(draft);
  });

  it("reattaches a stale draft to a matching hunk in the same file", () => {
    storage.clear();
    const draft = makeDraft();
    const matchingHunk = makeHunk({
      id: "new-hunk",
      header: "@@ -20,8 +24,12 @@",
      patch_preview:
        "@@ -20,8 +24,12 @@\n export class Example {\n   helper() {}\n   value() {}\n }\n",
    });
    const otherHunk = makeHunk({
      id: "other-hunk",
      patch_preview: "@@ -1,4 +1,6 @@\n function topLevel() {}\n",
    });

    expect(reconcileSelectionDraft(draft, [otherHunk, matchingHunk])).toEqual({
      ...draft,
      hunkId: "new-hunk",
      header: matchingHunk.header,
    });
  });

  it("drops a draft when the file no longer has a plausible match", () => {
    storage.clear();
    const draft = makeDraft();
    const otherHunk = makeHunk({
      id: "other-hunk",
      file_path: "src/other.ts",
      patch_preview: "@@ -1,4 +1,6 @@\n function topLevel() {}\n",
    });

    expect(reconcileSelectionDraft(draft, [otherHunk])).toBeNull();
  });
});

describe("selection draft persistence", () => {
  it("round-trips a draft through localStorage", () => {
    storage.clear();
    const sessionId = "session-1";
    const draft = makeDraft();

    persistSelectionDraft(sessionId, draft);

    expect(loadSelectionDraft(sessionId)).toEqual(draft);
  });

  it("clears persisted drafts", () => {
    storage.clear();
    const sessionId = "session-2";
    persistSelectionDraft(sessionId, makeDraft());

    persistSelectionDraft(sessionId, null);

    expect(loadSelectionDraft(sessionId)).toBeNull();
  });
});
