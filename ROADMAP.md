# Forkn Roadmap

> One sidebar. Every AI agent. All at once.

This roadmap tracks what ships in each version. It is intentionally split so
visible user-facing improvements ship fast (v1.1) while heavier refactors,
security hardening, and accessibility work travel on their own track (v1.2+).

Priorities are guided by real usage data from telemetry (opt-in), not
guesswork. Items marked _(data-gated)_ are built only once the dashboard shows
they affect real users.

---

## Shipped

### 1.0.0 — Initial release (2026-07-06)
- Run Claude Code, Codex, Antigravity, and OpenCode in parallel from one sidebar
- Per-provider model selection, task queue, live output, re-run, templates
- Automatic model fallback, cost estimates, opt-in anonymous telemetry

### 1.0.1 (2026-07-08)
- Fixed template buttons (webviews block `window.prompt`; now uses native input box)
- Cancelled tasks show a red accent bar + CANCELLED badge
- Templates persist across reloads

### 1.0.2 (2026-07-09)
- Outcome-led marketplace description; changelog published

### 1.0.3 — Security & reliability (2026-07-10)
- Newlines stripped before shell quoting (multi-line prompt injection on Windows)
- Cancel now kills the underlying CLI on Windows, not just the shell wrapper
- Cancelling mid-fallback no longer restarts the task with the next model
- CLI binaries under spaced paths (e.g. Program Files) now detect
- Notifications show real icons instead of raw HTML codes
- Telemetry and header report the correct version
- Completion toast prices the model that actually ran

**Open verification (not a feature):**
- [ ] H2 — confirm Windows `taskkill /T /F` genuinely kills the orphan CLI on a
      real Windows box (code is in; needs live confirmation)

---

## v1.1 — UX & polish batch (next release)

Visible, user-facing improvements. The morale-and-adoption release.

- [ ] Enter key runs the task (currently Ctrl/Cmd+Enter only)
- [ ] Chat-style inline output view (augment/replace the "Open" button with a
      conversation-style view)
- [ ] Refresh button in the header, beside the ⚙ settings button
- [ ] Dynamic provider-model fetching — query each CLI for its model list
      instead of hardcoding. _Attempt with hardcoded fallback: not every CLI
      exposes a "list models" command, and the Codex×ChatGPT merger may change
      the `codex` surface._
- [ ] Persist task state across VS Code restarts (tasks currently live in memory only)
- [ ] UI redesign based on the Claude Design mockup _(dependency: mockup file)_
- [ ] Notifications settings toggle (pairs with toast-batching, below)
- [ ] Uninstall survey
- [ ] Richer stats line — e.g. "10 tasks · 5 completed · 2 running · 2 failed · 1 cancelled"
- [ ] Sticky prompt header in the Open/detail view so the prompt stays visible
      while scrolling long output
- [ ] Re-run asks whether to reuse the same model or pick a new one
- [ ] Distinct colors for Re-run / Template / Open buttons
- [ ] "No tasks yet" empty state using each agent's color dots (matching the demo GIF)
- [ ] Provider on/off toggles — hide agents a user doesn't use
- [ ] Batch/settingable completion toasts (spam at high parallelism) _(L3)_
- [ ] Codex duplicate-answer-block dedup _(L2)_

---

## v1.2 — Data, reliability & accessibility (heavier track)

Refactors and hardening. Most items are _(data-gated)_ — built once telemetry
confirms they affect real users.

- [ ] stderr/stdout stream tagging — stop Antigravity misclassifying its own
      answer text as an auth/error _(M1, data-gated)_
- [ ] Delta-based webview rendering + ~80ms throttle — stop full re-render on
      every output chunk _(M2, data-gated)_
- [ ] stdin prompt passing — eliminate the shell-string injection surface behind
      H1/L1 properly (proper fix for the newline band-aid). Needs per-CLI
      testing.
- [ ] Accessibility pass (screen-reader tested):
  - [ ] Tabs and template pills → real keyboard-operable controls _(A1)_
  - [ ] Detail view → focus-trapped dialog with Escape + focus restore _(A7)_
  - [ ] `:focus-visible` styles; remove `outline:none` _(A2)_
  - [ ] `aria-label` on icon-only buttons _(A3)_
  - [ ] `aria-live` region for task start/complete/fail _(A4)_
  - [ ] Contrast + minimum font-size fixes to meet WCAG 2.2 AA _(A5)_
  - [ ] `prefers-reduced-motion` support _(A6)_
- [ ] Exact token counting per task — real usage from each CLI where available,
      estimated where not (Codex prints "tokens used"; others vary). Feeds the
      spend dashboard.
- [ ] Spend dashboard — daily/weekly spend summary built on real token counts
      (from project brief v1.1)
- [ ] Template delete/rename _(M6)_
- [ ] Hot-swap provider binary when its path is edited in Settings UI _(M5)_
- [ ] Block submit + warn when no workspace folder is open _(M7)_
- [ ] Single-source the cost map (currently duplicated ×3); remove the
      fabricated "5 min saved" metric _(L7)_
- [ ] Validate `provider`/`model` from webview messages against known lists _(M6/defense-in-depth)_
- [ ] CSP nonce from `crypto.randomBytes` instead of `Math.random` _(L6)_

---

## v1.3 — File-change tracking (from project brief)

- [ ] Per-task view of files created / modified / deleted
- [ ] Clickable diffs for each change

---

## v2.0 — Smart orchestrator (traction-gated)

The vision milestone and the acquirable moat. Built on the dataset telemetry
produces: which provider wins which task type.

- [ ] Auto-routing — suggest or pick the best provider per task type
- [ ] Routing learned from aggregate task outcomes (quality/speed/cost per task category)

---

## Someday / maybe (aspirational — not committed)

Softer ideas from strategy discussions. Revisit if traction points here.

- [ ] Shareable comparison output ("Claude ✅ Codex ❌") as a one-click growth loop
- [ ] Cursor extension
- [ ] JetBrains plugin
- [ ] Standalone desktop app
- [ ] Terminal UI (TUI)
- [ ] "Agent" terminology migration (rename "providers" → "agents" in the UI)

---

_Roadmap maintained alongside the code. When a feature or fix is committed to a
specific version, it's recorded here._
