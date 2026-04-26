use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UiErrorCode {
  InvalidInput,
  PermissionDenied,
  NetworkUnavailable,
  CommandFailed,
  Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UiError {
  pub code: UiErrorCode,
  pub message: String,
  pub details: Option<String>,
}

impl UiError {
  pub fn new(code: UiErrorCode, message: impl Into<String>) -> Self {
    Self {
      code,
      message: message.into(),
      details: None,
    }
  }

  pub fn with_details(code: UiErrorCode, message: impl Into<String>, details: impl Into<String>) -> Self {
    Self {
      code,
      message: message.into(),
      details: Some(details.into()),
    }
  }
}

#[derive(Debug, Clone)]
pub struct CommandOutput {
  pub stdout: String,
  pub stderr: String,
}

pub fn map_exit_code(code: Option<i32>) -> UiErrorCode {
  match code {
    Some(2) => UiErrorCode::PermissionDenied,
    Some(3) => UiErrorCode::NetworkUnavailable,
    Some(_) => UiErrorCode::CommandFailed,
    None => UiErrorCode::Internal,
  }
}

fn apply_runtime_env(command: &mut Command) {
  if let Ok(state) = crate::commands::runtime_state().lock() {
    for (key, value) in &state.settings {
      if !value.is_empty() {
        command.env(key, value);
      }
    }
  }
}

fn run_with_binary(binary: &str, label: &str, args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput, UiError> {
  let mut command = Command::new(binary);
  command.args(args);

  if let Some(path) = cwd {
    command.current_dir(path);
  }

  apply_runtime_env(&mut command);

  let output = command.output().map_err(|err| {
    UiError::with_details(
      UiErrorCode::Internal,
      format!("Unable to execute {} command", label),
      err.to_string(),
    )
  })?;

  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();

  if output.status.success() {
    return Ok(CommandOutput { stdout, stderr });
  }

  let details = if !stderr.trim().is_empty() {
    stderr.trim().to_string()
  } else {
    stdout.trim().to_string()
  };

  Err(UiError::with_details(
    map_exit_code(output.status.code()),
    format!("{} command failed", label),
    details,
  ))
}

pub fn run_gittorrent(args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput, UiError> {
  run_with_binary("gittorrent", "gittorrent", args, cwd)
}

pub fn run_git(args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput, UiError> {
  run_with_binary("git", "git", args, cwd)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn maps_known_exit_codes() {
    assert_eq!(map_exit_code(Some(2)), UiErrorCode::PermissionDenied);
    assert_eq!(map_exit_code(Some(3)), UiErrorCode::NetworkUnavailable);
    assert_eq!(map_exit_code(Some(1)), UiErrorCode::CommandFailed);
    assert_eq!(map_exit_code(None), UiErrorCode::Internal);
  }

  #[test]
  fn builds_structured_error_with_details() {
    let err = UiError::with_details(UiErrorCode::InvalidInput, "invalid", "path traversal");
    assert_eq!(err.code, UiErrorCode::InvalidInput);
    assert_eq!(err.message, "invalid");
    assert_eq!(err.details.as_deref(), Some("path traversal"));
  }
}
