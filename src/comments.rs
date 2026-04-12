use std::{collections::HashSet, path::PathBuf, thread};

use anyhow::{Result, anyhow};

use crate::{
    agent::run_agent_dispatch,
    api::{
        AgentKind, AppState, CommentDispatchStatus, CommentDispatchView, CommentRequest, DiffHunk,
        EXPORT_SERVER_URL, HunkView, RepoSession, SERVER_URL, with_session,
    },
    git::collect_hunks,
};

const ANCHOR_OPEN: &str = "[[mr-anchor]]";
const SELECTION_MARK: &str = "[[selection]]";
const RESOLVED_MARK: &str = "[[resolved]]";
const COMMENT_MARK: &str = "[[comment]]";
const ANCHOR_CLOSE: &str = "[[/mr-anchor]]";

#[derive(Clone, Default)]
pub(crate) struct CommentDispatchState {
    pub(crate) status: CommentDispatchStatus,
    pub(crate) detail: String,
}

pub(crate) struct AnchoredComment {
    pub(crate) selection: String,
    pub(crate) comment: String,
    pub(crate) resolved: bool,
}

pub(crate) struct CommentUpdate {
    pub(crate) previous_anchored: Vec<AnchoredComment>,
    pub(crate) next_anchored: Vec<AnchoredComment>,
}

#[derive(Clone)]
pub(crate) struct DispatchJob {
    pub(crate) session_id: String,
    pub(crate) repo_path: PathBuf,
    pub(crate) ui_url: String,
    pub(crate) agent: AgentKind,
    pub(crate) hunk_id: String,
    pub(crate) file_path: String,
    pub(crate) header: String,
    pub(crate) comment_key: String,
    pub(crate) selection: String,
    pub(crate) comment: String,
}

