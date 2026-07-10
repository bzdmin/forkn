import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import { BaseProvider, RunCallbacks } from './base';

/**
 * Codex provider.
 *
 * Windows specifics:
 * 1. Prompt tokenization — shell:true re-splits args at spaces, so we build
 *    one fully-quoted command string.
 * 2. Quote safety — cmd.exe does NOT treat backslash as an escape, so `\"`
 *    still closes a quote and allows command injection via ` " & evil & " `.
 *    We neutralize by replacing double quotes with single quotes (cannot
 *    break out of the surrounding quotes).
 * 3. Sandbox — `--sandbox workspace-write` is broken on native Windows
 *    (OpenAI issues #10601 #15850 #25280); 'auto' uses bypass there.
 *
 * Output cleaning: `codex exec` wraps the answer in diagnostic noise
 * (timestamps, model-manager ERROR lines, workdir/model/session header,
 * prompt echo, token counts). The actual response follows a line that is
 * exactly `codex`. We stream only that; if the marker never appears
 * (e.g. hard failure), we fall back to the raw output so errors stay visible.
 */
export class CodexProvider extends BaseProvider {
  protected buildArgs(_prompt: string, _model: string): string[] {
    return [];
  }

  private getSandboxMode(): string {
    const configured = vscode.workspace
      .getConfiguration('forkn')
      .get<string>('providers.codex.sandboxMode', 'auto');
    if (configured && configured !== 'auto') { return configured; }
    return process.platform === 'win32' ? 'bypass' : 'workspace-write';
  }

  run(taskId: string, prompt: string, model: string, cwd: string, cb: RunCallbacks): void {
    const env = { ...process.env, ...this.buildEnv() };
    const sandboxMode = this.getSandboxMode();
    const sandboxArgs = sandboxMode === 'bypass'
      ? ['--dangerously-bypass-approvals-and-sandbox']
      : ['--sandbox', sandboxMode];

    let proc: ChildProcess;
    try {
      if (process.platform === 'win32') {
        // cmd.exe-safe: double quotes cannot be escaped reliably, so strip
        // them to single quotes. Everything else is literal inside quotes.
        // Strip newlines (injection: a raw \n ends the cmd.exe command) then
        // neutralize quotes (cmd.exe has no reliable quote escape).
        const safePrompt = prompt.replace(/\r?\n/g, ' ').replace(/"/g, "'");
        const cmd = [
          this.quoteBinary(this.binaryPath),
          'exec', '--model', model, '--skip-git-repo-check',
          ...sandboxArgs, '--', `"${safePrompt}"`,
        ].join(' ');
        proc = spawn(cmd, [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
      } else {
        proc = spawn(this.binaryPath, [
          'exec', '--model', model, '--skip-git-repo-check',
          ...sandboxArgs, '--', prompt,
        ], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      }
    } catch (err) {
      cb.onError(`Failed to spawn "${this.binaryPath}": ${err}`);
      return;
    }

    this.processes.set(taskId, proc);

    // --- Streaming line filter ---
    let raw = '';            // everything, for diagnostics
    let lineBuf = '';        // partial-line accumulator
    let inResponse = false;  // true once the `codex` marker line is seen
    let emittedAny = false;

    const handleLine = (line: string) => {
      const t = line.trim();
      if (!inResponse) {
        if (t === 'codex') { inResponse = true; }
        return;
      }
      // End of the answer block
      if (/^tokens used\b/i.test(t)) { inResponse = false; return; }
      cb.onData(line + '\n');
      emittedAny = true;
    };

    const onChunk = (c: Buffer) => {
      const s = c.toString();
      raw += s;
      lineBuf += s;
      let idx: number;
      while ((idx = lineBuf.indexOf('\n')) !== -1) {
        handleLine(lineBuf.slice(0, idx).replace(/\r$/, ''));
        lineBuf = lineBuf.slice(idx + 1);
      }
    };

    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);

    proc.on('error', (err) => {
      this.processes.delete(taskId);
      cb.onError(`Process error: ${err.message}`);
    });

    proc.on('close', (code) => {
      this.processes.delete(taskId);
      if (lineBuf) { handleLine(lineBuf); lineBuf = ''; }

      if (/sandbox.*(setup|helper|refresh).*fail|ShellExecuteExW|0xC0000142|exit code: 1385/i.test(raw)) {
        cb.onError(
          'Codex sandbox failed to start (a known Windows issue). ' +
          'Set "forkn.providers.codex.sandboxMode" to "bypass" in settings, or run Codex in WSL.',
        );
        return;
      }

      // If we never found the response marker, surface the raw output so
      // the user can see what actually happened.
      if (!emittedAny && raw.trim()) {
        cb.onData(raw);
      }

      if (code === 0 || code === null) {
        cb.onComplete();
      } else {
        cb.onError(`Process exited with code ${code} (${describeExitCode(code)})`);
      }
    });
  }

  private quoteBinary(bin: string): string {
    return bin.includes(' ') ? `"${bin}"` : bin;
  }
}

function describeExitCode(code: number): string {
  const map: Record<number, string> = {
    1: 'General error', 2: 'Invalid argument',
    126: 'Command not executable', 127: 'CLI not found',
    130: 'Interrupted (Ctrl+C)', 137: 'Killed',
  };
  return map[code] || 'Unknown error';
}
