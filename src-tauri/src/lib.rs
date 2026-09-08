#![deny(warnings)]

mod ado_client;
mod ado_writes;
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
            commands::get_board_work_item_types,
            commands::get_work_item_type_icon,
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
            commands::list_iteration_paths,
            commands::search_project_tags,
            commands::get_work_item_overview,
            commands::get_work_item_type_fields,
            commands::get_work_item_type_fields_batch,
            commands::refresh_work_item_type_fields_batch,
            commands::get_work_item_comments,
            commands::add_work_item_comment,
            commands::search_identities,
            ado_writes::update_work_item_state,
            ado_writes::update_work_item_iteration,
            ado_writes::update_work_item_fields,
            ado_writes::create_work_item,
            ado_writes::get_work_item_type_states,
            ado_writes::add_dependency,
            ado_writes::remove_dependency,
            commands::write_debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
