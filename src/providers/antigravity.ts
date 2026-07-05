import * as os from 'os';
import { BaseProvider, RunCallbacks } from './base';

/**
 * Antigravity CLI (agy) stores auth credentials in the user profile dir.
 * When VS Code spawns a subprocess, the environment can differ from the
 * user's interactive terminal — HOME/USERPROFILE might be unset or point
 * somewhere unexpected, causing agy to miss cached credentials and
 * re-prompt for auth.
 *
 * Fix: explicitly pass HOME, USERPROFILE, APPDATA, and XDG_CONFIG_HOME
 * using os.homedir() as the source of truth, so agy always finds its
 * credential store regardless of how VS Code was launched.
 *
 * If auth still fails (e.g. first run, token expired), we detect the
 * failure signature in agy's output and show a guidance message rather
 * than a raw CLI error.
 */
const AUTH_FAILURE_PATTERNS = [
  /you are (?:currently )?not signed[\s-]?in/i,
  /not authenticated/i,
  /please (?:sign|log)[\s-]?in/i,
  /authentication (?:failed|required|expired)/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /select login method/i,
  /no credentials found/i,
  // With NO_BROWSER set, agy prints an authorization URL instead of
  // opening a browser — treat that as "needs sign-in" too.
  /authorization url/i,
  /one[\s-]?time code/i,
  /visit the (?:url|link) .* to (?:sign|log)[\s-]?in/i,
  /could not (?:read|access) (?:keychain|credential)/i,
];

/** Patterns that indicate a real error even when exit code is 0 */
const ERROR_OUTPUT_PATTERNS = [
  /^error:/im,
  /network\s*(issue|error|failure)/i,
  /please try again/i,
  /timed?\s*out/i,
  /connection\s*(refused|reset|failed)/i,
  /could not connect/i,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /rate\s*limit/i,
  /quota\s*exceeded/i,
  /internal\s*server\s*error/i,
  /500\s/,
  /503\s/,
  /failed\s*to\s*(fetch|load|connect)/i,
];

const AUTH_GUIDANCE =
  'Antigravity needs sign-in. Run `agy` in a terminal to authenticate.';

export class AntigravityProvider extends BaseProvider {
  protected buildArgs(prompt: string, model: string): string[] {
    // --dangerously-skip-permissions: auto-approve so agy doesn't hang
    //   waiting for an approval prompt that can't render in a non-TTY.
    // --print/-p: run a single prompt non-interactively.
    // --print-timeout: bound how long print mode waits.
    return [
      '--model', model,
      '--dangerously-skip-permissions',
      '--print-timeout', '5m',
      '-p', prompt,
    ];
  }

  /**
   * Ensure HOME, USERPROFILE, APPDATA, and XDG paths are always set
   * so agy can find its credential store.
   */
  protected buildEnv(): Record<string, string> {
    const home = os.homedir();
    const env: Record<string, string> = {};

    // Always set HOME (Unix convention, some CLIs check it on Windows too)
    if (!process.env.HOME) { env.HOME = home; }

    // Windows-specific profile paths
    if (process.platform === 'win32') {
      if (!process.env.USERPROFILE) { env.USERPROFILE = home; }
      if (!process.env.APPDATA) {
        env.APPDATA = `${home}\\AppData\\Roaming`;
      }
      if (!process.env.LOCALAPPDATA) {
        env.LOCALAPPDATA = `${home}\\AppData\\Local`;
      }
    }

    // XDG config (Linux/Mac, some tools respect it on Windows too)
    if (!process.env.XDG_CONFIG_HOME) {
      env.XDG_CONFIG_HOME = process.platform === 'win32'
        ? `${home}\\AppData\\Local`
        : `${home}/.config`;
    }

    // Encourage agy to emit clean, parseable output in our non-TTY pipe.
    // NO_COLOR strips ANSI escapes; a TERM value helps some CLIs render
    // plainly rather than disabling output entirely.
    env.NO_COLOR = '1';
    if (!process.env.TERM) { env.TERM = 'xterm-256color'; }

    // Never let agy open a browser from Forkn's headless subprocess. When
    // agy can't read its keychain token (a known headless limitation of its
    // credential storage), it tries to launch OAuth in the browser. These
    // hints (inherited from gemini-cli conventions) force it to print the
    // auth URL to stdout instead, which our auth detection turns into a
    // clear sign-in message rather than a surprise Chrome tab.
    env.NO_BROWSER = 'true';
    env.BROWSER = 'none';

    return env;
  }

  run(
    taskId: string,
    prompt: string,
    model: string,
    cwd: string,
    cb: RunCallbacks,
  ): void {
    let buffered = '';
    let authIssueDetected = false;

    const finish = (kind: 'complete' | 'error', errMsg?: string) => {
      if (authIssueDetected) { cb.onError(AUTH_GUIDANCE); return; }
      if (ERROR_OUTPUT_PATTERNS.some((re) => re.test(buffered))) {
        cb.onError('Antigravity reported an error (see output above)');
        return;
      }
      if (kind === 'error' && errMsg) { cb.onError(errMsg); return; }
      if (buffered.trim().length === 0) {
        // agy completed a full round trip (exit 0) but emitted nothing on
        // stdout. This is Antigravity bug #76: --print silently drops output
        // under a non-TTY. The task almost certainly SUCCEEDED — any file
        // changes were made — only the text response was lost. So we report
        // this as a soft/beta notice, not a scary failure.
        cb.onError(
          'BETA_NONTTY: Antigravity ran this task, but its CLI drops the ' +
          'response text when run outside a terminal (known agy bug #76), ' +
          'so Forkn can\'t show what it did. If this task edited files, ' +
          'check them (e.g. git diff) to confirm. For full responses, run ' +
          'the prompt with `agy` in a terminal until Google ships a fix.',
        );
        return;
      }
      cb.onComplete();
    };

    const onChunk = (data: string) => {
      buffered += data;
      if (!authIssueDetected && AUTH_FAILURE_PATTERNS.some((re) => re.test(buffered))) {
        authIssueDetected = true;
      }
      cb.onData(data);
    };

    // Plain piped subprocess only. A pseudo-terminal was tried here and
    // REMOVED on purpose: under a pty, agy believes it's interactive and
    // launches its browser sign-in flow (Chrome popups), and per agy issue
    // #76 a pty doesn't recover the dropped output on Windows anyway.
    // Do not reintroduce a pty for agy.
    const wrappedCb: RunCallbacks = {
      onData: onChunk,
      onComplete: () => finish('complete'),
      onError: (err: string) => {
        if (authIssueDetected || AUTH_FAILURE_PATTERNS.some((re) => re.test(err))) {
          cb.onError(AUTH_GUIDANCE);
        } else {
          finish('error', err);
        }
      },
    };
    super.run(taskId, prompt, model, cwd, wrappedCb);
  }
}


