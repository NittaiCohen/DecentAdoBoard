mod ado_client;
mod ado_writes;
mod audit_log;
mod commands;
mod models;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            app.manage(state::AppState::new(data_dir));

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_pat,
            commands::set_config,
            commands::get_board_data,
            commands::generate_pat,
            commands::list_organizations,
            commands::list_projects,
            commands::list_teams,
            commands::list_area_paths,
            ado_writes::update_work_item_state,
            ado_writes::get_work_item_type_states,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
