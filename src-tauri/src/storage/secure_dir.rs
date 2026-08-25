use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use uuid::Uuid;

pub(crate) struct SecureDir {
    inner: Dir,
}

impl SecureDir {
    pub(crate) fn open_root(path: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(path)?;
        let parent = path.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "root parent missing")
        })?;
        let name = path.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "root name missing")
        })?;
        let parent = Dir::open_ambient_dir(parent, cap_std::ambient_authority())?;
        Ok(Self {
            inner: parent.open_dir_nofollow(name)?,
        })
    }

    pub(crate) fn open_dir(&self, name: &str) -> std::io::Result<Self> {
        Ok(Self {
            inner: self.inner.open_dir_nofollow(name)?,
        })
    }

    pub(crate) fn open_or_create_dir(&self, name: &str) -> std::io::Result<Self> {
        match self.open_dir(name) {
            Ok(directory) => Ok(directory),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match self.inner.create_dir(name) {
                    Ok(()) => {}
                    Err(create_error)
                        if create_error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(create_error) => return Err(create_error),
                }
                self.open_dir(name)
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn create_dir(&self, name: &str) -> std::io::Result<()> {
        self.inner.create_dir(name)
    }

    pub(crate) fn entries(&self) -> std::io::Result<Vec<OsString>> {
        self.inner
            .read_dir(".")?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect()
    }

    pub(crate) fn read_bytes(&self, name: &str) -> std::io::Result<Vec<u8>> {
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let mut file = self.inner.open_with(name, &options)?;
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a regular file",
            ));
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    pub(crate) fn atomic_write_json<T: serde::Serialize>(
        &self,
        name: &str,
        value: &T,
    ) -> Result<(), String> {
        let mut bytes =
            serde_json::to_vec_pretty(value).map_err(|_| "serialize json".to_string())?;
        bytes.push(b'\n');

        for _ in 0..8 {
            let temporary_name = format!(".{name}.{}.tmp", Uuid::new_v4());
            let mut options = OpenOptions::new();
            options
                .write(true)
                .create_new(true)
                .follow(FollowSymlinks::No);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;

                options.mode(0o600);
            }
            let mut file = match self.inner.open_with(&temporary_name, &options) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("create temporary json".into()),
            };
            let write_result = file
                .write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "write temporary json".to_string());
            drop(file);
            if let Err(error) = write_result {
                let _ = self.inner.remove_file_or_symlink(&temporary_name);
                return Err(error);
            }
            if self
                .inner
                .rename(&temporary_name, &self.inner, name)
                .is_err()
            {
                let _ = self.inner.remove_file_or_symlink(&temporary_name);
                return Err("replace json".into());
            }
            return Ok(());
        }

        Err("temporary json collision".into())
    }
}
