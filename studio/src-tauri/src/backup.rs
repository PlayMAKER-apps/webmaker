use crate::{project::{editable, relative_path, root, ProjectState}, storage::atomic_write};
use serde::{Deserialize, Serialize};
use std::{fs::{self, File}, io::{Read, Write}, path::Path};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Manifest { format: String, version: u32, include_media: bool }

fn backup_path(relative: &str, include_media: bool) -> bool {
    editable(relative) || (include_media && relative.starts_with("site/public/assets/")
        && ["png", "jpg", "jpeg", "webp", "gif"].iter().any(|ext| relative.ends_with(&format!(".{ext}"))))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult { pub written: usize, pub skipped: Vec<String> }

#[tauri::command]
pub fn export_backup(path: String, include_media: bool, state: tauri::State<'_, ProjectState>) -> Result<BackupResult, String> {
    let root = root(&state)?;
    let target = Path::new(&path);
    if target.exists() { return Err("The ZIP file already exists. Choose a new name to keep the previous backup.".into()); }
    if !path.to_ascii_lowercase().ends_with(".zip") { return Err("The backup must use the .zip extension.".into()); }
    let file = File::create(target).map_err(|error| format!("Could not create backup: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let manifest = Manifest { format: "webmaker-backup".into(), version: FORMAT_VERSION, include_media };
    zip.start_file("manifest.json", options).map_err(|error| error.to_string())?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let mut count = 0;
    for folder in ["site/data", "site/content/news", "site/public/assets"] {
        if folder == "site/public/assets" && !include_media { continue; }
        for entry in walkdir::WalkDir::new(root.join(folder)).into_iter().filter_map(Result::ok).filter(|entry| entry.file_type().is_file()) {
            let relative = entry.path().strip_prefix(&root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/");
            if !backup_path(&relative, include_media) { continue; }
            zip.start_file(&relative, options).map_err(|error| error.to_string())?;
            zip.write_all(&fs::read(entry.path()).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
            count += 1;
        }
    }
    zip.finish().map_err(|error| error.to_string())?;
    Ok(BackupResult { written: count, skipped: Vec::new() })
}

#[tauri::command]
pub fn restore_backup(path: String, overwrite: bool, state: tauri::State<'_, ProjectState>) -> Result<BackupResult, String> {
    let root = root(&state)?;
    let file = File::open(path).map_err(|error| format!("Backup is inaccessible: {error}"))?;
    let mut zip = ZipArchive::new(file).map_err(|error| format!("Invalid ZIP: {error}"))?;
    let mut manifest_text = String::new();
    zip.by_name("manifest.json").map_err(|_| "WebMAKER manifest is missing.".to_string())?.read_to_string(&mut manifest_text).map_err(|error| error.to_string())?;
    let manifest: Manifest = serde_json::from_str(&manifest_text).map_err(|error| format!("Invalid manifest: {error}"))?;
    if !["webmaker-backup", "webmaker-nerone-backup"].contains(&manifest.format.as_str()) || manifest.version != FORMAT_VERSION { return Err("Backup version is incompatible with Studio 0.1.".into()); }
    let mut entries = Vec::new();
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|error| error.to_string())?;
        if entry.name() == "manifest.json" { continue; }
        let name = entry.name().to_string();
        if !backup_path(&name, manifest.include_media) { return Err(format!("File is not allowed in the backup: {name}")); }
        relative_path(&root, &name)?;
        if entry.size() > 16 * 1024 * 1024 { return Err(format!("File is too large for the backup: {name}")); }
        entries.push(name);
    }
    let mut result = BackupResult { written: 0, skipped: Vec::new() };
    for name in entries {
        let destination = relative_path(&root, &name)?;
        let mut bytes = Vec::new();
        zip.by_name(&name).map_err(|error| error.to_string())?.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        if destination.exists() && fs::read(&destination).map_err(|error| error.to_string())? == bytes { result.skipped.push(format!("{name}: already identical")); continue; }
        if destination.exists() && !overwrite { result.skipped.push(format!("{name}: already exists; not overwritten")); continue; }
        atomic_write(&root, &name, &bytes)?;
        result.written += 1;
    }
    Ok(result)
}
