use std::{
    collections::{HashMap, HashSet},
    env,
    hash::{Hash, Hasher},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use axum::{
    Json, Router,
    extract::{Path as AxumPath, State},
    response::{Html, IntoResponse},
    routing::{get, post},
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 42000;
const SERVER_URL: &str = "http://127.0.0.1:42000";
const INDEX_HTML: &str = include_str!("index.html");
const APP_JS: &str = include_str!("../web/dist/app.js");
const APP_CSS: &str = include_str!("../web/dist/app.css");
const ANCHOR_OPEN: &str = "[[mr-anchor]]";
const SELECTION_MARK: &str = "[[selection]]";
const COMMENT_MARK: &str = "[[comment]]";
const ANCHOR_CLOSE: &str = "[[/mr-anchor]]";

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<ServerState>>,
}

#[derive(Default)]
struct ServerState {
    sessions: HashMap<String, RepoSession>,
}

struct RepoSession {
    repo_path: PathBuf,
    comments: HashMap<String, String>,
    reviewed: HashSet<String>,
}

#[derive(Serialize, Deserialize)]
struct SessionOpened {
    session_id: String,
}

#[derive(Serialize)]
struct SessionPayload {
    repo_name: String,
    repo_path: String,
    hunks: Vec<HunkView>,
    export_text: String,
}

#[derive(Serialize, Clone)]
struct HunkView {
    id: String,
    file_path: String,
    header: String,
    staged: bool,
    reviewed: bool,
    comment: String,
    patch_preview: String,
    patch_line_count: usize,
}

#[derive(Serialize)]
struct PatchPayload {
    patch: String,
}

#[derive(Serialize, Deserialize)]
struct OpenSessionRequest {
    repo_path: String,
}

#[derive(Deserialize)]
struct HunkRequest {
    hunk_id: String,
}

#[derive(Deserialize)]
struct FileRequest {
    file_path: String,
}

#[derive(Deserialize)]
struct CommentRequest {
    hunk_id: String,
    comment: String,
}

#[derive(Deserialize)]
struct SelectionRequest {
    hunk_id: String,
    selection: String,
}

#[derive(Clone)]
struct DiffHunk {
    id: String,
    file_path: String,
    header: String,
    patch: String,
    staged: bool,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("serve") => {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .context("failed to build tokio runtime")?;
            runtime.block_on(run_server())
        }
        _ => launch_review(),
    }
}

fn launch_review() -> Result<()> {
    let repo_path = canonicalize_repo(env::current_dir()?)?;
    ensure_server_running()?;

    let client = Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .context("failed to create client")?;

    let opened: SessionOpened = client
        .post(format!("{SERVER_URL}/api/session/open"))
        .json(&OpenSessionRequest {
            repo_path: repo_path.display().to_string(),
        })
        .send()
        .context("failed to connect to review server")?
        .error_for_status()
        .context("server refused to open session")?
        .json()
        .context("failed to decode session response")?;

    let url = format!("{SERVER_URL}/review/{}", opened.session_id);
    webbrowser::open(&url).context("failed to open browser")?;
    println!("Opened {url}");
    Ok(())
}

async fn run_server() -> Result<()> {
    let app = Router::new()
        .route("/", get(root))
        .route("/healthz", get(healthz))
        .route("/review/{session_id}", get(review_page))
        .route("/assets/app.js", get(app_js))
        .route("/assets/app.css", get(app_css))
        .route("/api/session/open", post(open_session))
        .route("/api/session/{session_id}/state", get(session_state))
        .route("/api/session/{session_id}/hunk/{hunk_id}", get(hunk_patch))
        .route("/api/session/{session_id}/reviewed", post(toggle_reviewed))
        .route("/api/session/{session_id}/comment", post(update_comment))
        .route("/api/session/{session_id}/stage", post(stage_hunk))
        .route("/api/session/{session_id}/stage-file", post(stage_file))
        .route("/api/session/{session_id}/stage-selection", post(stage_selection))
        .route("/api/session/{session_id}/unstage", post(unstage_hunk))
        .route("/api/session/{session_id}/unstage-file", post(unstage_file))
        .with_state(AppState {
            inner: Arc::new(Mutex::new(ServerState::default())),
        });

    let listener = tokio::net::TcpListener::bind((HOST, PORT))
        .await
        .with_context(|| format!("failed to bind {HOST}:{PORT}"))?;

    println!("Moon Review listening on {SERVER_URL}");
    axum::serve(listener, app).await.context("server failed")
}

