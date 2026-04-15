import type { Hunk, SelectionDraft } from "./types";

const STORAGE_KEY_PREFIX = "moonreview:selection-draft:";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 0);
}

function containsOrderedLines(haystack: string, needle: string): boolean {
  const haystackLines = normalizeLines(haystack);
  const needleLines = normalizeLines(needle);

  if (needleLines.length === 0) {
    return false;
  }

  let needleIndex = 0;
  for (const line of haystackLines) {
    if (line === needleLines[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needleLines.length) {
        return true;
      }
    }
  }

  return false;
}

function scoreHunkMatch(hunk: Hunk, draft: SelectionDraft): number {
  let score = 0;
  const patch = hunk.patch_preview;
  const normalizedPatch = normalizeText(patch);
  const selectedText = draft.selectedText.trim();
  const normalizedSelection = normalizeText(selectedText);

  if (selectedText && patch.includes(selectedText)) {
    score += 100;
  } else if (normalizedSelection && normalizedPatch.includes(normalizedSelection)) {
    score += 80;
  } else if (containsOrderedLines(patch, selectedText)) {
    score += 60;
  }

  if (hunk.header === draft.header) {
    score += 20;
  }

  return score;
}

export function reconcileSelectionDraft(
  draft: SelectionDraft | null,
  hunks: Hunk[],
): SelectionDraft | null {
  if (!draft) {
    return null;
  }

  if (hunks.some((hunk) => hunk.id === draft.hunkId)) {
    return draft;
  }

  const fileHunks = hunks.filter((hunk) => hunk.file_path === draft.filePath);
  if (fileHunks.length === 0) {
    return null;
  }

  let bestMatch: Hunk | null = null;
  let bestScore = 0;

  for (const hunk of fileHunks) {
    const score = scoreHunkMatch(hunk, draft);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = hunk;
    }
  }

  if (!bestMatch || bestScore <= 0) {
    return null;
  }

  return {
    ...draft,
    hunkId: bestMatch.id,
    header: bestMatch.header,
  };
}

function selectionDraftStorageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function isSelectionDraft(value: unknown): value is SelectionDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.hunkId === "string" &&
    typeof candidate.filePath === "string" &&
    typeof candidate.header === "string" &&
    typeof candidate.selectedText === "string" &&
    typeof candidate.note === "string"
  );
}

export function loadSelectionDraft(sessionId: string): SelectionDraft | null {
  const raw = window.localStorage.getItem(selectionDraftStorageKey(sessionId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isSelectionDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistSelectionDraft(sessionId: string, draft: SelectionDraft | null): void {
  const key = selectionDraftStorageKey(sessionId);
  if (!draft) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(draft));
}
