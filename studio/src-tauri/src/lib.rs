mod backup;
mod project;
mod publish;
mod storage;
mod validation;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        .invoke_handler(tauri::generate_handler![
            project::open_project, project::project_info, project::sync_project, project::list_files, project::catalog,
            storage::read_project_file, storage::write_project_file,
            storage::save_draft, storage::read_draft, storage::clear_draft,
            storage::preview_image, storage::import_media, storage::read_external_csv,
            validation::validate_project, publish::preview_publication, publish::publish,
            backup::export_backup, backup::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("WebMAKER Studio non si è avviato");
}