async fn root() -> impl IntoResponse {
    Html("<!doctype html><title>Moon Review</title><p>Open via the CLI in a git repo.</p>")
}

async fn healthz() -> &'static str {
    "ok"
}

async fn review_page() -> Html<&'static str> {
    Html(INDEX_HTML)
}

async fn app_js() -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        APP_JS,
    )
}

async fn app_css() -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")],
        APP_CSS,
    )
}

async fn open_session(
    State(state): State<AppState>,
    Json(request): Json<OpenSessionRequest>,
) -> Result<Json<SessionOpened>, AppError> {
    let repo_path = canonicalize_repo(PathBuf::from(request.repo_path))?;
    let session_id = session_id_for(&repo_path);

    let mut guard = state.inner.lock().map_err(|_| anyhow!("state lock poisoned"))?;
    guard.sessions.insert(session_id.clone(), RepoSession {
        repo_path,
        comments: HashMap::new(),
        reviewed: HashSet::new(),
    });

    Ok(Json(SessionOpened { session_id }))
}

async fn session_state(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
) -> Result<Json<SessionPayload>, AppError> {
    let session = with_session(&state, &session_id, |session| {
        let hunks = collect_hunks(&session.repo_path)?;
        let views = hunks
            .into_iter()
            .map(|hunk| HunkView {
                comment: session
                    .comments
                    .get(&hunk.id)
                    .map(|comment| anchored_comments_only(comment))
                    .unwrap_or_default(),
                reviewed: session.reviewed.contains(&hunk.id),
                id: hunk.id,
                file_path: hunk.file_path,
                header: hunk.header,
                staged: hunk.staged,
                patch_preview: preview_patch(&hunk.patch, 20),
                patch_line_count: hunk.patch.lines().count(),
            })
            .collect::<Vec<_>>();

        Ok(SessionPayload {
            repo_name: session
                .repo_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("repo")
                .to_string(),
            repo_path: session.repo_path.display().to_string(),
            export_text: build_export_text(&views),
            hunks: views,
        })
    })?;

    Ok(Json(session))
}

async fn hunk_patch(
    AxumPath((session_id, hunk_id)): AxumPath<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<PatchPayload>, AppError> {
    let (_, patch, _) = lookup_hunk(&state, &session_id, &hunk_id)?;
    Ok(Json(PatchPayload { patch }))
}

async fn toggle_reviewed(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<HunkRequest>,
) -> Result<&'static str, AppError> {
    with_session(&state, &session_id, |session| {
        if !session.reviewed.insert(request.hunk_id.clone()) {
            session.reviewed.remove(&request.hunk_id);
        }
        Ok(())
    })?;
    Ok("ok")
}

async fn update_comment(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<CommentRequest>,
) -> Result<&'static str, AppError> {
    with_session(&state, &session_id, |session| {
        let comment = anchored_comments_only(&request.comment);
        if comment.trim().is_empty() {
            session.comments.remove(&request.hunk_id);
        } else {
            session.comments.insert(request.hunk_id.clone(), comment);
        }
        Ok(())
    })?;
    Ok("ok")
}

async fn stage_hunk(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<HunkRequest>,
) -> Result<&'static str, AppError> {
    let (repo_path, patch, is_staged) = lookup_hunk(&state, &session_id, &request.hunk_id)?;
    if is_staged {
        return Ok("ok");
    }
    apply_patch(&repo_path, &patch, true, false)?;
    Ok("ok")
}

async fn unstage_hunk(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<HunkRequest>,
) -> Result<&'static str, AppError> {
    let (repo_path, patch, is_staged) = lookup_hunk(&state, &session_id, &request.hunk_id)?;
    if !is_staged {
        return Ok("ok");
    }
    apply_patch(&repo_path, &patch, true, true)?;
    Ok("ok")
}

