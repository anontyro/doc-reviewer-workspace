# 0003 · Rust holds one active document and re-reads it on every activation, while tabs live in the web

**Status:** Agreed · **Release:** R2 · **Written by:** P4 · **Spec:** D13 to D16

## Rule

The web keeps the list of open tabs. Rust keeps exactly one active document, and every time a tab or explorer entry is
activated the web calls `open_project_document`, which reads the file from disk again. Comments are loaded from Rust each
time, so they always belong to the document on screen.

## Why

- Rust owns the files and the comment stores, so it is the only place that can say what a file contains now. A tab
  that cached its text could show an old version after the file changed outside the app.
- One active document keeps every F2 command (`list_annotations`, `create_annotation`, `generate_feedback`) unchanged: they
  work on whatever is active, and the web never sends a document id.
- The cost is that switching tabs re-reads and re-renders the file. For files of at most 10 MiB that is acceptable for
  the alpha.

## What the code does

- `Workspace` holds the open tabs (`useTabs`), the current document, and an activation counter. The reader is keyed on
  the counter, so each activation starts with fresh selection and comment state, even for the same file.
- Activations are numbered. If an earlier click's answer arrives after a later click, it is dropped, so the screen always
  shows the last document the user asked for.
- A document that fails to open shows the error and adds no tab. Closing the active tab activates its right neighbour,
  else its left, else shows the empty state. Closing a background tab calls nothing.
- `Reader` takes the document as a prop and has no Open button. In a workspace it draws the comment and export panels
  into the right sidebar element with a portal, so they keep their state when the sidebar is collapsed. Collapsing hides
  the sidebars and never unmounts the document, so its scroll position stays.
- Quick Open shows the same workspace for one file, with no explorer or tabs and a "Not in a project" label. Its comments
  stay in app data (decision 0001).
- `Cmd+\` toggles the explorer and `Cmd+Shift+\` the right sidebar. Collapsed state lives in React state only.
- The explorer hides names that start with `.`, so temp files never show.
- Tabs follow the manual-activation pattern: arrow keys move focus, Enter or Space opens the focused tab, and only the
  selected tab is in the tab order.

## Differences from the spec

- Quick Open is chosen on the home screen, which opens the file dialog itself, so the F2 Open button is gone from the
  reader and from the workspace.
- Reader tests that covered the Open button (cancel, refused file) moved to the home screen tests.
