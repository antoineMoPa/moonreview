use std::{
    env,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use reqwest::blocking::Client;

use crate::{
    api::{DiffTarget, HOST, OpenSessionRequest, PORT, SERVER_URL, SessionOpened},
    git::{canonicalize_repo, list_changed_submodule_repos, parse_review_target},
    server,
};

enum CliCommand {
    Help,
    Serve { logs: bool },
    Review { target: Option<String>, logs: bool },
}

pub(crate) fn run() -> Result<()> {
    match parse_cli_args(env::args().skip(1).collect::<Vec<_>>())? {
        CliCommand::Help => {
            print_help();
            Ok(())
        }
        CliCommand::Serve { logs } => {
            if logs {
                eprintln!("Moon Review server logs enabled.");
            }
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .context("failed to build tokio runtime")?;
            runtime.block_on(server::run_server())
        }
        CliCommand::Review { target, logs } => launch_review(target, logs),
    }
}

fn launch_review(raw_target: Option<String>, logs: bool) -> Result<()> {
    let diff_target = parse_review_target(raw_target)?;
    let repo_path = canonicalize_repo(env::current_dir()?)?;
    if logs {
        return launch_review_with_foreground_server(repo_path, diff_target);
    }

    ensure_server_running(logs)?;
    open_review_session(&repo_path, diff_target)?;
    Ok(())
}

fn launch_review_with_foreground_server(repo_path: PathBuf, diff_target: DiffTarget) -> Result<()> {
    if server_is_running() {
        bail!("moonreview server already running; stop it first to use --logs in the foreground");
    }

    println!("Moon Review server logs attached to this terminal. Press Ctrl+C to stop.");
    let server_thread = thread::spawn(|| -> Result<()> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .context("failed to build tokio runtime")?;
        runtime.block_on(server::run_server())
    });

    for _ in 0..30 {
        if server_is_running() {
            open_review_session(&repo_path, diff_target)?;
            return server_thread
                .join()
                .map_err(|_| anyhow!("review server thread panicked"))?;
        }
        thread::sleep(Duration::from_millis(150));
    }

    bail!("review server did not become ready on {SERVER_URL}")
}

fn open_review_session(repo_path: &Path, diff_target: DiffTarget) -> Result<()> {
    let extra_repo_paths = if diff_target.base.is_none() {
        list_changed_submodule_repos(repo_path)?
    } else {
        Vec::new()
    };

    let mut opened_urls = Vec::new();
    opened_urls.push(open_review_url_for_session(repo_path, &diff_target)?);
    for submodule_path in extra_repo_paths {
        opened_urls.push(open_review_url_for_session(&submodule_path, &diff_target)?);
    }

    for url in &opened_urls {
        webbrowser::open(url).context("failed to open browser")?;
        println!("Opened {url}");
    }

    Ok(())
}

fn open_review_url_for_session(repo_path: &Path, diff_target: &DiffTarget) -> Result<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .context("failed to create client")?;

    let opened: SessionOpened = client
        .post(format!("{SERVER_URL}/api/session/open"))
        .json(&OpenSessionRequest {
            repo_path: repo_path.display().to_string(),
            diff_target: Some(diff_target.clone()),
        })
        .send()
        .context("failed to connect to review server")?
        .error_for_status()
        .context("server refused to open session")?
        .json()
        .context("failed to decode session response")?;

    Ok(format!("{SERVER_URL}/review/{}", opened.session_id))
}

fn parse_cli_args(args: Vec<String>) -> Result<CliCommand> {
    let mut logs = false;
    let mut positional = Vec::new();

    for arg in args {
        match arg.as_str() {
            "--logs" => logs = true,
            "--help" | "-h" | "help" => return Ok(CliCommand::Help),
            _ if arg.starts_with('-') => bail!("unknown option: {arg}\n\n{}", help_text()),
            _ => positional.push(arg),
        }
    }

    match positional.as_slice() {
        [] => Ok(CliCommand::Review { target: None, logs }),
        [command] if command == "serve" => Ok(CliCommand::Serve { logs }),
        [command] if command == "diff" => Ok(CliCommand::Review { target: None, logs }),
        [command, target] if command == "diff" => Ok(CliCommand::Review {
            target: Some(target.clone()),
            logs,
        }),
        [target] => Ok(CliCommand::Review {
            target: Some(target.clone()),
            logs,
        }),
        _ => bail!("{}", help_text()),
    }
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> &'static str {
    "moonreview

Tiny local code review UI for git.

Usage:
  moonreview
  moonreview --logs
  moonreview diff <target>
  moonreview diff <target> --logs
  moonreview serve --logs
  moonreview --help

Examples:
  moonreview
  moonreview diff dev
  moonreview diff dev:./

Run `moonreview` inside any git repository you want to review.

Use `--logs` to run the server in the foreground and print agent/failure logs until you stop it with Ctrl+C.

`moonreview diff <target>` opens a read-only diff review against a git target.
Use `branch:pathspec` to limit the diff to part of the repo, for example `dev:./`."
}

fn ensure_server_running(logs: bool) -> Result<()> {
    if server_is_running() {
        if logs {
            eprintln!(
                "moonreview server already running; restart it to attach logs to this terminal"
            );
        }
        return Ok(());
    }

    let exe = env::current_exe().context("failed to locate current executable")?;
    let mut command = Command::new(exe);
    command.arg("serve").stdin(Stdio::null());
    if !logs {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }
    command.spawn().context("failed to spawn review server")?;

    if logs {
        println!("Moon Review server logs attached to this terminal.");
    }

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
