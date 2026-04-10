import type { AnchoredComment } from "../../anchoredComments";

type CodeSegment = {
  type: "code";
  text: string;
};

type CommentSegment = {
  type: "comment";
  index: number;
  selection: string;
  comment: string;
  resolved: boolean;
};

export type DiffSegment = CodeSegment | CommentSegment;

type CommentInsertion = {
  lineIndex: number;
  entry: AnchoredComment;
  index: number;
};

function findSelectionNeedle(selection: string): string | null {
  return selection
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function findInsertionLineIndex(lines: string[], needle: string, usedIndexes: Set<number>): number {
  return lines.findIndex((line, index) => !usedIndexes.has(index) && line.includes(needle));
}

function collectCommentInsertions(lines: string[], anchored: AnchoredComment[]): CommentInsertion[] {
  const usedIndexes = new Set<number>();
  const insertions: CommentInsertion[] = [];

  anchored.forEach((entry, index) => {
    const needle = findSelectionNeedle(entry.selection);
    if (!needle) {
      return;
    }

    const lineIndex = findInsertionLineIndex(lines, needle, usedIndexes);
    if (lineIndex < 0) {
      return;
    }

    usedIndexes.add(lineIndex);
    insertions.push({ lineIndex, entry, index });
  });

  return insertions.sort((left, right) => left.lineIndex - right.lineIndex);
}

function pushCodeSegment(segments: DiffSegment[], text: string) {
  if (!text.trim()) {
    return;
  }

  segments.push({ type: "code", text });
}

function buildCommentSegment(insertion: CommentInsertion): CommentSegment {
  return {
    type: "comment",
    index: insertion.index,
    selection: insertion.entry.selection,
    comment: insertion.entry.comment,
    resolved: insertion.entry.resolved,
  };
}

export function splitDiffIntoSegments(patch: string, anchored: AnchoredComment[]): DiffSegment[] {
  if (anchored.length === 0) {
    return [{ type: "code", text: patch }];
  }

  const lines = patch.split("\n");
  const insertions = collectCommentInsertions(lines, anchored);
  if (insertions.length === 0) {
    return [{ type: "code", text: patch }];
  }

  const segments: DiffSegment[] = [];
  let cursor = 0;

  for (const insertion of insertions) {
    pushCodeSegment(segments, lines.slice(cursor, insertion.lineIndex + 1).join("\n"));
    segments.push(buildCommentSegment(insertion));
    cursor = insertion.lineIndex + 1;
  }

  pushCodeSegment(segments, lines.slice(cursor).join("\n"));
  return segments;
}
