import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { getSessionId } from "./api";
import {
  discardHunk as discardHunkRequest,
  fetchSessionState,
  saveComment as saveCommentRequest,
  stageSelection as stageSelectionRequest,
  toggleStage as toggleStageRequest,
  toggleStageFile as toggleStageFileRequest,
} from "./api";
import { parseAnchoredComments } from "./anchoredComments";
import type { Hunk, SessionState } from "./types";

type ReviewStoreState = {
  data: SessionState | null;
  loadError: string;
  busy: boolean;
};

type ReviewStoreValue = {
  state: ReviewStoreState;
  actions: {
    loadState: () => Promise<void>;
    toggleStage: (hunkId: string, staged: boolean) => Promise<void>;
    toggleStageFile: (filePath: string, staged: boolean) => Promise<void>;
    stageSelection: (hunkId: string, selection: string) => Promise<void>;
    discardHunk: (hunkId: string) => Promise<void>;
    updateDraftComment: (hunkId: string, comment: string) => void;
    saveComment: (hunkId: string, comment: string) => Promise<void>;
  };
};

type ReviewStoreAction =
  | { type: "request_started" }
  | { type: "request_finished" }
  | { type: "state_loaded"; data: SessionState }
  | { type: "load_failed"; message: string }
  | { type: "draft_comment_updated"; hunkId: string; comment: string };

const ReviewStoreContext = createContext<ReviewStoreValue | null>(null);
const EXPORT_SERVER_URL = "http://localhost:42000";

function buildExportText(hunks: Hunk[]): string {
  const lines = ["Moon Review notes", "=================", "Please fix these code issues and mark as resolved:", ""];
  const sessionId = getSessionId();

  for (const hunk of hunks.filter((item) => item.comment.trim())) {
    const anchored = parseAnchoredComments(hunk.comment);
    const unresolved = anchored.filter((entry) => !entry.resolved);
    if (unresolved.length === 0) {
      continue;
    }

    lines.push(`${hunk.file_path} ${hunk.header}`);
    for (const entry of unresolved) {
      const commentIndex = anchored.indexOf(entry);
      lines.push(`Selected code: ${entry.selection}`);
      lines.push(`Issue: ${entry.comment}`);
      lines.push(
        `Poke this url when done: ${EXPORT_SERVER_URL}/api/session/${sessionId}/resolve/${hunk.id}/${commentIndex}`,
      );
      lines.push("");
    }
  }

  if (lines.join("\n").trim() === "Moon Review notes\n=================\nPlease fix these code issues and mark as resolved:") {
    lines.push("No review notes yet.");
  }

  return lines.join("\n");
}

function updateHunkComment(data: SessionState, hunkId: string, comment: string): SessionState {
  const hunks = data.hunks.map((hunk) => (hunk.id === hunkId ? { ...hunk, comment } : hunk));
  return {
    ...data,
    hunks,
    export_text: buildExportText(hunks),
  };
}

function reviewStoreReducer(state: ReviewStoreState, action: ReviewStoreAction): ReviewStoreState {
  switch (action.type) {
    case "request_started":
      return { ...state, busy: true };
    case "request_finished":
      return { ...state, busy: false };
    case "state_loaded":
      return {
        ...state,
        data: action.data,
        loadError: "",
      };
    case "load_failed":
      return {
        ...state,
        loadError: action.message,
      };
    case "draft_comment_updated":
      if (!state.data) {
        return state;
      }
      return {
        ...state,
        data: updateHunkComment(state.data, action.hunkId, action.comment),
      };
    default:
      return state;
  }
}

function initialReviewStoreState(): ReviewStoreState {
  return {
    data: null,
    loadError: "",
    busy: false,
  };
}

export function ReviewStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reviewStoreReducer, undefined, initialReviewStoreState);

  async function loadState() {
    try {
      const data = await fetchSessionState();
      dispatch({ type: "state_loaded", data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load state.";
      dispatch({ type: "load_failed", message });
      toast.error(message);
    }
  }

  async function mutate(request: () => Promise<unknown>) {
    if (state.busy) {
      return;
    }

    dispatch({ type: "request_started" });
    try {
      await request();
      await loadState();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed.");
    } finally {
      dispatch({ type: "request_finished" });
    }
  }

  function updateDraftComment(hunkId: string, comment: string) {
    dispatch({ type: "draft_comment_updated", hunkId, comment });
  }

  useEffect(() => {
    void loadState();
  }, []);

  const value = useMemo<ReviewStoreValue>(
    () => ({
      state,
      actions: {
        loadState,
        toggleStage: async (hunkId, staged) => mutate(() => toggleStageRequest(hunkId, staged)),
        toggleStageFile: async (filePath, staged) => mutate(() => toggleStageFileRequest(filePath, staged)),
        stageSelection: async (hunkId, selection) => mutate(() => stageSelectionRequest(hunkId, selection)),
        discardHunk: async (hunkId) => mutate(() => discardHunkRequest(hunkId)),
        updateDraftComment,
        saveComment: async (hunkId, comment) => mutate(() => saveCommentRequest(hunkId, comment)),
      },
    }),
    [state],
  );

  return <ReviewStoreContext.Provider value={value}>{children}</ReviewStoreContext.Provider>;
}

export function useReviewStore() {
  const value = useContext(ReviewStoreContext);
  if (!value) {
    throw new Error("useReviewStore must be used within ReviewStoreProvider");
  }
  return value;
}
