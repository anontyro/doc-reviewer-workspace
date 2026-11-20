//! Annotation storage: one atomically written JSON file per document (F2 spec D15 to D20).

pub mod annotations;
pub mod atomic;

pub use annotations::{AnnotationView, Store};
