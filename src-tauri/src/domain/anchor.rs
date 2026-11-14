use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// How sure the app is that an anchor still points at the intended passage (PRD §6.3).
/// Recommended values, not confirmed scope (decision 0002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnchorConfidence {
    Resolved,
    Ambiguous,
    Orphaned,
}

/// Derived helper, never the sole identity of a target. Units are fixed by decision 0005 after the F1 spike.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SourceRange {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Anchor {
    /// The exact selected passage, verbatim.
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
    pub heading_path: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_range: Option<SourceRange>,
    /// sha256 (hex) of the document version the anchor was made against.
    pub source_hash: String,
    pub confidence: AnchorConfidence,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confidence_uses_snake_case_and_rejects_unknown_values() {
        assert_eq!(
            serde_json::to_string(&AnchorConfidence::Ambiguous).unwrap(),
            "\"ambiguous\""
        );
        assert!(serde_json::from_str::<AnchorConfidence>("\"Resolved\"").is_err());
        assert!(serde_json::from_str::<AnchorConfidence>("\"certain\"").is_err());
    }

    #[test]
    fn anchor_round_trips_with_and_without_range() {
        let json = serde_json::json!({
            "exact": "The system must use an external identity broker.",
            "prefix": "Authentication should be straightforward.",
            "suffix": "",
            "heading_path": ["Architecture", "Authentication"],
            "source_hash": "abc",
            "confidence": "ambiguous"
        });
        let anchor: Anchor = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(anchor.source_range, None);
        assert_eq!(serde_json::to_value(&anchor).unwrap(), json);

        let with_range = Anchor {
            source_range: Some(SourceRange { start: 3, end: 9 }),
            ..anchor
        };
        let back: Anchor =
            serde_json::from_value(serde_json::to_value(&with_range).unwrap()).unwrap();
        assert_eq!(back, with_range);
    }

    #[test]
    fn anchor_without_exact_text_is_rejected() {
        let json = serde_json::json!({
            "prefix": "", "suffix": "", "heading_path": [], "source_hash": "x", "confidence": "resolved"
        });
        assert!(serde_json::from_value::<Anchor>(json).is_err());
    }
}
