import type { DraftComment, Hunk } from "./types";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);
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

function parseHunkHeader(header: string): { newStart: number; newCount: number } | null {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) {
    return null;
  }

  return {
    newStart: Number.parseInt(match[1], 10),
    newCount: Number.parseInt(match[2] ?? "1", 10),
  };
}

function hunkContainsLineHint(hunk: Hunk, lineNumberHint: number | undefined): boolean {
  if (!lineNumberHint) {
    return false;
  }

  const parsed = parseHunkHeader(hunk.header);
  if (!parsed) {
    return false;
  }

  const newEnd = parsed.newStart + Math.max(parsed.newCount - 1, 0);
  return lineNumberHint >= parsed.newStart && lineNumberHint <= newEnd;
}

function lineHintDistanceScore(hunk: Hunk, lineNumberHint: number | undefined): number {
  if (!lineNumberHint) {
    return 0;
  }

  const parsed = parseHunkHeader(hunk.header);
  if (!parsed) {
    return 0;
  }

  const newEnd = parsed.newStart + Math.max(parsed.newCount - 1, 0);
  if (lineNumberHint >= parsed.newStart && lineNumberHint <= newEnd) {
    return 35;
  }

  const distance = Math.min(
    Math.abs(lineNumberHint - parsed.newStart),
    Math.abs(lineNumberHint - newEnd),
  );
  return Math.max(20 - distance, 0);
}

function scoreDraftAgainstHunk(hunk: Hunk, draft: DraftComment): number {
  let score = 0;
  const patch = hunk.patch_preview;
  const selectedText = draft.selectedText.trim();
  const normalizedPatch = normalizeText(patch);
  const normalizedSelection = normalizeText(selectedText);

  if (selectedText && patch.includes(selectedText)) {
    score += 100;
  } else if (normalizedSelection && normalizedPatch.includes(normalizedSelection)) {
    score += 80;
  } else if (containsOrderedLines(patch, selectedText)) {
    score += 60;
  }

  if (hunk.header === draft.header) {
    score += 25;
  }

  score += lineHintDistanceScore(hunk, draft.lineNumberHint);

  if (hunkContainsLineHint(hunk, draft.lineNumberHint)) {
    score += 10;
  }

  return score;
}

function reconcileDraftComment(draft: DraftComment, hunks: Hunk[]): DraftComment | null {
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
    const score = scoreDraftAgainstHunk(hunk, draft);
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

export function reconcileDraftComments(drafts: DraftComment[], hunks: Hunk[]): DraftComment[] {
  return drafts
    .map((draft) => reconcileDraftComment(draft, hunks))
    .filter((draft): draft is DraftComment => draft !== null);
}
