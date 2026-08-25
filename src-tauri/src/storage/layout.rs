use std::path::PathBuf;

use super::secure_dir::SecureDir;

#[derive(Clone, Debug)]
pub struct DataLayout {
    pub root: PathBuf,
    pub runtime: PathBuf,
    pub runtime_versions: PathBuf,
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
            runtime_versions: root.join("runtime").join("versions"),
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
        let root = SecureDir::open_private_root(&self.root)
            .map_err(|_| "create data root failed".to_string())?;
        let runtime = root
            .open_or_create_private_dir("runtime")
            .map_err(|_| "create runtime root failed".to_string())?;
        runtime
            .open_or_create_private_dir("versions")
            .map_err(|_| "create runtime versions failed".to_string())?;
        for name in ["assets", "projects", "rules", "cache", "staging", "logs"] {
            root.open_or_create_private_dir(name)
                .map_err(|_| format!("create {name} root failed"))?;
        }
        Ok(())
    }
}
