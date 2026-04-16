import type { DraftComment } from "./types";

const STORAGE_KEY_PREFIX = "moonreview:comments:";
const LEGACY_STORAGE_KEY_PREFIX = "moonreview:draft-comments:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PersistedComments = {
  savedAt: number;
  comments: DraftComment[];
};

type LegacyPersistedComments = {
  savedAt: number;
  drafts: DraftComment[];
};

function commentsStorageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function legacyCommentsStorageKey(sessionId: string): string {
  return `${LEGACY_STORAGE_KEY_PREFIX}${sessionId}`;
}

function isPersistedComments(value: unknown): value is PersistedComments {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.savedAt === "number" && Array.isArray(candidate.comments);
}

function isLegacyPersistedComments(value: unknown): value is LegacyPersistedComments {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.savedAt === "number" && Array.isArray(candidate.drafts);
}

function isDraftComment(value: unknown): value is DraftComment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.hunkId === "string" &&
    typeof candidate.filePath === "string" &&
    typeof candidate.header === "string" &&
    typeof candidate.selectedText === "string" &&
    typeof candidate.note === "string" &&
    (candidate.lineNumberHint === undefined || typeof candidate.lineNumberHint === "number")
  );
}

function isExpired(savedAt: number): boolean {
  return Date.now() - savedAt > TTL_MS;
}

function listCommentStorageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_KEY_PREFIX) || key?.startsWith(LEGACY_STORAGE_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function removeExpiredCommentEntries(): void {
  for (const key of listCommentStorageKeys()) {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      if (
        (isPersistedComments(parsed) || isLegacyPersistedComments(parsed)) &&
        isExpired(parsed.savedAt)
      ) {
        window.localStorage.removeItem(key);
      }
    } catch {
      window.localStorage.removeItem(key);
    }
  }
}

export function loadDraftComments(sessionId: string): DraftComment[] {
  removeExpiredCommentEntries();

  const key = commentsStorageKey(sessionId);
  const legacyKey = legacyCommentsStorageKey(sessionId);
  const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isDraftComment);
    }

    if (isPersistedComments(parsed)) {
      if (isExpired(parsed.savedAt)) {
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(legacyKey);
        return [];
      }

      return parsed.comments.filter(isDraftComment);
    }

    if (isLegacyPersistedComments(parsed)) {
      if (isExpired(parsed.savedAt)) {
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(legacyKey);
        return [];
      }

      return parsed.drafts.filter(isDraftComment);
    }

    return [];
  } catch {
    return [];
  }
}

export function persistDraftComments(sessionId: string, drafts: DraftComment[]): void {
  removeExpiredCommentEntries();

  const key = commentsStorageKey(sessionId);
  const legacyKey = legacyCommentsStorageKey(sessionId);
  if (drafts.length === 0) {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(legacyKey);
    return;
  }

  window.localStorage.removeItem(legacyKey);
  window.localStorage.setItem(
    key,
    JSON.stringify({
      savedAt: Date.now(),
      comments: drafts,
    } satisfies PersistedComments),
  );
}