pub(crate) fn build_anchored_comment_value(comments: &[AnchoredComment]) -> String {
    comments
        .iter()
        .map(|entry| {
            let mut lines = vec![
                ANCHOR_OPEN.to_string(),
                SELECTION_MARK.to_string(),
                entry.selection.trim().to_string(),
            ];
            if entry.resolved {
                lines.push(RESOLVED_MARK.to_string());
            }
            lines.push(COMMENT_MARK.to_string());
            lines.push(entry.comment.trim().to_string());
            lines.push(ANCHOR_CLOSE.to_string());
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn anchored_comments_only(value: &str) -> String {
    let mut blocks = Vec::new();
    let mut remaining = value;

    while let Some(start) = remaining.find(ANCHOR_OPEN) {
        let after_start = &remaining[start..];
        let Some(end_offset) = after_start.find(ANCHOR_CLOSE) else {
            break;
        };
        let end = start + end_offset + ANCHOR_CLOSE.len();
        let block = remaining[start..end].trim();
        if !block.is_empty() {
            blocks.push(block.to_string());
        }
        remaining = &remaining[end..];
    }

    blocks.join("\n\n")
}

pub(crate) fn parse_anchored_comments(value: &str) -> Vec<AnchoredComment> {
    let mut comments = Vec::new();
    let mut remaining = value;

    while let Some(start) = remaining.find(ANCHOR_OPEN) {
        let after_open = &remaining[start + ANCHOR_OPEN.len()..];
        let Some(selection_start) = after_open.find(SELECTION_MARK) else {
            break;
        };
        let after_selection_mark = &after_open[selection_start + SELECTION_MARK.len()..];
        let Some(comment_start) = after_selection_mark.find(COMMENT_MARK) else {
            break;
        };
        let selection = after_selection_mark[..comment_start].trim();
        let resolved = after_selection_mark
            .find(RESOLVED_MARK)
            .is_some_and(|index| index < comment_start);
        let after_comment_mark = &after_selection_mark[comment_start + COMMENT_MARK.len()..];
        let Some(close_start) = after_comment_mark.find(ANCHOR_CLOSE) else {
            break;
        };
        let comment = after_comment_mark[..close_start].trim();

        if !selection.is_empty() || !comment.is_empty() {
            comments.push(AnchoredComment {
                selection: selection.to_string(),
                comment: comment.to_string(),
                resolved,
            });
        }

        remaining = &after_comment_mark[close_start + ANCHOR_CLOSE.len()..];
    }

    comments
}

pub(crate) fn prune_comment_dispatches(
    session: &mut RepoSession,
    hunk_id: &str,
    comments: &[AnchoredComment],
) {
    let allowed = comments
        .iter()
        .map(|entry| dispatch_key(hunk_id, entry))
        .collect::<HashSet<_>>();
    session
        .comment_dispatches
        .retain(|key, _| !key.starts_with(&format!("{hunk_id}:")) || allowed.contains(key));
}

pub(crate) fn anchored_comment_key(entry: &AnchoredComment) -> String {
    crate::api::stable_id(&(entry.selection.trim(), entry.comment.trim()))
}

pub(crate) fn dispatch_key(hunk_id: &str, entry: &AnchoredComment) -> String {
    format!("{hunk_id}:{}", anchored_comment_key(entry))
}

pub(crate) fn spawn_comment_dispatch(state: AppState, job: DispatchJob) {
    thread::spawn(move || {
        let _ = with_session(&state, &job.session_id, |session| {
            if let Some(dispatch) = session
                .comment_dispatches
                .get_mut(&format!("{}:{}", job.hunk_id, job.comment_key))
            {
                dispatch.status = CommentDispatchStatus::Running;
                dispatch.detail = format!("Running in {}.", job.agent.label());
            }
            Ok(())
        });

        eprintln!(
            "[moonreview] dispatch start agent={} repo={} file={} hunk={}",
            job.agent.label(),
            job.repo_path.display(),
            job.file_path,
            job.hunk_id
        );
        let result = run_agent_dispatch(&job);
        match &result {
            Ok(detail) => eprintln!(
                "[moonreview] dispatch done agent={} file={} hunk={} detail={}",
                job.agent.label(),
                job.file_path,
                job.hunk_id,
                detail
            ),
            Err(error) => eprintln!(
                "[moonreview] dispatch failed agent={} file={} hunk={} error={}",
                job.agent.label(),
                job.file_path,
                job.hunk_id,
                error
            ),
        }
        let _ = with_session(&state, &job.session_id, |session| {
            let Some(dispatch) = session
                .comment_dispatches
                .get_mut(&format!("{}:{}", job.hunk_id, job.comment_key))
            else {
                return Ok(());
            };

            match &result {
                Ok(detail) => {
                    dispatch.status = CommentDispatchStatus::Completed;
                    dispatch.detail = detail.clone();
                }
                Err(error) => {
                    dispatch.status = CommentDispatchStatus::Failed;
                    dispatch.detail = error.to_string();
                }
            }

            Ok(())
        });
    });
}

pub(crate) fn build_export_text(session_id: &str, hunks: &[HunkView]) -> String {
    let mut out = String::new();
    out.push_str("Moon Review notes\n");
    out.push_str("=================\n");
    out.push_str("Please fix these code issues and mark as resolved:\n\n");

    for hunk in hunks.iter().filter(|h| h.reviewed || !h.comment.trim().is_empty()) {
        let anchored = parse_anchored_comments(&hunk.comment);
        if anchored.iter().all(|entry| entry.resolved) {
            continue;
        }

        out.push_str(&format!("{} {}\n", hunk.file_path, hunk.header));
        for (comment_index, entry) in anchored.into_iter().enumerate() {
            if entry.resolved {
                continue;
            }
            out.push_str("Selected code: ");
            out.push_str(&entry.selection);
            out.push('\n');
            out.push_str("Issue: ");
            out.push_str(&entry.comment);
            out.push('\n');
            out.push_str("Poke this url when done: ");
            out.push_str(&format!(
                "{EXPORT_SERVER_URL}/api/session/{session_id}/resolve/{}/{comment_index}",
                hunk.id
            ));
            out.push('\n');
            out.push('\n');
        }
    }

    if out.trim() == "Moon Review notes\n=================\nPlease fix these code issues and mark as resolved:" {
        out.push_str("No review notes yet.\n");
    }

    out
}

pub(crate) fn plan_comment_dispatches(
    session: &mut RepoSession,
    session_id: &str,
    request: &CommentRequest,
) -> Result<Vec<DispatchJob>> {
    let update = apply_comment_update(session, request);
    if !should_dispatch_comments(session, &update) {
        return Ok(Vec::new());
    }

    let hunk = lookup_dispatch_hunk(session, &request.hunk_id)?;
    let previous_keys = update
        .previous_anchored
        .iter()
        .map(anchored_comment_key)
        .collect::<HashSet<_>>();

    let jobs = update
        .next_anchored
        .iter()
        .filter(|entry| !entry.resolved)
        .filter_map(|entry| queue_dispatch_job(session, session_id, request, &hunk, &previous_keys, entry))
        .collect();

    Ok(jobs)
}

fn apply_comment_update(session: &mut RepoSession, request: &CommentRequest) -> CommentUpdate {
    let previous_comment = session.comments.get(&request.hunk_id).cloned().unwrap_or_default();
    let previous_anchored = parse_anchored_comments(&previous_comment);

    let next_comment = anchored_comments_only(&request.comment);
    if next_comment.trim().is_empty() {
        session.comments.remove(&request.hunk_id);
    } else {
        session.comments.insert(request.hunk_id.clone(), next_comment);
    }

    let stored_comment = session.comments.get(&request.hunk_id).cloned().unwrap_or_default();
    let next_anchored = parse_anchored_comments(&stored_comment);
    prune_comment_dispatches(session, &request.hunk_id, &next_anchored);

    CommentUpdate {
        previous_anchored,
        next_anchored,
    }
}

fn should_dispatch_comments(session: &RepoSession, update: &CommentUpdate) -> bool {
    session.selected_agent != AgentKind::None && !update.next_anchored.is_empty()
}

fn lookup_dispatch_hunk(session: &RepoSession, hunk_id: &str) -> Result<DiffHunk> {
    collect_hunks(&session.repo_path, &session.diff_target)?
        .into_iter()
        .find(|hunk| hunk.id == hunk_id)
        .ok_or_else(|| anyhow!("hunk no longer exists"))
}

fn queue_dispatch_job(
    session: &mut RepoSession,
    session_id: &str,
    request: &CommentRequest,
    hunk: &DiffHunk,
    previous_keys: &HashSet<String>,
    entry: &AnchoredComment,
) -> Option<DispatchJob> {
    let key = anchored_comment_key(entry);
    if previous_keys.contains(&key) {
        return None;
    }

    let dispatch_key = dispatch_key(&request.hunk_id, entry);
    session.comment_dispatches.insert(
        dispatch_key,
        CommentDispatchState {
            status: CommentDispatchStatus::Queued,
            detail: format!("Queued for {}.", session.selected_agent.label()),
        },
    );

    Some(DispatchJob {
        session_id: session_id.to_string(),
        repo_path: session.repo_path.clone(),
        ui_url: format!("{SERVER_URL}/review/{session_id}"),
        agent: session.selected_agent,
        hunk_id: request.hunk_id.clone(),
        file_path: hunk.file_path.clone(),
        header: hunk.header.clone(),
        comment_key: key.clone(),
        selection: entry.selection.clone(),
        comment: entry.comment.clone(),
    })
}

pub(crate) fn comment_dispatch_view(
    session: &RepoSession,
    hunk_id: &str,
    entry: &AnchoredComment,
) -> CommentDispatchView {
    session
        .comment_dispatches
        .get(&dispatch_key(hunk_id, entry))
        .map(|dispatch| CommentDispatchView {
            status: dispatch.status,
            detail: dispatch.detail.clone(),
            can_cancel: false,
        })
        .unwrap_or_default()
}
