export type AnchoredComment = {
  selection: string;
  comment: string;
};

export const ANCHOR_OPEN = "[[mr-anchor]]";
export const SELECTION_MARK = "[[selection]]";
export const COMMENT_MARK = "[[comment]]";
export const ANCHOR_CLOSE = "[[/mr-anchor]]";

function splitAnchoredBlocks(value: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const openIndex = value.indexOf(ANCHOR_OPEN, cursor);
    if (openIndex < 0) {
      break;
    }

    const contentStart = openIndex + ANCHOR_OPEN.length;
    const closeIndex = value.indexOf(ANCHOR_CLOSE, contentStart);
    if (closeIndex < 0) {
      break;
    }

    blocks.push(value.slice(contentStart, closeIndex));
    cursor = closeIndex + ANCHOR_CLOSE.length;
  }

  return blocks;
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function normalizeBlockLines(block: string): string[] {
  return block.split("\n").map(stripTrailingCarriageReturn);
}

function findMarkerLine(lines: string[], marker: string): number {
  return lines.findIndex((line) => line.trim() === marker);
}

function readSection(lines: string[], start: number, end?: number): string {
  return lines.slice(start, end).join("\n").trim();
}

function parseAnchoredBlock(block: string): AnchoredComment | null {
  const lines = normalizeBlockLines(block);
  const selectionMarkerIndex = findMarkerLine(lines, SELECTION_MARK);
  const commentMarkerIndex = findMarkerLine(lines, COMMENT_MARK);

  if (selectionMarkerIndex < 0 || commentMarkerIndex <= selectionMarkerIndex) {
    return null;
  }

  return {
    selection: readSection(lines, selectionMarkerIndex + 1, commentMarkerIndex),
    comment: readSection(lines, commentMarkerIndex + 1),
  };
}

function formatAnchoredComment(entry: AnchoredComment): string {
  return [
    ANCHOR_OPEN,
    SELECTION_MARK,
    entry.selection.trim(),
    COMMENT_MARK,
    entry.comment.trim(),
    ANCHOR_CLOSE,
  ].join("\n");
}

export function parseAnchoredComments(value: string): AnchoredComment[] {
  const anchored: AnchoredComment[] = [];

  for (const block of splitAnchoredBlocks(value)) {
    const parsed = parseAnchoredBlock(block);
    if (parsed) {
      anchored.push(parsed);
    }
  }

  return anchored;
}

export function buildAnchoredCommentValue(anchored: AnchoredComment[]): string {
  return anchored.map(formatAnchoredComment).join("\n\n");
}
