import { describe, expect, it } from "vitest";
import {
  ANCHOR_CLOSE,
  ANCHOR_OPEN,
  COMMENT_MARK,
  SELECTION_MARK,
  parseAnchoredComments,
} from "./anchoredComments";

describe("parseAnchoredComments", () => {
  it("parses multiple anchored comments and trims each section", () => {
    const value = [
      "Intro text",
      ANCHOR_OPEN,
      SELECTION_MARK,
      "  + const first = true;",
      "  + const second = false;  ",
      COMMENT_MARK,
      "  use clearer names  ",
      ANCHOR_CLOSE,
      "Between blocks",
      ANCHOR_OPEN,
      SELECTION_MARK,
      "- oldValue",
      COMMENT_MARK,
      "replace with the new field",
      ANCHOR_CLOSE,
    ].join("\n");

    expect(parseAnchoredComments(value)).toEqual([
      {
        selection: "+ const first = true;\n  + const second = false;",
        comment: "use clearer names",
      },
      {
        selection: "- oldValue",
        comment: "replace with the new field",
      },
    ]);
  });

  it("ignores malformed anchored blocks", () => {
    const value = [
      ANCHOR_OPEN,
      COMMENT_MARK,
      "missing selection marker",
      ANCHOR_CLOSE,
      ANCHOR_OPEN,
      SELECTION_MARK,
      "+ valid line",
      COMMENT_MARK,
      "valid comment",
      ANCHOR_CLOSE,
    ].join("\n");

    expect(parseAnchoredComments(value)).toEqual([
      {
        selection: "+ valid line",
        comment: "valid comment",
      },
    ]);
  });

  it("handles CRLF line endings", () => {
    const value = [
      ANCHOR_OPEN,
      SELECTION_MARK,
      "+ windows line",
      COMMENT_MARK,
      "works on CRLF too",
      ANCHOR_CLOSE,
    ].join("\r\n");

    expect(parseAnchoredComments(value)).toEqual([
      {
        selection: "+ windows line",
        comment: "works on CRLF too",
      },
    ]);
  });
});
