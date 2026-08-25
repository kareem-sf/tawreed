use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct DataLayout {
    pub root: PathBuf,
    pub runtime: PathBuf,
    pub assets: PathBuf,
    pub projects: PathBuf,
    pub rules: PathBuf,
    pub cache: PathBuf,
    pub staging: PathBuf,
    pub logs: PathBuf,
    pub settings: PathBuf,
    pub connections: PathBuf,
}

impl DataLayout {
    pub fn discover() -> Result<Self, String> {
        let home = dirs::home_dir().ok_or("home_directory_unavailable")?;
        Ok(Self::from_root(home.join(".tawreed")))
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self {
            runtime: root.join("runtime"),
            assets: root.join("assets"),
            projects: root.join("projects"),
            rules: root.join("rules"),
            cache: root.join("cache"),
            staging: root.join("staging"),
            logs: root.join("logs"),
            settings: root.join("settings.json"),
            connections: root.join("connections.json"),
            root,
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        for path in [
            &self.root,
            &self.runtime,
            &self.assets,
            &self.projects,
            &self.rules,
            &self.cache,
            &self.staging,
            &self.logs,
        ] {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("create {}: {error}", path.display()))?;
        }
        Ok(())
    }
}
