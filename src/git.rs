use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::{Context, Result, anyhow, bail};

use crate::{
    agent::ChildExt,
    api::{DiffHunk, DiffTarget, stable_id},
};

pub(crate) fn canonicalize_repo(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref().canonicalize().context("failed to resolve path")?;
    if !path.join(".git").exists() {
        bail!("{} is not a git repository", path.display());
    }
    Ok(path)
}

pub(crate) fn collect_hunks(repo_path: &Path, diff_target: &DiffTarget) -> Result<Vec<DiffHunk>> {
    if let Some(base) = &diff_target.base {
        let diff = run_target_diff(repo_path, base, diff_target.pathspec.as_deref())?;
        return parse_diff(&diff, false);
    }

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

fn run_target_diff(repo_path: &Path, base: &str, pathspec: Option<&str>) -> Result<String> {
    let mut args = vec!["diff", "--no-color", "--unified=3", base];
    if let Some(pathspec) = pathspec.filter(|value| !value.is_empty()) {
        args.push("--");
        args.push(pathspec);
    }
    run_git(repo_path, &args)
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

pub(crate) fn preview_patch(patch: &str, lines: usize) -> String {
    patch.lines().take(lines).collect::<Vec<_>>().join("\n")
}

pub(crate) fn build_partial_patch_from_selection(patch: &str, selection: &str) -> Result<String> {
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

pub(crate) fn apply_patch(repo_path: &Path, patch: &str, cached: bool, reverse: bool) -> Result<()> {
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
        .wait_with_output_from_stdin(patch.as_bytes(), "failed to write patch to git apply")?;

    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(())
}

pub(crate) fn run_git(repo_path: &Path, args: &[&str]) -> Result<String> {
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

pub(crate) fn run_git_no_output(repo_path: &Path, args: &[&str]) -> Result<()> {
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

pub(crate) fn parse_review_target(raw: Option<String>) -> Result<DiffTarget> {
    let Some(value) = raw else {
        return Ok(DiffTarget::default());
    };

    if value == "serve" {
        return Ok(DiffTarget::default());
    }

    if let Some((base, pathspec)) = value.split_once(':') {
        if base.trim().is_empty() {
            bail!("diff target base cannot be empty");
        }

        return Ok(DiffTarget {
            base: Some(base.trim().to_string()),
            pathspec: Some(pathspec.trim().to_string()),
        });
    }

    Ok(DiffTarget {
        base: Some(value),
        pathspec: None,
    })
}

fn command_exists(command: &str) -> bool {
    let Some(path_var) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path_var).any(|dir| {
        let candidate = dir.join(command);
        std::fs::metadata(candidate)
            .map(|meta| meta.is_file())
            .unwrap_or(false)
    })
}

pub(crate) fn detect_agent_availability() -> crate::api::AgentAvailability {
    crate::api::AgentAvailability {
        claude: command_exists("claude"),
        codex: command_exists("codex"),
    }
}

pub(crate) fn agent_is_available(
    availability: crate::api::AgentAvailability,
    agent: crate::api::AgentKind,
) -> bool {
    match agent {
        crate::api::AgentKind::None => true,
        crate::api::AgentKind::Claude => availability.claude,
        crate::api::AgentKind::Codex => availability.codex,
    }
}

pub(crate) fn agent_options(
    availability: crate::api::AgentAvailability,
) -> Vec<crate::api::AgentOption> {
    [
        (crate::api::AgentKind::None, "No agent"),
        (crate::api::AgentKind::Claude, "Claude"),
        (crate::api::AgentKind::Codex, "Codex"),
    ]
    .into_iter()
    .map(|(kind, label)| crate::api::AgentOption {
        kind,
        label,
        available: agent_is_available(availability, kind),
    })
    .collect()
}
