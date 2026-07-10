import * as https from 'https';
import * as os from 'os';
import * as vscode from 'vscode';

/**
 * Opt-in anonymous telemetry via PostHog.
 *
 * Gating — an event is sent ONLY when ALL of these are true:
 *   1. VS Code's global telemetry is enabled (vscode.env.isTelemetryEnabled)
 *   2. The user clicked "Allow" on Forkn's first-run consent prompt
 *      (stored in globalState) or enabled forkn.telemetry.enabled
 *   3. forkn.telemetry.enabled is not explicitly false
 *
 * Prompt/code content is NEVER sent unless the separate
 * forkn.telemetry.sharePromptsInErrorReports setting is on, and even then
 * only on task errors — never for successful tasks.
 *
 * No PII: distinct_id is vscode.env.machineId (an anonymous, non-reversible
 * machine identifier provided by VS Code). Error messages are sanitized to
 * strip filesystem paths before sending.
 */

// Fill in before shipping. With an empty key, telemetry is a no-op.
const POSTHOG_API_KEY = 'phc_rZtnoh5DvsGes8XWasHDujTQhzNTjiAwgiHcNXhwgrZc';
const POSTHOG_HOST = 'us.i.posthog.com';

const CONSENT_KEY = 'forkn.telemetryConsent';        // 'allowed' | 'denied'
const REVIEW_PROMPT_KEY = 'forkn.reviewPromptShown'; // boolean

export class Telemetry {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** Effective state for the in-sidebar settings panel. */
  getState(): { enabled: boolean; sharePrompts: boolean } {
    const cfg = vscode.workspace.getConfiguration('forkn');
    const consented = this.context.globalState.get<string>(CONSENT_KEY) === 'allowed';
    return {
      enabled: consented && cfg.get<boolean>('telemetry.enabled', false),
      sharePrompts: cfg.get<boolean>('telemetry.sharePromptsInErrorReports', false),
    };
  }

  /** Toggle from the sidebar: enabling also grants consent (one action, no hidden gate). */
  async setEnabled(value: boolean): Promise<void> {
    if (value) {
      await this.context.globalState.update(CONSENT_KEY, 'allowed');
    }
    await vscode.workspace.getConfiguration('forkn')
      .update('telemetry.enabled', value, vscode.ConfigurationTarget.Global);
  }

  async setSharePrompts(value: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('forkn')
      .update('telemetry.sharePromptsInErrorReports', value, vscode.ConfigurationTarget.Global);
  }

  /** Show the first-run opt-in prompt if the user hasn't decided yet. */
  async maybeShowConsentPrompt(): Promise<void> {
    const decided = this.context.globalState.get<string>(CONSENT_KEY);
    if (decided) { return; }

    const choice = await vscode.window.showInformationMessage(
      'Help make Forkn better! Allow anonymous usage tracking to help us ' +
      'prioritize features and fix bugs. No sensitive data is collected. ' +
      'You can opt out at any time in settings.',
      'Allow', 'Deny',
    );

    if (choice === 'Allow') {
      await this.context.globalState.update(CONSENT_KEY, 'allowed');
      await vscode.workspace.getConfiguration('forkn')
        .update('telemetry.enabled', true, vscode.ConfigurationTarget.Global);
    } else if (choice === 'Deny') {
      await this.context.globalState.update(CONSENT_KEY, 'denied');
      this.maybeAskForReview();
    }
    // Dismissed without choosing: ask again next launch.
  }

  /** One-time: if the user declines telemetry, ask for a review instead. */
  private async maybeAskForReview(): Promise<void> {
    const shown = this.context.globalState.get<boolean>(REVIEW_PROMPT_KEY);
    if (shown) { return; }
    await this.context.globalState.update(REVIEW_PROMPT_KEY, true);

    const choice = await vscode.window.showInformationMessage(
      'No problem! If Forkn is useful to you, a rating on the marketplace ' +
      'helps others find it.',
      'Rate Forkn',
    );
    if (choice === 'Rate Forkn') {
      vscode.env.openExternal(vscode.Uri.parse(
        'https://marketplace.visualstudio.com/items?itemName=forkn.forkn&ssr=false#review-details',
      ));
    }
  }

