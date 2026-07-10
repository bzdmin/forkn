# Changelog

## 1.0.3 - 2026-07-10
- Fixed: multi-line prompts could break the command line on Windows (newlines now stripped before shell quoting)
- Fixed: Cancel now stops the underlying CLI on Windows instead of just the shell wrapper (no more token burn after cancel)
- Fixed: cancelling a task mid-fallback no longer restarts it with the next model
- Fixed: CLI binaries installed under paths with spaces (e.g. Program Files) now detect correctly
- Fixed: notifications showed raw HTML codes instead of check/cross icons
- Fixed: telemetry and the sidebar header now report the correct version
- Cost shown in the completion toast now matches the model that actually ran

## 1.0.2 - 2026-07-09
- Improved marketplace description

## 1.0.1 - 2026-07-08
- Fixed: Template buttons did nothing (VS Code webviews block window.prompt; input now uses the native input box)
- Fixed: Cancelled tasks showed a green accent bar - now red with a CANCELLED badge
- Templates now persist across reloads

## 1.0.0 - 2026-07-06
- Initial release: run Claude Code, Codex, Antigravity, and OpenCode in parallel from one sidebar
