//! External commands, printed before they run.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use anyhow::{Context, Result, bail};

use crate::log;

#[derive(Debug, Clone)]
pub struct Cmd {
    program: OsString,
    args: Vec<OsString>,
    cwd: Option<PathBuf>,
    /// `None` removes the variable from the child's environment.
    env: Vec<(OsString, Option<OsString>)>,
    quiet: bool,
}

impl Cmd {
    pub fn new(program: impl AsRef<OsStr>) -> Self {
        Self {
            program: program.as_ref().to_owned(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            quiet: false,
        }
    }

    pub fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
        self.args.push(arg.as_ref().to_owned());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args.extend(args.into_iter().map(|arg| arg.as_ref().to_owned()));
        self
    }

    pub fn current_dir(mut self, dir: impl AsRef<Path>) -> Self {
        self.cwd = Some(dir.as_ref().to_owned());
        self
    }

    pub fn env(mut self, key: impl AsRef<OsStr>, value: impl AsRef<OsStr>) -> Self {
        self.env.push((key.as_ref().to_owned(), Some(value.as_ref().to_owned())));
        self
    }

    pub fn env_remove(mut self, key: impl AsRef<OsStr>) -> Self {
        self.env.push((key.as_ref().to_owned(), None));
        self
    }

    /// Do not print the command line (for frequent read-only probes).
    pub fn quiet(mut self) -> Self {
        self.quiet = true;
        self
    }

    /// The command as a copy-pasteable shell line.
    pub fn display(&self) -> String {
        let mut parts = vec![shell_quote(&self.program.to_string_lossy())];
        parts.extend(self.args.iter().map(|arg| shell_quote(&arg.to_string_lossy())));
        let line = parts.join(" ");
        match &self.cwd {
            Some(dir) => format!("(cd {} && {line})", shell_quote(&dir.to_string_lossy())),
            None => line,
        }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        if let Some(dir) = &self.cwd {
            command.current_dir(dir);
        }
        for (key, value) in &self.env {
            match value {
                Some(value) => command.env(key, value),
                None => command.env_remove(key),
            };
        }
        command
    }

    fn announce(&self) {
        if !self.quiet {
            log::info(format!("$ {}", self.display()));
        }
    }

    /// Runs with live output. The child's stdout is sent to stderr so that this tool's stdout
    /// only carries results.
    pub fn run(&self) -> Result<()> {
        self.announce();
        let status = self
            .command()
            .stdin(Stdio::null())
            .stdout(Stdio::from(std::io::stderr()))
            .stderr(Stdio::inherit())
            .status()
            .with_context(|| format!("could not start `{}`", self.display()))?;
        if !status.success() {
            bail!("`{}` failed ({status})", self.display());
        }
        Ok(())
    }

    /// Captures stdout and stderr; fails on a non-zero exit status.
    pub fn output(&self) -> Result<Output> {
        let output = self.output_any()?;
        if !output.status.success() {
            bail!(
                "`{}` failed ({}): {}",
                self.display(),
                output.status,
                excerpt(&output.stderr, &output.stdout)
            );
        }
        Ok(output)
    }

    /// Captures stdout and stderr whatever the exit status.
    pub fn output_any(&self) -> Result<Output> {
        self.announce();
        self.command()
            .stdin(Stdio::null())
            .output()
            .with_context(|| format!("could not start `{}`", self.display()))
    }

    /// Stdout as text; fails on a non-zero exit status.
    pub fn stdout_text(&self) -> Result<String> {
        let output = self.output()?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

/// Stdout followed by stderr, as one string (codesign prints its details on stderr).
pub fn combined(output: &Output) -> String {
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    text
}

fn excerpt(stderr: &[u8], stdout: &[u8]) -> String {
    let source =
        if stderr.iter().any(|byte| !byte.is_ascii_whitespace()) { stderr } else { stdout };
    let text = String::from_utf8_lossy(source);
    let text = text.trim();
    if text.chars().count() > 4000 {
        let tail: String =
            text.chars().rev().take(4000).collect::<Vec<_>>().into_iter().rev().collect();
        format!("…{tail}")
    } else {
        text.to_owned()
    }
}

/// Quotes a value for POSIX shells; plain words stay unquoted.
pub fn shell_quote(value: &str) -> String {
    let plain = !value.is_empty()
        && value.chars().all(|c| c.is_ascii_alphanumeric() || "_-./=:,+@%".contains(c));
    if plain { value.to_owned() } else { format!("'{}'", value.replace('\'', r"'\''")) }
}

/// The program name to use for npm/npx: Windows needs the `.cmd` shims spelled out.
pub fn node_tool(name: &str) -> String {
    if cfg!(windows) { format!("{name}.cmd") } else { name.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_only_when_needed() {
        assert_eq!(shell_quote("codesign"), "codesign");
        assert_eq!(shell_quote("--timestamp=none"), "--timestamp=none");
        assert_eq!(shell_quote("Azure timetracker.app"), "'Azure timetracker.app'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn display_includes_working_directory() {
        let cmd = Cmd::new("npm").arg("ci").current_dir("/tmp/a b");
        assert_eq!(cmd.display(), "(cd '/tmp/a b' && npm ci)");
    }
}
