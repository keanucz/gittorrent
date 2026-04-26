use crate::process::{UiError, UiErrorCode};
use std::path::{Component, PathBuf};

const BASE58_ALPHABET: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub fn validate_repo_path(path: &str) -> Result<PathBuf, UiError> {
  if path.trim().is_empty() {
    return Err(UiError::new(UiErrorCode::InvalidInput, "Repository path is required"));
  }

  let parsed = PathBuf::from(path);
  if !parsed.is_absolute() {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Repository path must be absolute",
    ));
  }

  if parsed.components().any(|part| matches!(part, Component::ParentDir)) {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Repository path cannot contain path traversal components",
    ));
  }

  Ok(parsed)
}

pub fn validate_gittorrent_url(url: &str) -> Result<String, UiError> {
  if !url.starts_with("gittorrent://") {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Repository URL must start with gittorrent://",
    ));
  }

  let key = &url[7..];
  if key.is_empty() || !key.chars().all(|ch| BASE58_ALPHABET.contains(ch)) {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Repository URL key must be base58",
    ));
  }

  Ok(url.to_string())
}

pub fn validate_pubkey(pubkey: &str) -> Result<String, UiError> {
  if pubkey.len() != 64 {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Writer pubkey must be a 64-char hex string",
    ));
  }

  if !pubkey.chars().all(|ch| ch.is_ascii_hexdigit()) {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Writer pubkey must be lowercase or uppercase hex",
    ));
  }

  Ok(pubkey.to_lowercase())
}

pub fn validate_branch(branch: &str) -> Result<String, UiError> {
  if branch.trim().is_empty() {
    return Err(UiError::new(UiErrorCode::InvalidInput, "Branch is required"));
  }

  if branch.contains(char::is_whitespace) || branch.starts_with('-') {
    return Err(UiError::new(
      UiErrorCode::InvalidInput,
      "Branch name is invalid",
    ));
  }

  Ok(branch.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn rejects_relative_repo_path() {
    let result = validate_repo_path("./repos/example");
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().message, "Repository path must be absolute");
  }

  #[test]
  fn rejects_empty_repo_path() {
    let result = validate_repo_path("");
    assert!(result.is_err());
  }

  #[test]
  fn rejects_pear_url_with_non_base58() {
    let result = validate_gittorrent_url("gittorrent://abc-123");
    assert!(result.is_err());
  }

  #[test]
  fn rejects_too_short_pubkey() {
    let result = validate_pubkey(&"a".repeat(63));
    assert!(result.is_err());
  }

  #[test]
  fn rejects_too_long_pubkey() {
    let result = validate_pubkey(&"a".repeat(65));
    assert!(result.is_err());
  }

  #[test]
  fn accepts_valid_branch() {
    let result = validate_branch("main");
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "main");
  }

  #[test]
  fn rejects_branch_with_whitespace() {
    let result = validate_branch("main branch");
    assert!(result.is_err());
  }

  #[test]
  fn rejects_branch_starting_with_dash() {
    let result = validate_branch("-feature");
    assert!(result.is_err());
  }
}

