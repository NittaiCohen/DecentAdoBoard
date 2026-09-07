#![deny(warnings)]

mod ado_client;
mod ado_creation;
mod ado_writes;
mod ai_planner;
mod audit_log;
mod auth;
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
            commands::set_config,
            commands::set_pat,
            commands::login_az_cli,
            commands::get_board_data,
            commands::login_microsoft,
            commands::logout,
            commands::check_auth,
            commands::list_organizations,
            commands::list_projects,
            commands::list_teams,
            commands::list_area_paths,
            ado_writes::update_work_item_state,
            ado_writes::update_work_item_iteration,
            ado_writes::get_work_item_type_states,
            ado_writes::add_dependency,
            ado_writes::remove_dependency,
            ai_planner::get_ai_planner_context,
            ai_planner::generate_work_item_plan,
            ado_creation::submit_work_item_plan,
            commands::write_debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
