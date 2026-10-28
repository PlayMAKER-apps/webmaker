use crate::project::{editable, relative_path, root, ProjectState};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{collections::hash_map::DefaultHasher, fs::{self, OpenOptions}, hash::{Hash, Hasher}, io::Write, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use uuid::Uuid;

fn store_dir(root: &Path) -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let mut hasher = DefaultHasher::new();
    root.hash(&mut hasher);
    let path = local.join("WebMAKER Studio").join(format!("{:016x}", hasher.finish()));
    fs::create_dir_all(&path).map_err(|error| format!("Could not create local backups: {error}"))?;
    Ok(path)
}

fn backup_existing(root: &Path, relative: &str, source: &Path) -> Result<(), String> {
    if !source.exists() { return Ok(()); }
    let backup_dir = store_dir(root)?.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let safe = relative.replace('/', "__").replace('\\', "__");
    let target = backup_dir.join(format!("{safe}.{}.bak", Uuid::new_v4()));
    fs::copy(source, target).map_err(|error| format!("Could not create a safety backup: {error}"))?;
    Ok(())
}

pub fn atomic_write(root: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    let destination = relative_path(root, relative)?;
    let parent = destination.parent().ok_or("Invalid path.")?;
    fs::create_dir_all(parent).map_err(|error| format!("Folder is not writable: {error}"))?;
    let temp = parent.join(format!(".webmaker-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error| format!("Could not create a temporary file: {error}"))?;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|error| format!("Write failed: {error}"))?;
    drop(file);
    if destination.exists() { backup_existing(root, relative, &destination)?; }
    let replace = replace_file(&temp, &destination);
    if replace.is_err() { let _ = fs::remove_file(&temp); }
    replace
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let destination_wide: Vec<u16> = destination.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let result = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if result == 0 { Err(format!("Atomic replacement failed: {}", std::io::Error::last_os_error())) } else { Ok(()) }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| format!("Atomic replacement failed: {error}"))
}

fn validate_editable_content(relative: &str, content: &str) -> Result<(), String> {
    if relative.ends_with(".csv") {
        validate_csv_syntax(content)?;
        let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(content.as_bytes());
        let headers = reader.headers().map_err(|error| format!("Invalid CSV: {error}"))?;
        if headers.is_empty() { return Err("CSV has no headers.".into()); }
        let header_len = headers.len();
        for row in reader.records() {
            let row = row.map_err(|error| format!("Invalid CSV: {error}"))?;
            if row.len() > header_len { return Err("CSV row has more fields than declared columns.".into()); }
        }
    } else if relative.ends_with(".yaml") || relative.ends_with(".yml") {
        serde_yaml::from_str::<serde_yaml::Value>(content).map_err(|error| format!("Invalid YAML: {error}"))?;
    } else if relative.ends_with(".json") {
        serde_json::from_str::<serde_json::Value>(content).map_err(|error| format!("Invalid JSON: {error}"))?;
    } else if relative.ends_with(".md") {
        if !content.starts_with("---\n") && !content.starts_with("---\r\n") { return Err("News item is missing YAML front matter.".into()); }
        let rest = &content[4..];
        let (front, _) = rest.split_once("\n---\n").or_else(|| rest.split_once("\r\n---\r\n"))
            .ok_or("Front matter closing delimiter is missing.")?;
        serde_yaml::from_str::<serde_yaml::Value>(front).map_err(|error| format!("Invalid news metadata: {error}"))?;
    }
    Ok(())
}

pub(crate) fn validate_csv_syntax(content: &str) -> Result<(), String> {
    let mut chars = content.chars().peekable();
    let mut quoted = false;
    let mut after_quote = false;
    let mut field_start = true;
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') { chars.next(); }
                else { quoted = false; after_quote = true; }
            }
        } else if after_quote {
            match ch {
                ',' => { after_quote = false; field_start = true; },
                '\r' | '\n' => { after_quote = false; field_start = true; },
                _ => return Err("Invalid CSV: text after a closing quote.".into()),
            }
        } else {
            match ch {
                '"' if field_start => { quoted = true; field_start = false; },
                '"' => return Err("Invalid CSV: misplaced quote.".into()),
                ',' | '\r' | '\n' => field_start = true,
                _ => field_start = false,
            }
        }
    }
    if quoted { Err("Invalid CSV: unclosed quote.".into()) } else { Ok(()) }
}

