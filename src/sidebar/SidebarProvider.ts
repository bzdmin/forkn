import * as vscode from 'vscode';
import { TaskManager } from '../core/taskManager';
import { ExtensionMessage, WebviewMessage, ProviderConfig, Task, ProviderId, SavedTemplate } from '../core/types';
import { detectAllProviders, detectProvider, DetectionResult } from '../core/detect';

const PROVIDER_DEFS: Omit<ProviderConfig, 'detected'>[] = [
  {
    id: 'claude-code', label: 'Claude', color: '#E87C5B',
    models: [
      { id: 'claude-opus-4-6', label: 'Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'codex', label: 'Codex', color: '#10A37F',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'o4-mini', label: 'o4-mini' },
      { id: 'o3', label: 'o3' },
    ],
  },
  {
    id: 'antigravity', label: 'Antigravity', color: '#4285F4',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-pro', label: 'Gemini 3.5 Pro' },
    ],
  },
  {
    id: 'opencode', label: 'OpenCode', color: '#CCCCCC',
    models: [
      { id: 'opencode/big-pickle', label: 'big-pickle' },
      { id: 'opencode/deepseek-v4-flash-free', label: 'deepseek-v4-flash' },
      { id: 'opencode/mimo-v2.5-free', label: 'mimo-v2.5' },
      { id: 'opencode/nemotron-3-ultra-free', label: 'nemotron-3-ultra' },
      { id: 'opencode/north-mini-code-free', label: 'north-mini-code' },
    ],
  },
];

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'forkn.dashboard';
  public view?: vscode.WebviewView;
  private detectionResults: Record<string, DetectionResult> = {};

  private readonly _onDidViewBecomeVisible = new vscode.EventEmitter<void>();
  readonly onDidViewBecomeVisible = this._onDidViewBecomeVisible.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly taskManager: TaskManager,
    private readonly telemetry?: {
      featureUsed(f: string): void;
      getState(): { enabled: boolean; sharePrompts: boolean };
      setEnabled(v: boolean): Promise<void>;
      setSharePrompts(v: boolean): Promise<void>;
    },
    private readonly storage?: vscode.Memento,
  ) {
    this.taskManager.onDidUpdate((tasks) => this.postTasks(tasks));
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Clear the notification badge whenever the user opens/focuses the sidebar
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        webviewView.badge = undefined;
        this._onDidViewBecomeVisible.fire();
      }
    });

    // Register message handler BEFORE async detection so we don't miss 'ready'
    let webviewReady = false;

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'runTask':
          this.taskManager.enqueue(msg.prompt, msg.provider, msg.model);
          this.telemetry?.featureUsed('task_queued');
          break;
        case 'cancelTask':
          this.taskManager.cancel(msg.taskId);
          break;
        case 'rerunTask':
          this.taskManager.rerun(msg.taskId);
          this.telemetry?.featureUsed('task_rerun');
          break;
        case 'clearCompleted':
          this.taskManager.clearCompleted();
          break;
        case 'setTelemetry':
          if (msg.key === 'enabled') { await this.telemetry?.setEnabled(msg.value); }
          else { await this.telemetry?.setSharePrompts(msg.value); }
          this.postProviders();
          break;
        case 'featureUsed':
          this.telemetry?.featureUsed(msg.feature);
          break;
        case 'browsePath':
          await this.handleBrowsePath(msg.provider);
          break;
        case 'setPath':
          await this.handleSetPath(msg.provider, msg.path);
          break;
        case 'authenticate':
          this.handleAuthenticate(msg.provider);
          break;
        case 'requestTemplateName': {
          const name = await vscode.window.showInputBox({
            prompt: 'Template name',
            value: msg.prompt.slice(0, 30),
          });
          if (name) {
            await this.saveTemplate({ name, prompt: msg.prompt, provider: msg.provider, model: msg.model });
          }
          break;
        }
        case 'requestNewTemplate': {
          const name = await vscode.window.showInputBox({ prompt: 'Template name' });
          if (!name) { break; }
          const text = msg.draft || await vscode.window.showInputBox({ prompt: 'Template prompt text' });
          if (!text) { break; }
          await this.saveTemplate({ name, prompt: text, provider: '', model: '' });
          break;
        }
        case 'ready':
          webviewReady = true;
          this.postProviders();
          this.postTasks(this.taskManager.getAllTasks());
          break;
      }
    });

    // Detect installed CLIs using custom paths from settings
    const config = vscode.workspace.getConfiguration('forkn');
    const customPaths: Partial<Record<ProviderId, string>> = {};
    const ids: ProviderId[] = ['claude-code', 'codex', 'antigravity', 'opencode'];
    const settingKeys: Record<ProviderId, string> = {
      'claude-code': 'providers.claudeCode.path',
      'codex': 'providers.codex.path',
      'antigravity': 'providers.antigravity.path',
      'opencode': 'providers.opencode.path',
    };
    for (const id of ids) {
      const saved = config.get<string>(settingKeys[id]);
      if (saved) { customPaths[id] = saved; }
    }
    this.detectionResults = await detectAllProviders(
      Object.keys(customPaths).length > 0 ? customPaths : undefined,
    );

    // If webview sent 'ready' while we were detecting, send providers now
    if (webviewReady) {
      this.postProviders();
      this.postTasks(this.taskManager.getAllTasks());
    }
  }

  /**
   * Open a real VS Code terminal and run the provider's interactive auth
   * flow. agy needs a TTY for its browser sign-in, which a background
   * subprocess can't provide — so we hand the user a live terminal.
   */
  private handleAuthenticate(providerId: ProviderId): void {
    if (providerId !== 'antigravity') {
      vscode.window.showInformationMessage(
        `${providerId} is authenticated through its own CLI. Run it once in a terminal.`,
      );
      return;
    }

    const agyPath = vscode.workspace
      .getConfiguration('forkn')
      .get<string>('providers.antigravity.path', 'agy');

    const terminal = vscode.window.createTerminal('Forkn: Antigravity Sign-in');
    terminal.show();
    // Running agy with no args triggers its interactive auth on first use.
    terminal.sendText(agyPath, true);

    vscode.window.showInformationMessage(
      'Complete the Antigravity sign-in in the terminal, then return to Forkn and try your task again.',
    );
  }



  /** Open a file picker and verify the selected binary. */
  private async handleBrowsePath(providerId: ProviderId): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: `Select CLI binary for ${providerId}`,
      filters: process.platform === 'win32'
        ? { 'Executables': ['exe', 'cmd', 'bat'], 'All files': ['*'] }
        : undefined,
    });

    if (!result || result.length === 0) { return; }
    const selectedPath = result[0].fsPath;
    await this.handleSetPath(providerId, selectedPath);
  }

  /** Verify a path, save to settings if valid, then refresh providers. */
  private async handleSetPath(providerId: ProviderId, path: string): Promise<void> {
    const trimmed = path.trim();
    if (!trimmed) { return; }

    // Verify the binary works
    const detection = await detectProvider(providerId, trimmed);

    if (detection.detected) {
      // Save to VS Code settings
      const settingKeys: Record<ProviderId, string> = {
        'claude-code': 'providers.claudeCode.path',
        'codex': 'providers.codex.path',
        'antigravity': 'providers.antigravity.path',
        'opencode': 'providers.opencode.path',
      };
      const config = vscode.workspace.getConfiguration('forkn');
      await config.update(settingKeys[providerId], trimmed, vscode.ConfigurationTarget.Global);

      // Update TaskManager with new path
      this.taskManager.updateProviderPath(providerId, trimmed);

      this.detectionResults[providerId] = detection;
      vscode.window.showInformationMessage(
        `✅ ${providerId} detected: ${detection.version || 'installed'}`,
      );
    } else {
      vscode.window.showWarningMessage(
        `❌ Could not verify "${trimmed}" — it didn't respond to --version.`,
      );
    }

    this.postProviders();
  }

  private post(message: ExtensionMessage): void {
    this.view?.webview.postMessage(message);
  }

  private postTasks(tasks: Task[]): void {
    this.post({ type: 'tasksUpdated', tasks });
  }

  private async saveTemplate(t: SavedTemplate): Promise<void> {
    const list = this.storage?.get<SavedTemplate[]>('forkn.templates', []) ?? [];
    list.push(t);
    await this.storage?.update('forkn.templates', list);
    this.telemetry?.featureUsed('template_created');
    this.post({ type: 'templateCreated', name: t.name, prompt: t.prompt, provider: t.provider, model: t.model });
  }

  /** Re-send providers/settings state to the webview (e.g. after config change). */
  public refreshWebview(): void {
    this.postProviders();
  }

  private postProviders(): void {
    const providers: ProviderConfig[] = PROVIDER_DEFS.map(p => {
      const det = this.detectionResults[p.id];
      return {
        ...p,
        detected: det?.detected ?? false,
        detectedPath: det?.path,
        version: det?.version,
      };
    });
    this.post({ type: 'providers', providers, telemetry: this.telemetry?.getState(), templates: this.storage?.get<SavedTemplate[]>('forkn.templates', []) ?? [] });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const extVersion = vscode.extensions.getExtension('forkn.forkn')?.packageJSON.version ?? '1.0';
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'),
    );
    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 128 128" fill="none"><g stroke="#8B5CF6" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M44 116 C44 100 48 90 50 78"/><path d="M50 78 C44 68 38 64 34 54"/><path d="M50 78 C50 58 54 46 56 28"/><path d="M50 78 C64 70 74 60 86 48"/><path d="M50 78 C70 76 84 72 100 66"/></g><circle cx="34" cy="54" r="9" fill="#CCCCCC"/><circle cx="56" cy="28" r="9" fill="#4285F4"/><circle cx="86" cy="48" r="9" fill="#10A37F"/><circle cx="100" cy="66" r="9" fill="#E87C5B"/></svg>`;

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;"/>
  <link rel="stylesheet" href="${cssUri}"/>
