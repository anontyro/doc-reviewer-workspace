/// Version of every persisted file shape. Independent of the app version (PRD §13.2).
pub const CURRENT_SCHEMA_VERSION: &str = "1.0.0";
const SUPPORTED_MAJOR: u64 = 1;

#[derive(Debug, PartialEq, Eq)]
pub enum SchemaVersionError {
    /// Not `MAJOR.MINOR.PATCH` with plain digits.
    Malformed(String),
    /// Written by a newer app; refuse rather than misread it.
    TooNew { found: String },
    /// Older than any supported shape; needs an explicit, backed-up migration.
    TooOld { found: String },
}

/// Accepts any `1.x.y`. There is no migration yet; when one is added it must back up first (decision 0003).
pub fn check_schema_version(version: &str) -> Result<(), SchemaVersionError> {
    let malformed = || SchemaVersionError::Malformed(version.to_string());
    let mut parts = version.split('.');
    let mut next = || -> Result<u64, SchemaVersionError> {
        let p = parts.next().ok_or_else(malformed)?;
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return Err(malformed());
        }
        p.parse().map_err(|_| malformed())
    };
    let major = next()?;
    next()?;
    next()?;
    if parts.next().is_some() {
        return Err(malformed());
    }
    match major {
        SUPPORTED_MAJOR => Ok(()),
        m if m > SUPPORTED_MAJOR => Err(SchemaVersionError::TooNew {
            found: version.into(),
        }),
        _ => Err(SchemaVersionError::TooOld {
            found: version.into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_current_and_later_minor_and_patch() {
        for v in [CURRENT_SCHEMA_VERSION, "1.0.0", "1.4.2", "1.10.30"] {
            assert_eq!(check_schema_version(v), Ok(()), "{v}");
        }
    }

    #[test]
    fn distinguishes_newer_older_and_malformed() {
        assert_eq!(
            check_schema_version("2.0.0"),
            Err(SchemaVersionError::TooNew {
                found: "2.0.0".into()
            })
        );
        assert_eq!(
            check_schema_version("0.9.0"),
            Err(SchemaVersionError::TooOld {
                found: "0.9.0".into()
            })
        );
        for v in [
            "abc",
            "",
            "1",
            "1.0",
            "1.0.0.0",
            "1.0.x",
            "1.-1.0",
            "v1.0.0",
            "1.0.0-beta",
            " 1.0.0",
        ] {
            assert_eq!(
                check_schema_version(v),
                Err(SchemaVersionError::Malformed(v.into())),
                "{v:?}"
            );
        }
    }
}