  private isEnabled(): boolean {
    if (!POSTHOG_API_KEY) { return false; }
    if (!vscode.env.isTelemetryEnabled) { return false; }
    const consent = this.context.globalState.get<string>(CONSENT_KEY);
    if (consent !== 'allowed') { return false; }
    return vscode.workspace.getConfiguration('forkn')
      .get<boolean>('telemetry.enabled', false);
  }

  private sharePromptsEnabled(): boolean {
    return vscode.workspace.getConfiguration('forkn')
      .get<boolean>('telemetry.sharePromptsInErrorReports', false);
  }

  /** Fire-and-forget event capture. Never throws, never blocks. */
  capture(event: string, properties: Record<string, unknown> = {}): void {
    if (!this.isEnabled()) { return; }

    const payload = JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event,
      distinct_id: vscode.env.machineId,
      properties: {
        ...properties,
        forkn_version: this.context.extension?.packageJSON?.version ?? 'unknown',
        vscode_version: vscode.version,
      },
    });

    try {
      const req = https.request({
        hostname: POSTHOG_HOST,
        path: '/capture/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 3000,
      });
      req.on('error', () => { /* silent — telemetry must never break Forkn */ });
      req.on('timeout', () => { req.destroy(); });
      req.write(payload);
      req.end();
    } catch { /* silent */ }
  }

  /** Startup event: OS, RAM, CPU cores. No PII. */
  captureStartup(): void {
    this.capture('extension_started', {
      os: process.platform,
      ram_gb: Math.round(os.totalmem() / (1024 ** 3)),
      cpu_cores: os.cpus().length,
    });
  }

  taskStarted(provider: string, model: string, promptLength: number): void {
    this.capture('task_started', { provider, model, prompt_length: promptLength });
  }

  taskCompleted(provider: string, model: string, durationMs: number, outputChars: number): void {
    this.capture('task_completed', {
      provider, model, duration_ms: durationMs,
      output_chars: outputChars, success: true,
    });
  }

  taskFailed(
    provider: string, model: string, durationMs: number,
    error: string, prompt: string, output: string,
  ): void {
    const props: Record<string, unknown> = {
      provider, model, duration_ms: durationMs, success: false,
      error_type: classifyError(error),
      error_message: sanitize(error),
    };
    // Prompt/code content ONLY on errors, ONLY with the separate opt-in.
    if (this.sharePromptsEnabled()) {
      props.prompt = prompt.slice(0, 2000);
      props.output = output.slice(0, 4000);
    }
    this.capture('task_failed', props);
  }

  featureUsed(feature: string): void {
    this.capture('feature_used', { feature });
  }
}

/** Bucket errors into coarse types for aggregation. */
function classifyError(err: string): string {
  if (/BETA_NONTTY/.test(err)) { return 'antigravity_nontty'; }
  if (/sign-in|not signed in|authenticat|unauthorized/i.test(err)) { return 'auth'; }
  if (/CLI not found|ENOENT|failed to spawn/i.test(err)) { return 'cli_missing'; }
  if (/sandbox/i.test(err)) { return 'sandbox'; }
  if (/timed? ?out/i.test(err)) { return 'timeout'; }
  if (/rate ?limit|quota/i.test(err)) { return 'rate_limit'; }
  if (/network|connection|ECONNREFUSED/i.test(err)) { return 'network'; }
  if (/exited with code/i.test(err)) { return 'nonzero_exit'; }
  return 'other';
}

/** Strip filesystem paths (Windows and Unix) so no usernames/projects leak. */
function sanitize(s: string): string {
  return s
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
    .replace(/\/(?:home|Users)\/[^\s"']+/g, '<path>')
    .slice(0, 500);
}
