// Cross-process generation lock: ACTIVE_GENERATIONS in revisions.rs is per-process
// only, so two app instances (or a future watch-folder daemon beside the app) must
// not reserve the same `Rev NN`. The lockfile lives next to the reservations it
// guards and is released on every publish/discard exit path.
use crate::store;

/// A lock is stale when its holder cannot plausibly still be generating —
// a crashed process never releases it, so age is the only signal.
fn lock_is_stale(age: std::time::Duration) -> bool {
    age.as_secs() > 2 * 60 * 60
}

fn lock_path(project_dir: &std::path::Path) -> std::path::PathBuf {
    project_dir.join(".tawreed-generation.lock")
}

pub(super) fn acquire_file_lock(
    project_dir: &std::path::Path,
    session: &str,
) -> Result<(), String> {
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path(project_dir))
    {
        Ok(mut file) => {
            use std::io::Write;
            let _ = writeln!(file, "{session}");
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let stale = std::fs::metadata(lock_path(project_dir))
                .and_then(|meta| meta.modified())
                .and_then(|modified| {
                    modified
                        .elapsed()
                        .map_err(|_| std::io::Error::other("clock"))
                })
                .map(lock_is_stale)
                .unwrap_or(false);
            if !stale {
                return Err("A generation is already running for this project — wait for it to finish or discard it".into());
            }
            store::log_line("removing stale generation lock from a previous run");
            let _ = std::fs::remove_file(lock_path(project_dir));
            acquire_file_lock(project_dir, session)
        }
        Err(error) => Err(format!("acquire generation lock: {error}")),
    }
}

pub(super) fn release_file_lock(project_dir: &std::path::Path) {
    let _ = std::fs::remove_file(lock_path(project_dir));
}

#[cfg(test)]
mod tests {
    use super::lock_is_stale;

    #[test]
    fn generation_locks_go_stale_after_two_hours() {
        assert!(!lock_is_stale(std::time::Duration::from_secs(60 * 60)));
        assert!(lock_is_stale(std::time::Duration::from_secs(
            2 * 60 * 60 + 1
        )));
    }
}
