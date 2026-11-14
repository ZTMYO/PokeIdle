use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};
use walkdir::WalkDir;

// Both architecture slices serve the same files from the signed app bundle.
pub struct GameAssets {
    root: PathBuf,
}

impl GameAssets {
    pub fn new() -> Self {
        let executable = std::env::current_exe().expect("unable to locate the running app");
        let root = executable
            .parent()
            .expect("missing executable directory")
            .join("../Resources/game")
            .canonicalize()
            .expect("missing bundled game resources");
        Self { root }
    }

    fn read_file(&self, path: &Path) -> Option<Vec<u8>> {
        let path = path.canonicalize().ok()?;
        if !path.starts_with(&self.root) || !path.is_file() {
            return None;
        }
        fs::read(path).ok()
    }
}

impl<R: Runtime> Assets<R> for GameAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let relative = key.as_ref().strip_prefix('/')?;
        self.read_file(&self.root.join(relative)).map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        let files = WalkDir::new(&self.root).into_iter().filter_map(move |result| {
            let entry = result.ok()?;
            if !entry.file_type().is_file() {
                return None;
            }
            let key = entry.path().strip_prefix(&self.root).ok()?.to_str()?;
            let data = self.read_file(entry.path())?;
            Some((Cow::Owned(format!("/{key}")), Cow::Owned(data)))
        });
        Box::new(files)
    }

    fn csp_hashes(&self, _html: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        // The game doesn't configure a CSP in tauri.conf.json.
        Box::new(std::iter::empty())
    }
}
