mod agent;
mod api;
mod cli;
mod comments;
mod git;
mod server;

use anyhow::Result;

fn main() -> Result<()> {
    cli::run()
}
