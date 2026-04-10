import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "highlight.js/styles/github.css";
import { Toaster, toast } from "sonner";
import "./app.css";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hunks } from "./components/hunks/Hunks";
import { ReviewStoreProvider, useReviewStore } from "./reviewStore";

function summaryStats(data: NonNullable<ReturnType<typeof useReviewStore>["state"]["data"]>) {
  const staged = data.hunks.filter((hunk) => hunk.staged).length;
  return {
    total: data.hunks.length,
    staged,
    comments: data.hunks.filter((hunk) => hunk.comment.trim()).length,
  };
}

function AppContent() {
  const {
    state: { data, loadError, busy },
  } = useReviewStore();

  async function handleCopyReview() {
    if (!data) {
      return;
    }

    try {
      await navigator.clipboard.writeText(data.export_text);
      toast.success("Review copied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to copy review.");
    }
  }

  if (!data) {
    return (
      <>
        <Toaster closeButton position="bottom-right" richColors />
        <header>
          <div>
            <h1>🌚 review</h1>
            <div className="meta">Loading...</div>
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

  const stats = summaryStats(data);

  return (
    <>
      <Toaster closeButton position="bottom-right" richColors />
      <Header
        repoPath={data.repo_path}
        busy={busy}
        onCopyExport={() => {
          void handleCopyReview();
        }}
      />
      <main>
        <section className="summary-line">
          <strong>{stats.total}</strong> hunks <span className="summary-separator">|</span> <strong>{stats.staged}</strong> staged <span className="summary-separator">|</span> <strong>{stats.comments}</strong> comments
        </section>
        <Hunks hunks={data.hunks} />
        <Footer exportText={data.export_text} />
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
