export type LineDiffStats = {
  added: number;
  removed: number;
};

export type LineDiffStatSource = {
  added_line_count: number;
  removed_line_count: number;
};

export const EMPTY_LINE_DIFF_STATS: LineDiffStats = {
  added: 0,
  removed: 0,
};

export function lineDiffReducer(sum: LineDiffStats, item: LineDiffStatSource): LineDiffStats {
  return {
    added: sum.added + item.added_line_count,
    removed: sum.removed + item.removed_line_count,
  };
}
