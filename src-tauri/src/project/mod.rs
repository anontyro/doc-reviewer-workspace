//! Projects: folders with a portable `.review-workspace/project.json`, and the library of recent ones (F3 spec D1 to D9).

pub mod library;
pub mod paths;
pub mod service;

pub use service::{DocumentEntry, LibraryItem, ProjectView, Projects};
