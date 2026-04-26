#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod process;
mod validation;

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      commands::health_check,
      commands::repo_list,
      commands::repo_status,
      commands::repo_init,
      commands::repo_clone,
      commands::repo_pull,
      commands::repo_push,
      commands::writer_list,
      commands::writer_invite,
      commands::writer_revoke,
      commands::secrets_list,
      commands::secrets_add,
      commands::secrets_get,
      commands::secrets_remove,
      commands::secrets_rotate,
      commands::seed_start,
      commands::seed_stop,
      commands::seed_status,
      commands::settings_get,
      commands::settings_set,
      commands::set_log_level
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application")
}
