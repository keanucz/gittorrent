use crate::process::{run_git, run_gittorrent, UiError, UiErrorCode};
use crate::validation::{validate_branch, validate_gittorrent_url, validate_pubkey, validate_repo_path};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSummary {
  pub path: String,
  pub url: Option<String>,
  /// Unix timestamp (seconds) of last open.  Zero for entries registered
  /// via init/clone that haven't been "focused" in the UI yet.  The home
  /// screen sorts recents by this value descending so the most-recent
  /// project lands at the top, JetBrains-style.
  #[serde(default, rename = "lastOpened")]
  pub last_opened: u64,
  /// Convenience display name for the sidebar — basename of `path`.
  #[serde(default)]
  pub name: String,
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
  pub settings: HashMap<String, String>,
}

static RUNTIME_STATE: OnceLock<Mutex<RuntimeState>> = OnceLock::new();

/// Where we store the list of known repo paths so the UI can re-hydrate them
/// on startup. ~/.gittorrent/desktop-repos.json.
fn registry_path() -> PathBuf {
  let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
  PathBuf::from(home).join(".gittorrent").join("desktop-repos.json")
}

fn load_registry() -> Vec<RepoSummary> {
  let path = registry_path();
  let bytes = match fs::read(&path) {
    Ok(b) => b,
    Err(_) => return Vec::new(),
  };
  serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_registry(repos: &[RepoSummary]) -> Result<(), UiError> {
  let path = registry_path();
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| {
      UiError::with_details(UiErrorCode::Internal, "Failed to create registry dir", e.to_string())
    })?;
  }
  let json = serde_json::to_vec_pretty(repos).map_err(|e| {
    UiError::with_details(UiErrorCode::Internal, "Failed to serialise registry", e.to_string())
  })?;
  fs::write(&path, json).map_err(|e| {
    UiError::with_details(UiErrorCode::Internal, "Failed to write registry", e.to_string())
  })?;
  Ok(())
}

fn basename_of(path: &str) -> String {
  Path::new(path)
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or(path)
    .to_string()
}

fn now_unix() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

fn register_repo(path: &str, url: Option<&str>) -> Result<(), UiError> {
  let mut list = load_registry();
  let now = now_unix();
  if let Some(existing) = list.iter_mut().find(|r| r.path == path) {
    if let Some(u) = url {
      existing.url = Some(u.to_string());
    }
    existing.name = basename_of(path);
    existing.last_opened = now;
  } else {
    list.push(RepoSummary {
      path: path.to_string(),
      url: url.map(String::from),
      last_opened: now,
      name: basename_of(path),
    });
  }
  save_registry(&list)
}

/// Read `origin` URL from a git repo. Returns None if not set or not a
/// gittorrent:// URL.
fn read_origin_url(path: &Path) -> Option<String> {
  let out = ProcessCommand::new("git")
    .args(["remote", "get-url", "origin"])
    .current_dir(path)
    .output()
    .ok()?;
  if !out.status.success() {
    return None;
  }
  let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
  if url.starts_with("gittorrent://") { Some(url) } else { None }
}

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
  let mut list = load_registry();
  // Refresh URL + name by reading origin again — cheap and keeps the UI in
  // sync when the user renames a dir or re-configures origin outside the app.
  for repo in list.iter_mut() {
    if repo.name.is_empty() {
      repo.name = basename_of(&repo.path);
    }
    if Path::new(&repo.path).exists() {
      if let Some(url) = read_origin_url(Path::new(&repo.path)) {
        repo.url = Some(url);
      }
    }
  }
  // Sort by last-opened desc so recent projects appear first.
  list.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
  Ok(list)
}

/// Remove `path` from the registry. Does NOT touch the filesystem.  Used by
/// the home screen's "Remove from Recent" action (right-click / context
/// menu), matching JetBrains' behaviour.
#[tauri::command]
pub fn repo_remove(path: String) -> Result<SyncSummary, UiError> {
  let mut list = load_registry();
  let before = list.len();
  list.retain(|r| r.path != path);
  if list.len() == before {
    return Ok(SyncSummary { ok: true, message: "Not in registry".into() });
  }
  save_registry(&list)?;
  Ok(SyncSummary { ok: true, message: "Removed from recents".into() })
}

