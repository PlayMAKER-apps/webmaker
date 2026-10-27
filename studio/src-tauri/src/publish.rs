use crate::{project::{changed_files, editable, git, info, configured_remote, club_urls, relative_path, root, ProjectState}, validation::validate};
use serde::Serialize;
use std::path::Path;

fn publishable(path: &str) -> bool {
    editable(path) || (path.starts_with("site/public/assets/") && ["png", "jpg", "jpeg", "webp", "gif"].iter().any(|ext| path.ends_with(&format!(".{ext}"))))
}

fn normalize_selected(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let changed = changed_files(root)?;
    let mut selected = Vec::new();
    for path in paths {
        let normalized = path.replace('\\', "/");
        if !publishable(&normalized) { return Err(format!("File non pubblicabile: {normalized}")); }
        relative_path(root, &normalized)?;
        if !changed.contains(&normalized) { return Err(format!("File senza modifiche locali: {normalized}")); }
        if !selected.contains(&normalized) { selected.push(normalized); }
    }
    if selected.is_empty() { return Err("Seleziona almeno un file dati o media modificato.".into()); }
    Ok(selected)
}

fn upstream_counts(root: &Path) -> Result<(u32, u32), String> {
    let raw = git(root, &["rev-list", "--left-right", "--count", "HEAD...origin/main"])?;
    let parts: Vec<_> = raw.split_whitespace().collect();
    if parts.len() != 2 { return Err("Impossibile confrontare main con origin/main.".into()); }
    Ok((parts[0].parse().map_err(|_| "Conteggio commit non valido.")?, parts[1].parse().map_err(|_| "Conteggio commit non valido.")?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationPreview {
    pub branch: String,
    pub remote: String,
    pub files: Vec<String>,
    pub diff: String,
    pub errors: Vec<String>,
    pub can_publish: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[tauri::command]
pub fn preview_publication(paths: Vec<String>, state: tauri::State<'_, ProjectState>) -> Result<PublicationPreview, String> {
    let root = root(&state)?;
    preview_for_root(&root, paths)
}

fn preview_for_root(root: &Path, paths: Vec<String>) -> Result<PublicationPreview, String> {
    let files = normalize_selected(root, &paths)?;
    let project = info(root)?;
    let mut errors = validate(root).errors;
    if project.branch != "main" { errors.push("Pubblicazione bloccata: lavora su un clone autorizzato con branch main. Questo branch è adatto al dry run.".into()); }
    if !configured_remote(root, &project.remote) { errors.push("Origin non coincide con repository_url del club.".into()); }
    let counts = upstream_counts(root).ok();
    if let Some((ahead, behind)) = counts {
        if ahead != 0 || behind != 0 { errors.push(format!("HEAD non allineato a origin/main: {ahead} commit avanti, {behind} indietro. Risolvi manualmente.")); }
    } else { errors.push("Impossibile verificare origin/main: esegui una sincronizzazione prima di pubblicare.".into()); }
    let staged = git(root, &["diff", "--cached", "--name-only"])?;
    if !staged.trim().is_empty() { errors.push("Sono presenti file già in staging: libera lo staging prima della pubblicazione.".into()); }
    let mut args = vec!["diff", "--no-ext-diff", "--"];
    args.extend(files.iter().map(String::as_str));
    let diff = git(root, &args)?;
    Ok(PublicationPreview { branch: project.branch, remote: project.remote, files, diff, can_publish: errors.is_empty(), errors, ahead: counts.map(|c| c.0), behind: counts.map(|c| c.1) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationResult { pub commit: String, pub commit_url: String, pub actions_url: String, pub site_url: String, pub deploy_status: String }

#[tauri::command]
pub fn publish(paths: Vec<String>, message: String, confirmation: String, state: tauri::State<'_, ProjectState>) -> Result<PublicationResult, String> {
    if confirmation != "PUBBLICA SU MAIN" { return Err("Conferma esplicita mancante: digita PUBBLICA SU MAIN.".into()); }
    let root = root(&state)?;
    let files = normalize_selected(&root, &paths)?;
    let project = info(&root)?;
    if project.branch != "main" || !configured_remote(&root, &project.remote) { return Err("Pubblicazione consentita solo da main del repository configurato per il club.".into()); }
    let report = validate(&root);
    if !report.errors.is_empty() { return Err(format!("Validazione fallita:\n{}", report.errors.join("\n"))); }
    if !git(&root, &["diff", "--cached", "--name-only"])?.is_empty() { return Err("Staging già occupato: annulla o completa quelle modifiche prima di pubblicare.".into()); }
    git(&root, &["fetch", "origin", "main"])?;
    let (ahead, behind) = upstream_counts(&root)?;
    if ahead != 0 || behind != 0 { return Err(format!("Pubblicazione bloccata: {ahead} commit avanti e {behind} indietro rispetto a origin/main. Risolvi manualmente.")); }
    let subject = message.trim();
    if subject.len() < 5 || subject.len() > 120 || subject.contains('\n') { return Err("Scrivi un messaggio commit di 5–120 caratteri, su una riga.".into()); }
    let mut add = vec!["add", "--"];
    add.extend(files.iter().map(String::as_str));
    git(&root, &add)?;
    let staged = git(&root, &["diff", "--cached", "--name-only"])?;
    let staged_paths: Vec<_> = staged.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
    if staged_paths.is_empty() || staged_paths.iter().any(|path| !files.iter().any(|selected| selected == path)) {
        return Err("Staging inatteso: controlla il diff Git prima di riprovare.".into());
    }
    git(&root, &["commit", "-m", subject])?;
    let commit = git(&root, &["rev-parse", "HEAD"])?;
    git(&root, &["push", "origin", "main"]).map_err(|error| format!("Commit locale {commit} creato, ma push non riuscito: {error}"))?;
    let (repo_url, site_url) = club_urls(&root)?;
    Ok(PublicationResult {
        commit_url: format!("{repo_url}/commit/{commit}"),
        actions_url: format!("{repo_url}/actions"),
        site_url,
        deploy_status: "Push riuscito; deploy GitHub Pages da verificare su Actions.".into(), commit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;
    #[test]
    fn stages_only_content_and_images() {
        assert!(publishable("site/data/games/2026-27/platinum.csv"));
        assert!(publishable("site/public/assets/new-photo.webp"));
        assert!(!publishable("site/app/page.tsx"));
        assert!(!publishable("studio/src/App.tsx"));
    }
    #[test]
    fn development_branch_can_preview_game_diff_but_cannot_push() {
        let temp = std::env::temp_dir().join(format!("webmaker-test-{}", Uuid::new_v4()));
        let folders = ["site/data/games/2026-27", "site/data/player-stats/2026-27", "site/data/players", "site/content/news", "site/scripts"];
        for folder in folders { fs::create_dir_all(temp.join(folder)).unwrap(); }
        let fixture: [(&str, &str); 7] = [
            ("site/data/competitions.yaml", "seasons:\n  - id: 2026-27\n    competitions:\n      - id: platinum\n"),
            ("site/data/teams.yaml", "nerone:\n  name: Nerone\nrivali:\n  name: Rivali\n"),
            ("site/data/players/giocatore.yaml", "id: giocatore\nname: Giocatore\n"),
            ("site/data/rosters.csv", "season,competition,team_id,player_id,number\n2026-27,platinum,nerone,giocatore,5\n"),
            ("site/data/games/2026-27/platinum.csv", "id,date,time,status,home_team,away_team,home_score,away_score\npartita-1,2026-10-21,21:00,final,nerone,rivali,51,48\n"),
            ("site/data/player-stats/2026-27/platinum.csv", "game_id,player_id,minutes,points\n"),
            ("site/content/news/prova.md", "---\ntitle: Prova\ndate: 2026-10-21\n---\nTesto\n"),
        ];
        for (path, content) in fixture { fs::write(temp.join(path), content).unwrap(); }
        fs::write(temp.join("site/scripts/build-data.mjs"), "// fixture").unwrap();
        let root = temp.canonicalize().unwrap();
        git(&root, &["init", "-b", "main"]).unwrap();
        git(&root, &["config", "user.name", "Studio Test"]).unwrap();
        git(&root, &["config", "user.email", "studio@example.test"]).unwrap();
        git(&root, &["remote", "add", "origin", "https://github.com/nerone-basket/nerone-basket.github.io.git"]).unwrap();
        git(&root, &["add", "--", "site"]).unwrap();
        git(&root, &["commit", "-m", "Fixture"]).unwrap();
        let head = git(&root, &["rev-parse", "HEAD"]).unwrap();
        git(&root, &["update-ref", "refs/remotes/origin/main", &head]).unwrap();
        git(&root, &["switch", "-c", "feat/test-studio"]).unwrap();
        fs::write(root.join("site/data/games/2026-27/platinum.csv"), "id,date,time,status,home_team,away_team,home_score,away_score\npartita-1,2026-10-21,21:00,final,nerone,rivali,52,48\n").unwrap();
        let preview = preview_for_root(&root, vec!["site/data/games/2026-27/platinum.csv".into()]).unwrap();
        assert!(!preview.can_publish);
        assert!(preview.errors.iter().any(|message| message.contains("branch")));
        assert!(preview.diff.contains("+partita-1,2026-10-21,21:00,final,nerone,rivali,52,48"));
        let temp_root = std::env::temp_dir().canonicalize().unwrap();
        let target: PathBuf = root.canonicalize().unwrap();
        assert!(target.starts_with(temp_root));
        fs::remove_dir_all(target).unwrap();
    }
}
