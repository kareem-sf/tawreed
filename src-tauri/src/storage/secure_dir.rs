use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use uuid::Uuid;

pub(crate) struct SecureDir {
    inner: Dir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileIdentity {
    volume: u64,
    file: u64,
}

impl SecureDir {
    pub(crate) fn open_root(path: &Path) -> std::io::Result<Self> {
        let parent = path.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "root parent missing")
        })?;
        let name = path.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "root name missing")
        })?;
        let parent = Dir::open_ambient_dir(parent, cap_std::ambient_authority())?;
        match parent.open_dir_nofollow(name) {
            Ok(inner) => Ok(Self { inner }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match parent.create_dir(name) {
                    Ok(()) => {}
                    Err(create_error)
                        if create_error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(create_error) => return Err(create_error),
                }
                Ok(Self {
                    inner: parent.open_dir_nofollow(name)?,
                })
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn open_private_root(path: &Path) -> std::io::Result<Self> {
        let directory = Self::open_root(path)?;
        directory.restrict_private_directory()?;
        Ok(directory)
    }

    pub(crate) fn open_dir(&self, name: &str) -> std::io::Result<Self> {
        Ok(Self {
            inner: self.inner.open_dir_nofollow(name)?,
        })
    }

    pub(crate) fn open_private_dir(&self, name: &str) -> std::io::Result<Self> {
        let directory = self.open_dir(name)?;
        directory.restrict_private_directory()?;
        Ok(directory)
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

    pub(crate) fn open_or_create_private_dir(&self, name: &str) -> std::io::Result<Self> {
        let directory = self.open_or_create_dir(name)?;
        directory.restrict_private_directory()?;
        Ok(directory)
    }

    pub(crate) fn try_clone(&self) -> std::io::Result<Self> {
        Ok(Self {
            inner: self.inner.try_clone()?,
        })
    }

    pub(crate) fn identity(&self) -> std::io::Result<FileIdentity> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;

            let metadata = self.inner.try_clone()?.into_std_file().metadata()?;
            return Ok(FileIdentity {
                volume: metadata.dev(),
                file: metadata.ino(),
            });
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };

            let mut information = BY_HANDLE_FILE_INFORMATION::default();
            let read = unsafe {
                GetFileInformationByHandle(
                    self.inner.as_raw_handle().cast(),
                    std::ptr::from_mut(&mut information),
                )
            };
            if read == 0 {
                return Err(std::io::Error::last_os_error());
            }
            return Ok(FileIdentity {
                volume: information.dwVolumeSerialNumber as u64,
                file: ((information.nFileIndexHigh as u64) << 32)
                    | information.nFileIndexLow as u64,
            });
        }
        #[allow(unreachable_code)]
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "filesystem identity unsupported",
        ))
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

    pub(crate) fn read_bytes_limited(&self, name: &str, maximum: u64) -> std::io::Result<Vec<u8>> {
        let file = self.open_private_read(name)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() > maximum {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "bounded private file is invalid",
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(maximum + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > maximum {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "bounded private file is too large",
            ));
        }
        Ok(bytes)
    }

    pub(crate) fn open_private_read(&self, name: &str) -> std::io::Result<cap_std::fs::File> {
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

            options.share_mode(FILE_SHARE_READ);
        }
        let file = self.inner.open_with(name, &options)?;
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a regular private file",
            ));
        }
        Ok(file)
    }

    pub(crate) fn open_or_create_private_rw(
        &self,
        name: &str,
    ) -> std::io::Result<cap_std::fs::File> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .follow(FollowSymlinks::No);
        configure_private_file_options(&mut options, 0o600);
        let file = self.inner.open_with(name, &options)?;
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a regular private file",
            ));
        }
        restrict_private_file(&file, 0o600)?;
        Ok(file)
    }

    pub(crate) fn open_or_create_lock_file(
        &self,
        name: &str,
    ) -> std::io::Result<cap_std::fs::File> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .follow(FollowSymlinks::No);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;

            options.mode(0o600);
        }
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

            options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
        }
        let file = self.inner.open_with(name, &options)?;
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a regular lock file",
            ));
        }
        restrict_private_file(&file, 0o600)?;
        Ok(file)
    }

    pub(crate) fn create_private_file(
        &self,
        name: &str,
        executable: bool,
    ) -> std::io::Result<cap_std::fs::File> {
        let mode = if executable { 0o700 } else { 0o600 };
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        configure_private_file_options(&mut options, mode);
        let file = self.inner.open_with(name, &options)?;
        restrict_private_file(&file, mode)?;
        Ok(file)
    }

    pub(crate) fn remove_file_or_symlink(&self, name: &str) -> std::io::Result<()> {
        self.inner.remove_file_or_symlink(name)
    }

    pub(crate) fn remove_dir_all(&self, name: &str) -> std::io::Result<()> {
        self.inner.remove_dir_all(name)
    }

    pub(crate) fn rename_to(
        &self,
        from: &str,
        destination: &SecureDir,
        to: &str,
    ) -> std::io::Result<()> {
        self.inner.rename(from, &destination.inner, to)
    }

    pub(crate) fn symlink_metadata(&self, name: &str) -> std::io::Result<cap_std::fs::Metadata> {
        self.inner.symlink_metadata(name)
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
            configure_private_file_options(&mut options, 0o600);
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

    fn restrict_private_directory(&self) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            use cap_std::fs::PermissionsExt;

            self.inner
                .set_permissions(".", cap_std::fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }
}

fn configure_private_file_options(options: &mut OpenOptions, mode: u32) {
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;

        options.mode(mode);
    }
    #[cfg(windows)]
    {
        use cap_std::fs::OpenOptionsExt;

        let _ = mode;
        options.share_mode(0);
    }
}

fn restrict_private_file(file: &cap_std::fs::File, mode: u32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use cap_std::fs::PermissionsExt;

        file.set_permissions(cap_std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (file, mode);
    Ok(())
}