/// Bump the `lastOpened` timestamp so the repo floats to the top of the
/// recents list. Called when the user opens a repo from the home screen.
#[tauri::command]
pub fn repo_touch(path: String) -> Result<SyncSummary, UiError> {
  let mut list = load_registry();
  let now = now_unix();
  if let Some(existing) = list.iter_mut().find(|r| r.path == path) {
    existing.last_opened = now;
    if existing.name.is_empty() {
      existing.name = basename_of(&path);
    }
    save_registry(&list)?;
    return Ok(SyncSummary { ok: true, message: "Recency updated".into() });
  }
  // Not in registry yet — auto-register (e.g. user drags in an existing repo).
  let url = read_origin_url(Path::new(&path));
  register_repo(&path, url.as_deref())?;
  Ok(SyncSummary { ok: true, message: "Added to recents".into() })
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

  // If the target isn't a git repo yet, bootstrap one with an empty initial
  // commit so `gittorrent init` has something to point at.
  let dot_git = repo_path.join(".git");
  if !dot_git.exists() {
    fs::create_dir_all(&repo_path).map_err(|e| {
      UiError::with_details(UiErrorCode::Internal, "Failed to create repo dir", e.to_string())
    })?;
    run_git(&["init", "-b", "master"], Some(repo_path.as_path()))?;
    // Best-effort user config — honors existing global config if present.
    let _ = run_git(&["config", "user.email", "demo@gittorrent.local"], Some(repo_path.as_path()));
    let _ = run_git(&["config", "user.name", "Gittorrent Demo"], Some(repo_path.as_path()));
    run_git(&["commit", "--allow-empty", "-m", "initial commit"], Some(repo_path.as_path()))?;
  }

  let output = run_gittorrent(&["init"], Some(repo_path.as_path()))?;

  let url = output
    .stdout
    .lines()
    .map(str::trim)
    .find(|line| line.starts_with("gittorrent://"))
    .ok_or_else(|| UiError::new(UiErrorCode::CommandFailed, "Missing gittorrent:// URL from init output"))?
    .to_string();

  register_repo(&path, Some(&url))?;

  Ok(RepoInitResponse {
    path,
    url,
  })
}

#[tauri::command]
pub fn repo_clone(url: String, path: String) -> Result<RepoCloneResponse, UiError> {
  let clean_url = validate_gittorrent_url(&url)?;
  let repo_path = validate_repo_path(&path)?;

  // Cloning happens via `git clone gittorrent://...` — the git-remote-gittorrent
  // helper handles the actual peer discovery + data transfer.
  run_git(&["clone", clean_url.as_str(), repo_path.to_string_lossy().as_ref()], None)?;

  register_repo(&path, Some(&clean_url))?;

  Ok(RepoCloneResponse {
    path,
    url: clean_url,
  })
}

