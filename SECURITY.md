# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Forkn, please report it responsibly:

- **Email:** security@forkn.dev
- **GitHub:** Open a private security advisory at https://github.com/bzdmin/forkn/security/advisories

Please do not open public issues for security vulnerabilities.

We aim to acknowledge reports within 48 hours and provide a fix timeline within one week.

## Scope

Forkn is a local VS Code extension that orchestrates AI coding CLIs installed on your machine. It has no backend server and makes no network requests of its own.

### What Forkn does
- Spawns local CLI binaries (`claude`, `codex`, `agy`, `opencode`) as child processes
- Passes your typed prompt to the selected CLI
- Displays the CLI's stdout/stderr in the sidebar
- Stores CLI binary paths in your VS Code `settings.json`

### What Forkn does NOT do
- Send your code, prompts, or outputs to Forkn servers (prompts go only to the AI provider you selected)
- Collect any telemetry without explicit opt-in consent (off by default; see README "Privacy" for exactly what opt-in telemetry includes)
- Collect prompt or code content in telemetry unless the separate `sharePromptsInErrorReports` setting is enabled (also off by default, error reports only)
- Store credentials or API keys (those are managed by the individual CLIs)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |

## Best Practices

- Forkn runs CLIs with the permissions of your user account. Only run prompts you trust.
- Codex runs with `--sandbox workspace-write`, limiting file writes to the workspace.
- Review AI-generated changes before committing them.
