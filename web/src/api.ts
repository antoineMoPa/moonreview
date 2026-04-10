import type { PatchPayload, SessionState } from "./types";

const sessionId = window.location.pathname.split("/").pop() ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }
  return response.text() as Promise<T>;
}

export function getSessionId(): string {
  return sessionId;
}

export function fetchSessionState(): Promise<SessionState> {
  return request<SessionState>(`/api/session/${sessionId}/state`);
}

export function fetchHunkPatch(hunkId: string): Promise<PatchPayload> {
  return request<PatchPayload>(`/api/session/${sessionId}/hunk/${hunkId}`);
}

export function toggleReviewed(hunkId: string): Promise<string> {
  return request<string>(`/api/session/${sessionId}/reviewed`, {
    method: "POST",
    body: JSON.stringify({ hunk_id: hunkId }),
  });
}

export function toggleStage(hunkId: string, staged: boolean): Promise<string> {
  return request<string>(`/api/session/${sessionId}/${staged ? "unstage" : "stage"}`, {
    method: "POST",
    body: JSON.stringify({ hunk_id: hunkId }),
  });
}

export function toggleStageFile(filePath: string, staged: boolean): Promise<string> {
  return request<string>(`/api/session/${sessionId}/${staged ? "unstage-file" : "stage-file"}`, {
    method: "POST",
    body: JSON.stringify({ file_path: filePath }),
  });
}

export function stageSelection(hunkId: string, selection: string): Promise<string> {
  return request<string>(`/api/session/${sessionId}/stage-selection`, {
    method: "POST",
    body: JSON.stringify({ hunk_id: hunkId, selection }),
  });
}

export function discardHunk(hunkId: string): Promise<string> {
  return request<string>(`/api/session/${sessionId}/discard`, {
    method: "POST",
    body: JSON.stringify({ hunk_id: hunkId }),
  });
}

export function saveComment(hunkId: string, comment: string): Promise<string> {
  return request<string>(`/api/session/${sessionId}/comment`, {
    method: "POST",
    body: JSON.stringify({ hunk_id: hunkId, comment }),
  });
}