#[tauri::command]
pub fn repo_pull(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  // `git pull` drives git-remote-gittorrent for the wire protocol and merges
  // changes into the working tree. Autobase ref sync + object fetch happens
  // inside the helper subprocess.
  let output = run_git(&["pull", "--rebase", "origin"], Some(repo_path.as_path()))?;

  let combined = format!("{}{}", output.stdout, output.stderr);
  let message = if combined.trim().is_empty() {
    "Pull completed".to_string()
  } else {
    combined.trim().to_string()
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn repo_push(path: String, branch: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let clean_branch = validate_branch(&branch)?;
  let output = match run_git(&["push", "origin", clean_branch.as_str()], Some(repo_path.as_path())) {
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

  let combined = format!("{}{}", output.stdout, output.stderr);
  let message = if combined.trim().is_empty() {
    format!("Push to {} completed", clean_branch)
  } else {
    combined.trim().to_string()
  };

  Ok(SyncSummary { ok: true, message })
}

#[tauri::command]
pub fn writer_list(path: String) -> Result<Vec<WriterRecord>, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let output = run_gittorrent(&["status", "--json"], Some(repo_path.as_path()))?;
  let line = output
    .stdout
    .lines()
    .find(|l| !l.trim().is_empty())
    .unwrap_or("{}");
  let parsed: serde_json::Value = serde_json::from_str(line).unwrap_or(serde_json::json!({}));

  // Preferred: explicit writerList from status --json (includes hex keys).
  if let Some(arr) = parsed.get("writerList").and_then(|v| v.as_array()) {
    return Ok(arr
      .iter()
      .map(|item| {
        let key = item.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let indexer = item.get("indexer").and_then(|v| v.as_bool()).unwrap_or(false);
        WriterRecord {
          key: key.clone(),
          role: if indexer { "Indexer".into() } else { "Writer".into() },
          indexer,
        }
      })
      .collect());
  }

  // Fallback: counts-only render for older CLI versions.
  let writers_total = parsed.get("writers").and_then(|v| v.as_u64()).unwrap_or(0);
  let indexers = parsed.get("indexers").and_then(|v| v.as_u64()).unwrap_or(0);
  let mut list = Vec::new();
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
  // `gittorrent secrets list --json` emits a single JSON array of paths.
  // Key version is a single repo-wide counter, read from `status --json`.
  let output = run_gittorrent(&["secrets", "list", "--json"], Some(repo_path.as_path()))?;

  let mut items = Vec::new();
  let line = output
    .stdout
    .lines()
    .find(|l| !l.trim().is_empty())
    .unwrap_or("[]");

  let paths: Vec<String> = serde_json::from_str(line).unwrap_or_default();

  // Pull key version from status — best effort.
  let key_version = run_gittorrent(&["status", "--json"], Some(repo_path.as_path()))
    .ok()
    .and_then(|out| {
      let first = out.stdout.lines().find(|l| !l.trim().is_empty())?.to_string();
      let parsed: serde_json::Value = serde_json::from_str(&first).ok()?;
      parsed
        .get("secrets")
        .and_then(|s| s.get("keyVersion"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
    })
    .unwrap_or(0);

  for p in paths {
    items.push(SecretListItem { path: p, key_version });
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

/// Look up the URL for a repo path via origin remote.  Required for seeder
/// process management so we can match seed processes to repos.
fn repo_url_for(path: &Path) -> Option<String> {
  read_origin_url(path)
}

/// Find seeder PIDs that are serving `url`.  We use pgrep since the seeder
/// is spawned as `node gittorrent seed <url>` (detached daemon mode).
fn find_seeder_pids(url: &str) -> Vec<u32> {
  let out = ProcessCommand::new("pgrep")
    .args(["-f", &format!("gittorrent seed.*{}", url)])
    .output();
  match out {
    Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
      .lines()
      .filter_map(|l| l.trim().parse::<u32>().ok())
      .collect(),
    _ => Vec::new(),
  }
}

#[tauri::command]
pub fn seed_start(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let url = repo_url_for(repo_path.as_path())
    .ok_or_else(|| UiError::new(UiErrorCode::InvalidInput, "Repo has no gittorrent:// origin set"))?;

  // If a seeder is already running for this repo we're done.
  if !find_seeder_pids(&url).is_empty() {
    let state = runtime_state();
    let mut guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;
    guard.seed_sessions.insert(path.clone(), Instant::now());
    return Ok(SyncSummary { ok: true, message: "Seeder already running".into() });
  }

  // Spawn a detached seeder. Detach via double-fork equivalent: use
  // setsid + stdio to /dev/null.
  let mut cmd = ProcessCommand::new("gittorrent");
  cmd.args(["seed", "-d", url.as_str()]);
  cmd.current_dir(repo_path.as_path());
  cmd.stdin(std::process::Stdio::null());
  cmd.stdout(std::process::Stdio::null());
  cmd.stderr(std::process::Stdio::null());

  cmd.spawn().map_err(|e| {
    UiError::with_details(UiErrorCode::Internal, "Failed to spawn seeder", e.to_string())
  })?;

  let state = runtime_state();
  let mut guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;
  guard.seed_sessions.insert(path.clone(), Instant::now());

  Ok(SyncSummary { ok: true, message: format!("Seeder started for {}", url) })
}

#[tauri::command]
pub fn seed_stop(path: String) -> Result<SyncSummary, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let url = repo_url_for(repo_path.as_path())
    .ok_or_else(|| UiError::new(UiErrorCode::InvalidInput, "Repo has no gittorrent:// origin set"))?;

  let pids = find_seeder_pids(&url);
  for pid in &pids {
    let _ = ProcessCommand::new("kill").arg(pid.to_string()).status();
  }

  let state = runtime_state();
  let mut guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;
  guard.seed_sessions.remove(path.as_str());

  Ok(SyncSummary {
    ok: true,
    message: format!("Stopped {} seeder(s)", pids.len()),
  })
}

#[tauri::command]
pub fn seed_status(path: String) -> Result<SeedStatusResponse, UiError> {
  let repo_path = validate_repo_path(&path)?;
  let url = repo_url_for(repo_path.as_path());
  let pids = url.as_deref().map(find_seeder_pids).unwrap_or_default();
  let active = !pids.is_empty();

  let state = runtime_state();
  let guard = state.lock().map_err(|_| UiError::new(UiErrorCode::Internal, "Runtime state lock failed"))?;

  let session_seconds = guard
    .seed_sessions
    .get(path.as_str())
    .map(|started| started.elapsed().as_secs())
    .unwrap_or(0);

  Ok(SeedStatusResponse { active, session_seconds })
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

