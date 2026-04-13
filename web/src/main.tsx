import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "highlight.js/styles/github.css";
import { Toaster } from "sonner";
import "./app.css";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { LeftSidebar } from "./components/LeftSidebar";
import { Hunks } from "./components/hunks/Hunks";
import { ReviewStoreProvider, useReviewStore } from "./reviewStore";
import type { AgentKind } from "./types";

const AGENT_STORAGE_KEY = "moonreview:selected-agent";

function AppContent() {
  const {
    state: { data, loadError },
    actions,
  } = useReviewStore();
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

  function handleAgentChange(agent: AgentKind) {
    window.localStorage.setItem(AGENT_STORAGE_KEY, agent);
    void actions.setAgent(agent);
  }

  function jumpToFile(filePath: string) {
    setActiveJumpTarget({
      filePath,
      hunkId: null,
      elementId: `file-${encodeURIComponent(filePath)}`,
    });
  }

  function jumpToComment(target: { filePath: string; hunkId: string; elementId: string }) {
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
            onJumpToFile={jumpToFile}
            onJumpToComment={jumpToComment}
          />

          <section className="review-main">
            <Hunks
              hunks={data.hunks}
              agents={data.available_agents}
              selectedAgent={data.selected_agent}
              onAgentChange={handleAgentChange}
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
