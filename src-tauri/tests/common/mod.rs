use std::{fs, path::PathBuf};

/// A fresh empty folder under the system temp dir, removed on drop.
pub struct Temp(pub PathBuf);

impl Temp {
    pub fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("llmrw-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.0.join(name);
        fs::write(&p, bytes).unwrap();
        p
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
