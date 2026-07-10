import { ChildProcess, spawn } from 'child_process';

export interface RunCallbacks {
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (err: string) => void;
}

export abstract class BaseProvider {
  protected processes: Map<string, ChildProcess> = new Map();

  constructor(protected binaryPath: string) {}

  protected abstract buildArgs(prompt: string, model: string): string[];

  protected buildEnv(): Record<string, string> {
    return {};
  }

  run(taskId: string, prompt: string, model: string, cwd: string, cb: RunCallbacks): void {
    const args = this.buildArgs(prompt, model);
    const env = { ...process.env, ...this.buildEnv() };
    const isWin = process.platform === 'win32';

    let proc: ChildProcess;
    try {
      if (isWin) {
        // shell:true on Windows does NOT quote args — spaces re-tokenize and
        // metacharacters (& | < > ^) inject into cmd.exe. Build one safely
        // quoted command string. cmd.exe has no reliable quote escape
        // (backslash is not an escape), so embedded double quotes are
        // converted to single quotes to prevent quote breakout.
        const cmd = [this.winQuote(this.binaryPath), ...args.map((a) => this.winQuote(a))].join(' ');
        proc = spawn(cmd, [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
      } else {
        proc = spawn(this.binaryPath, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });
      }
    } catch (err) {
      cb.onError(`Failed to spawn "${this.binaryPath}": ${err}`);
      return;
    }

    this.processes.set(taskId, proc);

    proc.stdout?.on('data', (chunk: Buffer) => {
      cb.onData(stripAnsi(chunk.toString()));
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      cb.onData(stripAnsi(chunk.toString()));
    });

    proc.on('error', (err) => {
      this.processes.delete(taskId);
      cb.onError(`Process error: ${err.message}`);
    });

    proc.on('close', (code) => {
      this.processes.delete(taskId);
      if (code === 0 || code === null) {
        cb.onComplete();
      } else {
        cb.onError(`Process exited with code ${code} (${describeExitCode(code)})`);
      }
    });
  }

  /** Quote one argument for cmd.exe; neutralizes quote-breakout injection. */
  protected winQuote(arg: string): string {
    if (arg === '') { return '""'; }
    // Collapse newlines FIRST: a raw \n in the single cmd.exe command string
    // terminates the command and lets the rest parse as a new shell command
    // (injection via multi-line prompts / shared templates).
    const flat = arg.replace(/\r?\n/g, ' ');
    // No unsafe characters — pass through bare.
    if (!/[\s&|<>^%"']/.test(flat)) { return flat; }
    // cmd.exe cannot escape a double quote safely; convert to single quotes.
    return `"${flat.replace(/"/g, "'")}"`;
  }

  kill(taskId: string): void {
    const proc = this.processes.get(taskId);
    if (!proc) { return; }
    this.processes.delete(taskId);

    if (process.platform === 'win32') {
      // With shell:true, `proc` is the cmd.exe wrapper; the real CLI is a
      // grandchild. SIGTERM to the wrapper leaves the CLI running (and
      // burning tokens). taskkill /T kills the whole tree, /F forces it.
      if (proc.pid) {
        try {
          spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } catch {
          proc.kill('SIGKILL');
        }
      }
      return;
    }

    // POSIX: graceful then forceful.
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) { proc.kill('SIGKILL'); }
    }, 5000);
  }

  /** Pause a running process (SIGSTOP). No-op on Windows. */
  pause(taskId: string): boolean {
    const proc = this.processes.get(taskId);
    if (proc && process.platform !== 'win32') {
      try { proc.kill('SIGSTOP'); return true; } catch { return false; }
    }
    return false;
  }

  /** Resume a paused process (SIGCONT). No-op on Windows. */
  resume(taskId: string): boolean {
    const proc = this.processes.get(taskId);
    if (proc && process.platform !== 'win32') {
      try { proc.kill('SIGCONT'); return true; } catch { return false; }
    }
    return false;
  }
}

/** Map common process exit codes to plain-English reasons for the UI. */
function describeExitCode(code: number | null): string {
  if (code === null) { return 'Killed by signal'; }
  const map: Record<number, string> = {
    1: 'General error',
    2: 'Invalid argument',
    126: 'Command not executable',
    127: 'CLI not found',
    128: 'Invalid exit argument',
    130: 'Interrupted (Ctrl+C)',
    137: 'Killed — out of memory',
    139: 'Segmentation fault',
    143: 'Terminated',
  };
  return map[code] || 'Unknown error';
}

/** Strip ANSI escape sequences (colors, cursor moves) from CLI output. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\uFFFD\[[0-9;]*m/g, '');
}