#[tauri::command]
pub fn read_project_file(relative: String, state: tauri::State<'_, ProjectState>) -> Result<String, String> {
    let root = root(&state)?;
    if !editable(&relative) { return Err("This file type cannot be edited.".into()); }
    let path = relative_path(&root, &relative)?;
    if !path.exists() { return Ok(String::new()); }
    fs::read_to_string(path).map_err(|error| format!("Read failed: {error}"))
}

#[tauri::command]
pub fn write_project_file(relative: String, content: String, expected_content: String, state: tauri::State<'_, ProjectState>) -> Result<(), String> {
    let root = root(&state)?;
    write_for_root(&root, &relative, &content, &expected_content)
}

fn write_for_root(root: &Path, relative: &str, content: &str, expected_content: &str) -> Result<(), String> {
    if !editable(relative) { return Err("This file type cannot be edited.".into()); }
    validate_editable_content(relative, content)?;
    let destination = relative_path(root, relative)?;
    let current = if destination.exists() { fs::read(&destination).map_err(|error| error.to_string())? } else { Vec::new() };
    if current != expected_content.as_bytes() {
        return Err("The file changed on disk after you opened it. Your draft is safe. Reopen the file and compare versions before saving.".into());
    }
    if current == content.as_bytes() { return Ok(()); }
    atomic_write(root, relative, content.as_bytes())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft { pub relative: String, pub content: String, pub saved_at: u64 }

fn draft_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !editable(relative) { return Err("Draft is outside the editable folders.".into()); }
    let mut hasher = DefaultHasher::new(); relative.hash(&mut hasher);
    Ok(store_dir(root)?.join("drafts").join(format!("{:016x}.json", hasher.finish())))
}

pub(crate) fn draft_paths(root: &Path) -> Result<Vec<String>, String> {
    let folder = store_dir(root)?.join("drafts");
    if !folder.exists() { return Ok(Vec::new()); }
    let mut paths = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_file() || entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") { continue; }
        let bytes = fs::read(entry.path()).map_err(|error| error.to_string())?;
        let draft: Draft = serde_json::from_slice(&bytes).map_err(|error| format!("Local draft is unreadable: {error}"))?;
        if editable(&draft.relative) && relative_path(root, &draft.relative).is_ok() { paths.push(draft.relative); }
    }
    Ok(paths)
}

#[tauri::command]
pub fn save_draft(relative: String, content: String, state: tauri::State<'_, ProjectState>) -> Result<(), String> {
    let root = root(&state)?;
    let path = draft_path(&root, &relative)?;
    fs::create_dir_all(path.parent().ok_or("Invalid draft path.")?).map_err(|error| error.to_string())?;
    let draft = Draft { relative, content, saved_at: SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_secs() };
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error| error.to_string())?;
    file.write_all(&serde_json::to_vec(&draft).map_err(|error| error.to_string())?).and_then(|_| file.sync_all()).map_err(|error| error.to_string())?;
    drop(file);
    replace_file(&temp, &path)
}

#[tauri::command]
pub fn read_draft(relative: String, state: tauri::State<'_, ProjectState>) -> Result<Option<Draft>, String> {
    let root = root(&state)?;
    let path = draft_path(&root, &relative)?;
    if !path.exists() { return Ok(None); }
    let draft = serde_json::from_slice::<Draft>(&fs::read(path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    Ok(Some(draft))
}

#[tauri::command]
pub fn clear_draft(relative: String, state: tauri::State<'_, ProjectState>) -> Result<(), String> {
    let path = draft_path(&root(&state)?, &relative)?;
    if path.exists() { fs::remove_file(path).map_err(|error| error.to_string())?; }
    Ok(())
}

fn image_mime(path: &Path, data: &[u8]) -> Result<&'static str, String> {
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" if data.starts_with(b"\x89PNG\r\n\x1a\n") => Ok("image/png"),
        "jpg" | "jpeg" if data.starts_with(b"\xff\xd8\xff") => Ok("image/jpeg"),
        "webp" if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" => Ok("image/webp"),
        "gif" if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") => Ok("image/gif"),
        _ => Err("Invalid image format or mismatched extension.".into()),
    }
}

