import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "highlight.js/styles/github.css";
import { toast, Toaster } from "sonner";
import "./app.css";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { LeftSidebar } from "./components/LeftSidebar";
import { Hunks } from "./components/hunks/Hunks";
import { ReviewStoreProvider, useReviewStore } from "./reviewStore";
import type { AgentKind } from "./types";

const AGENT_STORAGE_KEY = "moonreview:selected-agent";

function fileNameFromPath(filePath: string) {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}

function AppContent() {
  const {
    state: { data, loadError },
    actions,
  } = useReviewStore();
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [pendingStageFile, setPendingStageFile] = useState<{ filePath: string; fileName: string } | null>(null);
  const previousDataRef = useRef<typeof data>(null);
  const [activeJumpTarget, setActiveJumpTarget] = useState<{
    filePath?: string | null;
    hunkId?: string | null;
    elementId: string;
  } | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }

    const storedAgent = window.localStorage.getItem(AGENT_STORAGE_KEY) as AgentKind | null;
    if (!storedAgent || storedAgent === data.selected_agent) {
      return;
    }

    const storedAgentOption = data.available_agents.find((agent) => agent.kind === storedAgent);
    if (!storedAgentOption || !storedAgentOption.available) {
      window.localStorage.removeItem(AGENT_STORAGE_KEY);
      return;
    }

    void actions.setAgent(storedAgent);
  }, [actions, data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (selectedFilePath && data.hunks.some((hunk) => hunk.file_path === selectedFilePath)) {
      return;
    }

    const fallbackFilePath =
      data.hunks.find((hunk) => !hunk.staged)?.file_path ?? data.hunks[0]?.file_path ?? null;
    setSelectedFilePath(fallbackFilePath);
  }, [data, selectedFilePath]);

  useEffect(() => {
    if (!activeJumpTarget) {
      return;
    }

    const timer = window.setTimeout(() => {
      const element = document.getElementById(activeJumpTarget.elementId);
      if (!element) {
        setActiveJumpTarget(null);
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveJumpTarget(null);
    }, 40);

    return () => window.clearTimeout(timer);
  }, [activeJumpTarget]);

  useEffect(() => {
    if (!data || !pendingStageFile) {
      return;
    }
    if (pendingStageFile.filePath === selectedFilePath) {
      return;
    }

    const fileStillExists = data.hunks.some((hunk) => hunk.file_path === pendingStageFile.filePath);
    const hasUnstagedHunks = data.hunks.some(
      (hunk) => hunk.file_path === pendingStageFile.filePath && !hunk.staged,
    );

    if (!fileStillExists || hasUnstagedHunks) {
      return;
    }

    toast.success(`file ${pendingStageFile.fileName} fully staged`);
    const nextUnstagedFile = data.hunks.find((hunk) => !hunk.staged)?.file_path ?? null;
    if (nextUnstagedFile) {
      setSelectedFilePath(nextUnstagedFile);
    }
    setPendingStageFile(null);
  }, [data, pendingStageFile]);

  useEffect(() => {
    if (!data || !selectedFilePath) {
      previousDataRef.current = data;
      return;
    }

    const previousData = previousDataRef.current;
    const hadUnstagedHunks = previousData?.hunks.some(
      (hunk) => hunk.file_path === selectedFilePath && !hunk.staged,
    ) ?? false;
    const hasUnstagedHunks = data.hunks.some(
      (hunk) => hunk.file_path === selectedFilePath && !hunk.staged,
    );

    if (hadUnstagedHunks && !hasUnstagedHunks) {
      toast.success(`file ${fileNameFromPath(selectedFilePath)} fully staged`);
      const nextUnstagedFile = data.hunks.find((hunk) => !hunk.staged)?.file_path ?? null;
      if (nextUnstagedFile && nextUnstagedFile !== selectedFilePath) {
        setSelectedFilePath(nextUnstagedFile);
      }
      if (pendingStageFile?.filePath === selectedFilePath) {
        setPendingStageFile(null);
      }
    }

    previousDataRef.current = data;
  }, [data, pendingStageFile, selectedFilePath]);

  function handleAgentChange(agent: AgentKind) {
    window.localStorage.setItem(AGENT_STORAGE_KEY, agent);
    void actions.setAgent(agent);
  }

  function jumpToFile(filePath: string) {
    setSelectedFilePath(filePath);
    setActiveJumpTarget({
      filePath,
      hunkId: null,
      elementId: `file-${encodeURIComponent(filePath)}`,
    });
  }

  function jumpToComment(target: { filePath: string; hunkId: string; elementId: string }) {
    setSelectedFilePath(target.filePath);
    setActiveJumpTarget(target);
  }

  if (!data) {
    return (
      <>
        <Toaster closeButton position="bottom-right" richColors />
        <header>
          <div className="header-inner">
            <div>
              <h1>🌚 moonreview</h1>
              <div className="meta">Loading...</div>
            </div>
          </div>
        </header>
        <main>
          <section className="panel">
            <div className={loadError ? "panel-message panel-message-error" : "panel-message"}>
              {loadError || "Loading review state..."}
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Toaster closeButton position="bottom-right" richColors />
      <Header />
      <main>
        <div className="review-layout">
          <LeftSidebar
            data={data}
            activeFilePath={selectedFilePath}
            onJumpToFile={jumpToFile}
            onJumpToComment={jumpToComment}
            onStageWholeFile={(file) => {
              setPendingStageFile({ filePath: file.filePath, fileName: file.fileName });
            }}
          />

          <section className="review-main">
            <Hunks
              hunks={data.hunks}
              agents={data.available_agents}
              selectedAgent={data.selected_agent}
              onAgentChange={handleAgentChange}
              selectedFilePath={selectedFilePath}
              targetFilePath={activeJumpTarget?.filePath ?? null}
              targetHunkId={activeJumpTarget?.hunkId ?? null}
            />
            <Footer exportText={data.export_text} />
          </section>
        </div>
      </main>
    </>
  );
}

function App() {
  return (
    <ReviewStoreProvider>
      <AppContent />
    </ReviewStoreProvider>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