async fn stage_selection(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<SelectionRequest>,
) -> Result<&'static str, AppError> {
    let (repo_path, patch, is_staged) = lookup_hunk(&state, &session_id, &request.hunk_id)?;
    if is_staged {
        return Ok("ok");
    }
    let partial_patch = build_partial_patch_from_selection(&patch, &request.selection)?;
    apply_patch(&repo_path, &partial_patch, true, false)?;
    Ok("ok")
}

async fn stage_file(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<FileRequest>,
) -> Result<&'static str, AppError> {
    let repo_path = with_session(&state, &session_id, |session| Ok(session.repo_path.clone()))?;
    run_git_no_output(&repo_path, &["add", "--", &request.file_path]).map_err(AppError)?;
    Ok("ok")
}

async fn unstage_file(
    AxumPath(session_id): AxumPath<String>,
    State(state): State<AppState>,
    Json(request): Json<FileRequest>,
) -> Result<&'static str, AppError> {
    let repo_path = with_session(&state, &session_id, |session| Ok(session.repo_path.clone()))?;
    run_git_no_output(&repo_path, &["restore", "--staged", "--", &request.file_path]).map_err(AppError)?;
    Ok("ok")
}

fn with_session<T, F>(state: &AppState, session_id: &str, mut f: F) -> Result<T, AppError>
where
    F: FnMut(&mut RepoSession) -> Result<T>,
{
    let mut guard = state.inner.lock().map_err(|_| anyhow!("state lock poisoned"))?;
    let session = guard
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| anyhow!("unknown session"))?;
    f(session).map_err(AppError)
}

fn lookup_hunk(state: &AppState, session_id: &str, hunk_id: &str) -> Result<(PathBuf, String, bool), AppError> {
    with_session(state, session_id, |session| {
        let hunk = collect_hunks(&session.repo_path)?
            .into_iter()
            .find(|hunk| hunk.id == hunk_id)
            .ok_or_else(|| anyhow!("hunk no longer exists"))?;
        Ok((session.repo_path.clone(), hunk.patch, hunk.staged))
    })
}

fn ensure_server_running() -> Result<()> {
    if server_is_running() {
        return Ok(());
    }

    let exe = env::current_exe().context("failed to locate current executable")?;
    Command::new(exe)
        .arg("serve")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .context("failed to spawn review server")?;

    for _ in 0..30 {
        if server_is_running() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }

    bail!("review server did not become ready on {SERVER_URL}")
}

fn server_is_running() -> bool {
    TcpStream::connect((HOST, PORT)).is_ok()
}

fn canonicalize_repo(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref().canonicalize().context("failed to resolve path")?;
    if !path.join(".git").exists() {
        bail!("{} is not a git repository", path.display());
    }
    Ok(path)
}

fn collect_hunks(repo_path: &Path) -> Result<Vec<DiffHunk>> {
    let mut hunks = parse_diff(&run_git(repo_path, &["diff", "--no-color", "--unified=3"])?, false)?;
    hunks.extend(parse_diff(
        &run_git(repo_path, &["diff", "--cached", "--no-color", "--unified=3"])?,
        true,
    )?);
    for path in list_untracked_files(repo_path)? {
        let diff = run_git_allow_status(
            repo_path,
            &["diff", "--no-index", "--no-color", "--unified=3", "--", "/dev/null", &path],
            &[0, 1],
        )?;
        hunks.extend(parse_diff(&diff, false)?);
    }
    Ok(hunks)
}

fn parse_diff(diff: &str, staged: bool) -> Result<Vec<DiffHunk>> {
    let mut hunks = Vec::new();
    for section in split_diff_sections(diff) {
        let file_path = parse_file_path(&section).unwrap_or_else(|| "unknown".to_string());
        let mut prelude = Vec::new();
        let mut idx = 0usize;

        while idx < section.len() && !section[idx].starts_with("@@") {
            prelude.push(section[idx].clone());
            idx += 1;
        }

        while idx < section.len() {
            let header = section[idx].clone();
            let mut patch_lines = prelude.clone();
            patch_lines.push(header.clone());
            idx += 1;

            while idx < section.len()
                && !section[idx].starts_with("@@")
                && !section[idx].starts_with("diff --git ")
            {
                patch_lines.push(section[idx].clone());
                idx += 1;
            }

            let patch = format!("{}\n", patch_lines.join("\n"));
            let id = stable_id(&(file_path.clone(), header.clone(), patch.clone(), staged));
            hunks.push(DiffHunk {
                id,
                file_path: file_path.clone(),
                header,
                patch,
                staged,
            });
        }
    }

    Ok(hunks)
}