#[tauri::command]
pub fn preview_image(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    let length = fs::metadata(source).map_err(|error| error.to_string())?.len();
    if length > 8 * 1024 * 1024 { return Err("Image exceeds 8 MB.".into()); }
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    let mime = image_mime(source, &bytes)?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn import_media(path: String, state: tauri::State<'_, ProjectState>) -> Result<String, String> {
    let root = root(&state)?;
    let source = fs::canonicalize(&path).map_err(|_| "Image is inaccessible.".to_string())?;
    if !source.is_file() { return Err("Select an image file.".into()); }
    let length = fs::metadata(&source).map_err(|error| error.to_string())?.len();
    if length > 8 * 1024 * 1024 { return Err("Image exceeds 8 MB. Compress it before importing.".into()); }
    let bytes = fs::read(&source).map_err(|error| error.to_string())?;
    image_mime(&source, &bytes)?;
    let stem = source.file_stem().and_then(|value| value.to_str()).unwrap_or("image");
    let safe: String = stem.to_ascii_lowercase().chars().map(|char| if char.is_ascii_alphanumeric() || char == '-' { char } else { '-' }).collect();
    let safe = safe.trim_matches('-');
    let ext = source.extension().and_then(|value| value.to_str()).unwrap_or("png").to_ascii_lowercase();
    let filename = format!("{}-{}.{}", if safe.is_empty() { "image" } else { safe }, &Uuid::new_v4().simple().to_string()[..8], ext);
    let relative = format!("site/public/assets/{filename}");
    atomic_write(&root, &relative, &bytes)?;
    Ok(format!("/assets/{filename}"))
}

#[tauri::command]
pub fn read_external_csv(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    if source.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() != Some("csv") { return Err("Select a .csv file.".into()); }
    if fs::metadata(source).map_err(|error| error.to_string())?.len() > 2 * 1024 * 1024 { return Err("CSV exceeds 2 MB.".into()); }
    fs::read_to_string(source).map_err(|error| format!("CSV import failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn media_rejects_false_extension() { assert!(image_mime(Path::new("photo.png"), b"not a PNG").is_err()); }
    #[test]
    fn malformed_csv_is_not_saved() { assert!(validate_editable_content("site/data/games/a.csv", "id,name\na,\"not closed").is_err()); }
    #[test]
    fn external_change_is_not_overwritten() {
        let temp = std::env::temp_dir().join(format!("webmaker-storage-{}", Uuid::new_v4()));
        let data = temp.join("site/data");
        fs::create_dir_all(&data).unwrap();
        let root = temp.canonicalize().unwrap();
        let relative = "site/data/teams.yaml";
        fs::write(root.join(relative), "a: original\n").unwrap();
        let result = write_for_root(&root, relative, "a: studio\n", "a: stale\n");
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(root.join(relative)).unwrap(), "a: original\n");
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saves_results_roster_and_news_without_touching_other_files() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-fixtures");
        fs::create_dir_all(&fixtures).unwrap();
        let temp = fixtures.join(format!("webmaker-content-{}", Uuid::new_v4()));
        fs::create_dir_all(temp.join("site/data/games/2026-27")).unwrap();
        fs::create_dir_all(temp.join("site/content/news")).unwrap();
        let root = temp.canonicalize().unwrap();
        let content = [
            ("site/data/games/2026-27/league.csv", "id,date,home_score,away_score\ngame-1,2026-10-21,52,48\n"),
            ("site/data/rosters.csv", "season,competition,team_id,player_id,number\n2026-27,league,aurora,player,7\n"),
            ("site/content/news/sample.md", "---\ntitle: Match report\ndate: 2026-10-21\n---\nAurora won.\n"),
        ];
        for (path, value) in content {
            write_for_root(&root, path, value, "").unwrap();
            assert_eq!(fs::read_to_string(root.join(path)).unwrap(), value);
        }
        assert!(!root.join("site/data/teams.yaml").exists());
        assert!(root.starts_with(fixtures.canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
}
