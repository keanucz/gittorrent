use crate::process::{run_gittorrent, UiError, UiErrorCode};
use crate::validation::{validate_branch, validate_gittorrent_url, validate_pubkey, validate_repo_path};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSummary {
  pub path: String,
  pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStatusResponse {
  pub repo: String,
  pub peers: u32,
  pub signed_length: u64,
  pub pending_ops: u32,
  pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSummary {
  pub ok: bool,
  pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInitResponse {
  pub path: String,
  pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoCloneResponse {
  pub path: String,
  pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriterRecord {
  pub key: String,
  pub role: String,
  pub indexer: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretListItem {
  pub path: String,
  pub key_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedStatusResponse {
  pub active: bool,
  pub session_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsPayload {
  #[serde(rename = "GITTORRENT_DATA_DIR")]
  pub data_dir: String,
  #[serde(rename = "GITTORRENT_LOG_LEVEL")]
  pub log_level: String,
  #[serde(rename = "GITTORRENT_BOOTSTRAP_NODES")]
  pub bootstrap_nodes: String,
  #[serde(rename = "GITTORRENT_SEEDER_KEYS")]
  pub seeder_keys: String,
  #[serde(rename = "GITTORRENT_CONNECT_TIMEOUT")]
  pub connect_timeout: String,
}

#[derive(Debug)]
pub(crate) struct RuntimeState {
  seed_sessions: HashMap<String, Instant>,
  settings: HashMap<String, String>,
}

static RUNTIME_STATE: OnceLock<Mutex<RuntimeState>> = OnceLock::new();

pub(crate) fn runtime_state() -> &'static Mutex<RuntimeState> {
  RUNTIME_STATE.get_or_init(|| {
    let mut settings = HashMap::new();
    settings.insert(
      "GITTORRENT_DATA_DIR".to_string(),
      std::env::var("GITTORRENT_DATA_DIR").unwrap_or_else(|_| "~/.gittorrent".to_string()),
    );
    settings.insert(
      "GITTORRENT_LOG_LEVEL".to_string(),
      std::env::var("GITTORRENT_LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
    );
    settings.insert(
      "GITTORRENT_BOOTSTRAP_NODES".to_string(),
      std::env::var("GITTORRENT_BOOTSTRAP_NODES").unwrap_or_default(),
    );
    settings.insert(
      "GITTORRENT_SEEDER_KEYS".to_string(),
      std::env::var("GITTORRENT_SEEDER_KEYS").unwrap_or_default(),
    );
    settings.insert(
      "GITTORRENT_CONNECT_TIMEOUT".to_string(),
      std::env::var("GITTORRENT_CONNECT_TIMEOUT").unwrap_or_else(|_| "10000".to_string()),
    );

    Mutex::new(RuntimeState {
      seed_sessions: HashMap::new(),
      settings,
    })
  })
}

fn redact_sensitive_details(value: &str) -> String {
  value
    .replace("ciphertext", "[REDACTED_CIPHERTEXT]")
    .replace("secret material", "[REDACTED_SECRET_MATERIAL]")
}

fn map_permission_error(error: UiError) -> UiError {
  let details = error.details.clone().unwrap_or_default().to_lowercase();
  if details.contains("not an indexer") || details.contains("permission") || details.contains("forbidden") {
    return UiError::with_details(
      UiErrorCode::PermissionDenied,
      "Permission denied for writer operation",
      "Only indexers can invite or revoke writers.",
    );
  }

  error
}

#[tauri::command]
pub fn health_check() -> &'static str {
  "ok"
}

#[tauri::command]
pub fn repo_list() -> Result<Vec<RepoSummary>, UiError> {
  Ok(Vec::new())
}

#[tauri::command]
pub fn repo_status(path: String) -> Result<RepoStatusResponse, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["status", "--json"], Some(repo_path.as_path()))?;

  let first_line = output
    .stdout
    .lines()
    .find(|line| !line.trim().is_empty())
    .ok_or_else(|| UiError::new(UiErrorCode::CommandFailed, "Missing status output from gittorrent"))?;

  let parsed: serde_json::Value = serde_json::from_str(first_line).map_err(|err| {
    UiError::with_details(
      UiErrorCode::CommandFailed,
      "Unable to parse status output",
      err.to_string(),
    )
  })?;

  let repo = parsed
    .get("repo")
    .and_then(|value| value.as_str())
    .unwrap_or_default()
    .to_string();

  let peers = parsed
    .get("peers")
    .and_then(|value| value.as_u64())
    .unwrap_or(0) as u32;

  let signed_length = parsed
    .get("signedLength")
    .and_then(|value| value.as_u64())
    .unwrap_or(0);

  let pending_ops = parsed
    .get("pendingOps")
    .and_then(|value| value.as_u64())
    .unwrap_or(0) as u32;

  let last_error = parsed
    .get("lastError")
    .and_then(|value| value.as_str())
    .map(|value| value.to_string());

  Ok(RepoStatusResponse {
    repo,
    peers,
    signed_length,
    pending_ops,
    last_error,
  })
}

#[tauri::command]
pub fn repo_init(path: String) -> Result<RepoInitResponse, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["init"], Some(repo_path.as_path()))?;

  let url = output
    .stdout
    .lines()
    .map(str::trim)
    .find(|line| line.starts_with("gittorrent://"))
    .ok_or_else(|| UiError::new(UiErrorCode::CommandFailed, "Missing gittorrent:// URL from init output"))?
    .to_string();

  Ok(RepoInitResponse {
    path,
    url,
  })
}

#[tauri::command]
pub fn repo_clone(url: String, path: String) -> Result<RepoCloneResponse, UiError> {
  let clean_url = validate_gittorrent_url(&url)?;
  let repo_path = validate_repo_path(&path)?;

  run_gittorrent(&["clone", clean_url.as_str(), repo_path.to_string_lossy().as_ref()], None)?;

  Ok(RepoCloneResponse {
    path,
    url: clean_url,
  })
}

#[tauri::command]
pub fn repo_pull(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["pull"], Some(repo_path.as_path()))?;

  let message = if output.stdout.trim().is_empty() {
    "Pull completed".to_string()
  } else {
    output.stdout.trim().to_string()
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn repo_push(path: String, branch: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let clean_branch = validate_branch(&branch)?;
  let output = match run_gittorrent(&["push", "origin", clean_branch.as_str()], Some(repo_path.as_path())) {
    Ok(value) => value,
    Err(error) => {
      let details = error.details.clone().unwrap_or_default().to_lowercase();
      if details.contains("non-fast-forward") || details.contains("rejected") {
        return Err(UiError::with_details(
          UiErrorCode::CommandFailed,
          "Push rejected (non-fast-forward)",
          "Run git pull --rebase origin <branch>, resolve conflicts, then push again.",
        ));
      }

      return Err(error);
    }
  };

  let message = if output.stdout.trim().is_empty() {
    format!("Push to {} completed", clean_branch)
  } else {
    output.stdout.trim().to_string()
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn writer_list(path: String) -> Result<Vec<WriterRecord>, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["status", "--json"], Some(repo_path.as_path()))?;

  let first_line = output
    .stdout
    .lines()
    .find(|line| !line.trim().is_empty())
    .unwrap_or("{}");

  let parsed: serde_json::Value = serde_json::from_str(first_line).unwrap_or_else(|_| serde_json::json!({}));
  let writers_total = parsed
    .get("writers")
    .and_then(|value| value.as_u64())
    .unwrap_or(0);
  let indexers = parsed
    .get("indexers")
    .and_then(|value| value.as_u64())
    .unwrap_or(0);

  let mut list = Vec::new();
  if writers_total == 0 {
    return Ok(list);
  }

  for idx in 0..writers_total {
    let is_indexer = idx < indexers;
    list.push(WriterRecord {
      key: format!("writer-{}", idx + 1),
      role: if is_indexer { "Indexer".to_string() } else { "Writer".to_string() },
      indexer: is_indexer,
    });
  }

  Ok(list)
}

#[tauri::command]
pub fn writer_invite(path: String, pubkey: String, indexer: bool) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let clean_pubkey = validate_pubkey(&pubkey)?;

  let mut args = vec!["invite", clean_pubkey.as_str()];
  if indexer {
    args.push("--indexer");
  }

  let output = run_gittorrent(args.as_slice(), Some(repo_path.as_path())).map_err(map_permission_error)?;

  let message = if output.stdout.trim().is_empty() {
    "Writer invited".to_string()
  } else {
    output.stdout.trim().to_string()
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn writer_revoke(path: String, pubkey: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let clean_pubkey = validate_pubkey(&pubkey)?;
  let output = run_gittorrent(&["revoke", clean_pubkey.as_str()], Some(repo_path.as_path())).map_err(map_permission_error)?;

  let message = if output.stdout.trim().is_empty() {
    "Writer revoked".to_string()
  } else {
    output.stdout.trim().to_string()
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn secrets_list(path: String) -> Result<Vec<SecretListItem>, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["secrets", "list", "--json"], Some(repo_path.as_path()))?;

  let mut items = Vec::new();
  for line in output.stdout.lines() {
    if line.trim().is_empty() {
      continue;
    }

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
      let path = parsed
        .get("path")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
      let key_version = parsed
        .get("keyVersion")
        .or_else(|| parsed.get("key_version"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;

      if !path.is_empty() {
        items.push(SecretListItem { path, key_version });
      }
    }
  }

  Ok(items)
}

#[tauri::command]
pub fn secrets_add(path: String, file_path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["secrets", "add", file_path.as_str()], Some(repo_path.as_path())).map_err(|error| {
    UiError::with_details(
      error.code,
      error.message,
      redact_sensitive_details(error.details.unwrap_or_default().as_str()),
    )
  })?;

  let message = if output.stdout.trim().is_empty() {
    "Secret added".to_string()
  } else {
    redact_sensitive_details(output.stdout.trim())
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn secrets_get(path: String, secret_path: String) -> Result<String, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["secrets", "get", secret_path.as_str()], Some(repo_path.as_path())).map_err(|error| {
    UiError::with_details(
      error.code,
      error.message,
      redact_sensitive_details(error.details.unwrap_or_default().as_str()),
    )
  })?;

  Ok(output.stdout)
}

#[tauri::command]
pub fn secrets_remove(path: String, secret_path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["secrets", "rm", secret_path.as_str()], Some(repo_path.as_path())).map_err(|error| {
    UiError::with_details(
      error.code,
      error.message,
      redact_sensitive_details(error.details.unwrap_or_default().as_str()),
    )
  })?;

  let message = if output.stdout.trim().is_empty() {
    "Secret removed".to_string()
  } else {
    redact_sensitive_details(output.stdout.trim())
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn secrets_rotate(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["secrets", "rotate"], Some(repo_path.as_path())).map_err(|error| {
    UiError::with_details(
      error.code,
      error.message,
      redact_sensitive_details(error.details.unwrap_or_default().as_str()),
    )
  })?;

  let message = if output.stdout.trim().is_empty() {
    "Secrets key rotation complete".to_string()
  } else {
    redact_sensitive_details(output.stdout.trim())
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn seed_start(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let _ = run_gittorrent(&["seed", "start"], Some(repo_path.as_path()));

  let state = runtime_state();
  let mut guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;
  guard.seed_sessions.insert(path.clone(), Instant::now());

  Ok(SyncSummary {
    ok: true,
    message: "Seed start requested".to_string(),
  })
}

#[tauri::command]
pub fn seed_stop(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let _ = run_gittorrent(&["seed", "stop"], Some(repo_path.as_path()));

  let state = runtime_state();
  let mut guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;
  guard.seed_sessions.remove(path.as_str());

  Ok(SyncSummary {
    ok: true,
    message: "Seed stop requested".to_string(),
  })
}

#[tauri::command]
pub fn seed_status(path: String) -> Result<SeedStatusResponse, UiError> {
  let _ = validate_repo_path(&path)?;
  let state = runtime_state();
  let guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;

  if let Some(started) = guard.seed_sessions.get(path.as_str()) {
    return Ok(SeedStatusResponse {
      active: true,
      session_seconds: started.elapsed().as_secs(),
    });
  }

  Ok(SeedStatusResponse {
    active: false,
    session_seconds: 0,
  })
}

#[tauri::command]
pub fn settings_get() -> Result<SettingsPayload, UiError> {
  let state = runtime_state();
  let guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;

  Ok(SettingsPayload {
    data_dir: guard.settings.get("GITTORRENT_DATA_DIR").cloned().unwrap_or_default(),
    log_level: guard.settings.get("GITTORRENT_LOG_LEVEL").cloned().unwrap_or_else(|| "info".to_string()),
    bootstrap_nodes: guard.settings.get("GITTORRENT_BOOTSTRAP_NODES").cloned().unwrap_or_default(),
    seeder_keys: guard.settings.get("GITTORRENT_SEEDER_KEYS").cloned().unwrap_or_default(),
    connect_timeout: guard.settings.get("GITTORRENT_CONNECT_TIMEOUT").cloned().unwrap_or_else(|| "10000".to_string()),
  })
}

#[tauri::command]
pub fn settings_set(key: String, value: String) -> Result<SyncSummary, UiError> {
  let allowed = [
    "GITTORRENT_DATA_DIR",
    "GITTORRENT_LOG_LEVEL",
    "GITTORRENT_BOOTSTRAP_NODES",
    "GITTORRENT_SEEDER_KEYS",
    "GITTORRENT_CONNECT_TIMEOUT",
  ];

  if !allowed.contains(&key.as_str()) {
    return Err(UiError::new(UiErrorCode::InvalidInput, "Unsupported GITTORRENT_* setting"));
  }

  let state = runtime_state();
  let mut guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;
  guard.settings.insert(key.clone(), value);

  Ok(SyncSummary {
    ok: true,
    message: format!("{} updated", key),
  })
}

#[tauri::command]
pub fn set_log_level(value: String) -> Result<SyncSummary, UiError> {
  settings_set("GITTORRENT_LOG_LEVEL".to_string(), value)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn redacts_sensitive_details_correctly() {
    let input = "error: ciphertext was leaked";
    let output = redact_sensitive_details(input);
    assert_eq!(output, "error: [REDACTED_CIPHERTEXT] was leaked");
  }

  #[test]
  fn redacts_secret_material() {
    let input = "found secret material in log";
    let output = redact_sensitive_details(input);
    assert_eq!(output, "found [REDACTED_SECRET_MATERIAL] in log");
  }

  #[test]
  fn settings_set_rejects_unsupported_keys() {
    let result = settings_set("UNSUPPORTED".to_string(), "value".to_string());
    assert!(result.is_err());
  }

  #[test]
  fn settings_set_accepts_supported_keys() {
    let result = settings_set("GITTORRENT_LOG_LEVEL".to_string(), "debug".to_string());
    assert!(result.is_ok());
  }
}