fn split_diff_sections(diff: &str) -> Vec<Vec<String>> {
    let mut sections = Vec::new();
    let mut current = Vec::new();

    for line in diff.lines() {
        if line.starts_with("diff --git ") && !current.is_empty() {
            sections.push(current);
            current = Vec::new();
        }
        current.push(line.to_string());
    }

    if !current.is_empty() {
        sections.push(current);
    }

    sections
}

fn parse_file_path(section: &[String]) -> Option<String> {
    for line in section {
        if let Some(path) = line.strip_prefix("+++ b/") {
            return Some(path.to_string());
        }
    }

    section.first().and_then(|line| {
        line.strip_prefix("diff --git a/")
            .and_then(|rest| rest.split_once(" b/").map(|(_, right)| right.to_string()))
    })
}

fn list_untracked_files(repo_path: &Path) -> Result<Vec<String>> {
    Ok(run_git(repo_path, &["ls-files", "--others", "--exclude-standard"])?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn run_git_allow_status(repo_path: &Path, args: &[&str], allowed: &[i32]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;

    let status = output.status.code().unwrap_or(-1);
    if !allowed.contains(&status) {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn build_export_text(hunks: &[HunkView]) -> String {
    let mut out = String::new();
    out.push_str("Moon Review notes\n");
    out.push_str("=================\n");
    out.push_str("Please fix these code issues:\n\n");

    for hunk in hunks.iter().filter(|h| h.reviewed || !h.comment.trim().is_empty()) {
        let anchored = parse_anchored_comments(&hunk.comment);
        if anchored.is_empty() {
            continue;
        }

        out.push_str(&format!("{} {}\n", hunk.file_path, hunk.header));
        for entry in anchored {
            out.push_str("Selected code: ");
            out.push_str(&entry.selection);
            out.push('\n');
            out.push_str("Issue: ");
            out.push_str(&entry.comment);
            out.push('\n');
            out.push('\n');
        }
    }

    if out.trim() == "Moon Review notes\n=================\nPlease fix these code issues:" {
        out.push_str("No review notes yet.\n");
    }

    out
}

struct AnchoredComment {
    selection: String,
    comment: String,
}

fn anchored_comments_only(value: &str) -> String {
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

fn parse_anchored_comments(value: &str) -> Vec<AnchoredComment> {
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
        let after_comment_mark = &after_selection_mark[comment_start + COMMENT_MARK.len()..];
        let Some(close_start) = after_comment_mark.find(ANCHOR_CLOSE) else {
            break;
        };
        let comment = after_comment_mark[..close_start].trim();

        if !selection.is_empty() || !comment.is_empty() {
            comments.push(AnchoredComment {
                selection: selection.to_string(),
                comment: comment.to_string(),
            });
        }

        remaining = &after_comment_mark[close_start + ANCHOR_CLOSE.len()..];
    }

    comments
}

fn preview_patch(patch: &str, lines: usize) -> String {
    patch.lines().take(lines).collect::<Vec<_>>().join("\n")
}

fn build_partial_patch_from_selection(patch: &str, selection: &str) -> Result<String> {
    let lines = patch.lines().map(ToOwned::to_owned).collect::<Vec<_>>();
    let header_index = lines
        .iter()
        .position(|line| line.starts_with("@@"))
        .ok_or_else(|| anyhow!("patch has no hunk header"))?;
    let prelude = &lines[..header_index];
    let header = &lines[header_index];
    let body = &lines[header_index + 1..];

    let selection_lines = selection
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if selection_lines.is_empty() {
        bail!("selection is empty");
    }

    let start = body
        .windows(selection_lines.len())
        .position(|window| {
            window
                .iter()
                .map(String::as_str)
                .eq(selection_lines.iter().map(String::as_str))
        })
        .ok_or_else(|| anyhow!("selected lines were not found in the hunk"))?;
    let end = start + selection_lines.len() - 1;

    let selected_slice = &body[start..=end];
    if !selected_slice
        .iter()
        .any(|line| line.starts_with('+') || line.starts_with('-'))
    {
        bail!("selection does not contain diff lines to stage");
    }

    let context_start = start.saturating_sub(3);
    let context_end = (end + 3).min(body.len().saturating_sub(1));
    let subset = &body[context_start..=context_end];

    let (old_start, new_start, _, _) = parse_hunk_header(header)?;
    let old_offset = body[..context_start]
        .iter()
        .filter(|line| !line.starts_with('+'))
        .count();
    let new_offset = body[..context_start]
        .iter()
        .filter(|line| !line.starts_with('-'))
        .count();
    let subset_old_count = subset.iter().filter(|line| !line.starts_with('+')).count();
    let subset_new_count = subset.iter().filter(|line| !line.starts_with('-')).count();

    let subset_header = format_hunk_header(
        old_start + old_offset,
        subset_old_count,
        new_start + new_offset,
        subset_new_count,
    );

    let mut out = String::new();
    out.push_str(&prelude.join("\n"));
    out.push('\n');
    out.push_str(&subset_header);
    out.push('\n');
    out.push_str(&subset.join("\n"));
    out.push('\n');
    Ok(out)
}

fn parse_hunk_header(header: &str) -> Result<(usize, usize, usize, usize)> {
    let raw = header
        .split("@@")
        .nth(1)
        .map(str::trim)
        .ok_or_else(|| anyhow!("invalid hunk header"))?;
    let mut parts = raw.split_whitespace();
    let old_part = parts.next().ok_or_else(|| anyhow!("invalid old hunk header"))?;
    let new_part = parts.next().ok_or_else(|| anyhow!("invalid new hunk header"))?;

    let (old_start, old_count) = parse_header_range(old_part.trim_start_matches('-'))?;
    let (new_start, new_count) = parse_header_range(new_part.trim_start_matches('+'))?;
    Ok((old_start, old_count, new_start, new_count))
}

fn parse_header_range(value: &str) -> Result<(usize, usize)> {
    if let Some((start, count)) = value.split_once(',') {
        Ok((start.parse()?, count.parse()?))
    } else {
        Ok((value.parse()?, 1))
    }
}

fn format_hunk_header(old_start: usize, old_count: usize, new_start: usize, new_count: usize) -> String {
    format!(
        "@@ -{},{} +{},{} @@",
        old_start, old_count, new_start, new_count
    )
}

fn apply_patch(repo_path: &Path, patch: &str, cached: bool, reverse: bool) -> Result<()> {
    let mut command = Command::new("git");
    command.current_dir(repo_path).arg("apply");
    if cached {
        command.arg("--cached");
    }
    if reverse {
        command.arg("--reverse");
    }
    command.arg("-");

    let output = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to start git apply")?
        .wait_with_output_from_stdin(patch.as_bytes())?;

    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(())
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;

    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn run_git_no_output(repo_path: &Path, args: &[&str]) -> Result<()> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;

    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }

    Ok(())
}

fn stable_id<T: Hash>(value: &T) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn session_id_for(path: &Path) -> String {
    stable_id(&path.display().to_string())
}

#[derive(Debug)]
struct AppError(anyhow::Error);

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(value: E) -> Self {
        Self(value.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        (axum::http::StatusCode::BAD_REQUEST, self.0.to_string()).into_response()
    }
}

trait ChildExt {
    fn wait_with_output_from_stdin(self, input: &[u8]) -> Result<std::process::Output>;
}

impl ChildExt for std::process::Child {
    fn wait_with_output_from_stdin(mut self, input: &[u8]) -> Result<std::process::Output> {
        use std::io::Write;

        if let Some(stdin) = self.stdin.as_mut() {
            stdin.write_all(input).context("failed to write patch to git apply")?;
        }
        self.wait_with_output().context("failed to wait for git apply")
    }
}