</head>
<body>

  <!-- HEADER -->
  <div class="hdr">
    ${logoSvg}
    <span class="hdr-v">v${extVersion}</span>
    <span class="hdr-spacer"></span>
    <button class="hdr-btn" id="settingsBtn" title="Provider Settings">&#9881;</button>
  </div>

  <!-- SETTINGS PANEL -->
  <div class="settings" id="settingsPanel">
    <div class="settings-title">Provider Settings</div>
    <div id="settingsRows"></div>
    <div class="s-hint">Paths persist in VS Code settings.json</div>
  </div>

  <!-- INPUT -->
  <div class="input-wrap">
    <textarea id="prompt" placeholder="What should the AI do?" rows="3"></textarea>

    <!-- Provider tabs -->
    <div class="tabs" id="tabs"></div>

    <!-- Model dropdown -->
    <div class="model-row">
      <span class="model-dot" id="modelDot"></span>
      <select id="model"></select>
    </div>

    <!-- Run + Queue -->
    <div class="action-row">
      <button class="run-btn" id="runBtn">&#9654; Run</button>
      <button class="queue-btn" id="queueBtn">+ Queue</button>
    </div>
  </div>

  <!-- TEMPLATES -->
  <div class="tpl-wrap">
    <div class="tpl-row" id="tplRow">
      <span class="tpl" data-tpl="Lint the project, fix any errors, and summarize what changed">Morning check</span>
      <span class="tpl" data-tpl="Run all tests and report failures with suggested fixes">Run tests</span>
      <span class="tpl" data-tpl="Review the latest git diff and suggest improvements">PR review</span>
      <span class="tpl tpl-new" id="tplNew">+New</span>
    </div>
  </div>

  <!-- TASKS -->
  <div id="taskList" class="tasks">
    <div class="empty">
      <div class="empty-dots">
        <span style="background:var(--claude)"></span>
        <span style="background:var(--codex)"></span>
        <span style="background:var(--antigravity)"></span>
        <span style="background:var(--opencode)"></span>
      </div>
      <div class="empty-txt">No tasks yet</div>
    </div>
  </div>

  <!-- STATS -->
  <div class="stats" id="stats" style="display:none">
    <div class="st"><div class="st-val" id="sSpend">$0</div><div class="st-label">Spend</div></div>
    <div class="st"><div class="st-val" id="sTasks">0</div><div class="st-label">Tasks</div></div>
    <div class="st" id="sMidWrap"><div class="st-val run-color" id="sMid"><span class="st-dot"></span>0</div><div class="st-label" id="sMidLabel">Running</div></div>
    <div class="st" id="sMid2Wrap" style="display:none"><div class="st-val" id="sMid2" style="color:var(--error)">0</div><div class="st-label">Failed</div></div>
    <div class="st"><div class="st-val g" id="sSaved">0h</div><div class="st-label">Saved</div></div>
  </div>

  <!-- DETAIL VIEW (mini chat view) -->
  <div id="detailView" class="detail" style="display:none">
    <div class="detail-hdr">
      <button class="detail-back" id="detailBack">&#8592;</button>
      <span class="detail-back-label">Back to tasks</span>
    </div>
    <div class="detail-body">
      <div class="detail-prompt" id="detailPrompt"></div>
      <div class="detail-meta" id="detailMeta"></div>
      <div class="detail-output" id="detailOutput"></div>
    </div>
    <div class="detail-actions" id="detailActions"></div>
  </div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
