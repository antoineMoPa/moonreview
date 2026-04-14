use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
};

use anyhow::{Context, Result, anyhow, bail};

use crate::{api::AgentKind, comments::DispatchJob};

pub(crate) fn run_agent_dispatch(job: &DispatchJob) -> Result<String> {
    let prompt = build_agent_prompt(job);
    match job.agent {
        AgentKind::None => Ok(String::new()),
        AgentKind::Claude => run_claude(prompt, &job.repo_path),
        AgentKind::Codex => run_codex(prompt, &job.repo_path),
    }
}

fn build_agent_prompt(job: &DispatchJob) -> String {
    format!(
        "Moon Review note\n=================\nPlease fix this code issue.\n\nRepository: {}\nFile: {}\nHunk: {}\n\nSelected code:\n{}\n\nIssue:\n{}\n\nMoonreview UI:\n{}\n",
        job.repo_path.display(),
        job.file_path,
        job.header,
        job.selection,
        job.comment,
        job.ui_url,
    )
}

fn run_claude(prompt: String, repo_path: &Path) -> Result<String> {
    let output = Command::new("claude")
        .current_dir(repo_path)
        .args(["-p", "--permission-mode", "bypassPermissions"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to start Claude")?
        .wait_with_streamed_output_from_stdin(
            prompt.as_bytes(),
            "failed to write prompt to Claude",
            "[moonreview] Claude stdout: ",
            "[moonreview] Claude stderr: ",
        )?;

    summarize_agent_output("Claude", output)
}

fn run_codex(prompt: String, repo_path: &Path) -> Result<String> {
    let output = Command::new("codex")
        .current_dir(repo_path)
        .args(["exec", "--full-auto", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to start Codex")?
        .wait_with_streamed_output_from_stdin(
            prompt.as_bytes(),
            "failed to write prompt to Codex",
            "[moonreview] Codex stdout: ",
            "[moonreview] Codex stderr: ",
        )?;

    summarize_agent_output("Codex", output)
}

fn summarize_agent_output(agent: &str, output: std::process::Output) -> Result<String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if stderr.is_empty() {
            stdout.clone()
        } else {
            stderr.clone()
        };
        bail!("{agent} failed: {}", detail.trim());
    }

    let summary = if stdout.is_empty() { stderr } else { stdout };
    Ok(if summary.is_empty() {
        format!("Sent to {agent}.")
    } else {
        format!("{}: {}", agent, summarize_text(&summary, 240))
    })
}

fn summarize_text(value: &str, max_len: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_len {
        return compact;
    }

    compact
        .chars()
        .take(max_len.saturating_sub(1))
        .collect::<String>()
        + "…"
}

pub(crate) trait ChildExt {
    fn wait_with_output_from_stdin(
        self,
        input: &[u8],
        write_error: &str,
    ) -> Result<std::process::Output>;
    fn wait_with_streamed_output_from_stdin(
        self,
        input: &[u8],
        write_error: &str,
        stdout_prefix: &'static str,
        stderr_prefix: &'static str,
    ) -> Result<std::process::Output>;
}

impl ChildExt for std::process::Child {
    fn wait_with_output_from_stdin(
        mut self,
        input: &[u8],
        write_error: &str,
    ) -> Result<std::process::Output> {
        use std::io::Write;

        if let Some(stdin) = self.stdin.as_mut() {
            stdin.write_all(input).context(write_error.to_string())?;
        }
        self.wait_with_output()
            .context("failed to wait for process")
    }

    fn wait_with_streamed_output_from_stdin(
        mut self,
        input: &[u8],
        write_error: &str,
        stdout_prefix: &'static str,
        stderr_prefix: &'static str,
    ) -> Result<std::process::Output> {
        use std::io::Write;

        if let Some(stdin) = self.stdin.as_mut() {
            stdin.write_all(input).context(write_error.to_string())?;
        }
        drop(self.stdin.take());

        let stdout = self
            .stdout
            .take()
            .ok_or_else(|| anyhow!("process stdout was not piped"))?;
        let stderr = self
            .stderr
            .take()
            .ok_or_else(|| anyhow!("process stderr was not piped"))?;

        let stdout_thread = thread::spawn(move || stream_reader(stdout, stdout_prefix));
        let stderr_thread = thread::spawn(move || stream_reader(stderr, stderr_prefix));

        let status = self.wait().context("failed to wait for process")?;
        let stdout = stdout_thread
            .join()
            .map_err(|_| anyhow!("stdout stream thread panicked"))??;
        let stderr = stderr_thread
            .join()
            .map_err(|_| anyhow!("stderr stream thread panicked"))??;

        Ok(std::process::Output {
            status,
            stdout,
            stderr,
        })
    }
}

fn stream_reader<R: Read>(mut reader: R, prefix: &'static str) -> Result<Vec<u8>> {
    let mut collected = Vec::new();
    let mut buffer = [0u8; 4096];

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .context("failed to read process output")?;
        if bytes_read == 0 {
            break;
        }

        let chunk = &buffer[..bytes_read];
        collected.extend_from_slice(chunk);
        eprint!("{prefix}{}", String::from_utf8_lossy(chunk));
    }

    Ok(collected)
}
