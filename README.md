# Forkn

> One sidebar. Every AI agent. All at once.

**Use the best AI for every task, not the same AI for every task.**

![Forkn demo](media/forkn-demo.gif)

**Stop switching between AI agents.** Run Claude Code, Codex CLI, Antigravity CLI, and OpenCode together from one VS Code sidebar. Compare approaches, keep moving, and stop waiting on a single model.

Forkn is a neutral orchestration layer for AI coding agents. It works with the tools you already use instead of locking you into one ecosystem.

## Why Forkn?

Modern developers rarely use just one AI.

Claude might be better at planning a large refactor. Codex might write better tests. OpenCode might be the fastest option for quick iterations.

Today, using multiple agents usually means juggling terminal windows, remembering different commands, and waiting for one model before trying another.

Forkn keeps every AI coding agent in one place so you can stay inside VS Code and focus on shipping instead of switching.

## Features

![Forkn sidebar](media/forkn-sidebar-v3-2x.png)

- **Run multiple agents simultaneously.** Queue multiple AI tasks and execute them in parallel.
- **Multiple providers.** Claude Code, Codex CLI, Antigravity CLI, and OpenCode.
- **Choose the exact model.** Pick the model for each provider, including Sonnet, Opus, o4-mini, and more.
- **Watch every task live.** Stream terminal output from every running task directly inside Forkn.
- **Auto detection.** Forkn detects installed AI CLIs automatically and enables them without configuration.
- **Re-run instantly.** Launch any completed task again with a single click.
- **Templates.** Start common workflows such as morning checks, test runs, and PR reviews with one click.

![Completed task](media/forkn-completed-card-2x.png)

## Why developers use Forkn

| **Without Forkn** | **With Forkn** |
|-------------------|----------------|
| Multiple terminal windows | One VS Code sidebar |
| Constant context switching | One consistent workflow |
| Sequential AI execution | Parallel AI execution |
| Different commands for each provider | One interface for every provider |
| Manual output comparison | Results organized in one place |

## Usage

1. Open the Forkn sidebar from the VS Code Activity Bar.
2. Describe the task you want an AI agent to perform.
3. Select a provider such as Claude, Codex, Antigravity, or OpenCode.
4. Choose the model you want to use.
5. Click **Run** or press `Ctrl+Enter`.
6. Queue additional tasks. They execute in parallel automatically.

## Prerequisites

Install at least one supported AI CLI.

### Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

### Codex CLI

```bash
npm install -g @openai/codex
```

### Antigravity CLI

See Google's installation guide.

### OpenCode

```bash
npm install -g opencode
```

No accounts are required.

No API keys are managed by Forkn.

**Forkn lets you run the AI CLIs you've already installed from one interface.**

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `forkn.maxParallelTasks` | `3` | Maximum number of concurrent tasks |
| `forkn.providers.claudeCode.path` | `claude` | Path to the Claude Code binary |
| `forkn.providers.codex.path` | `codex` | Path to the Codex CLI binary |
| `forkn.providers.antigravity.path` | `agy` | Path to the Antigravity CLI binary |
| `forkn.providers.opencode.path` | `opencode` | Path to the OpenCode binary |

## Privacy

Forkn runs entirely on your machine.

It launches the AI CLI tools you already have installed and displays their output inside VS Code.

Your prompts and code go directly to the AI provider you choose. They never pass through Forkn because Forkn has no servers.

### Telemetry

Telemetry is **optional** and **disabled by default**.

On first launch, Forkn asks whether you would like to share anonymous usage data to help improve the extension. If you decline, nothing is sent.

If enabled, Forkn collects:

- Task events such as provider, model, prompt length, duration, output size, and success or failure.
- Error events including provider, model, error type, and sanitized error messages with file paths removed.
- Feature usage events such as `template_created` and `task_queued`.
- Startup information including operating system, RAM size, and CPU core count.

Forkn never collects:

- Prompt text
- Source code
- File contents
- File names
- Keystrokes
- Personally identifiable information

The anonymous identifier used is VS Code's built-in machine identifier.

### Sharing prompts in error reports

This is a separate opt-in setting and is disabled by default.

If you enable `forkn.telemetry.sharePromptsInErrorReports`, prompt text and task output are attached only to failed task reports to help debug provider failures.

If you leave this setting disabled, no prompt or code content is ever collected.

### Opting out

You can disable telemetry at any time by setting:

```json
"forkn.telemetry.enabled": false
```

Forkn also respects VS Code's global telemetry setting (`telemetry.telemetryLevel`).

## License

MIT