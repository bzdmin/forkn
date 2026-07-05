import * as vscode from 'vscode';
import { TaskManager } from './core/taskManager';
import { SidebarProvider } from './sidebar/SidebarProvider';
import { Telemetry } from './core/telemetry';
import { ProviderId } from './core/types';

let taskManager: TaskManager;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  taskManager = new TaskManager(workspaceRoot);

  // ── Telemetry (opt-in, off by default) ──
  const telemetry = new Telemetry(context);
  telemetry.maybeShowConsentPrompt();
  telemetry.captureStartup();

  context.subscriptions.push(
    taskManager.onDidStartTask((task) => {
      telemetry.taskStarted(task.provider, task.actualModel || task.model, task.prompt.length);
    }),
    taskManager.onDidFinishTask((task) => {
      const duration = task.elapsedMs ?? 0;
      const model = task.actualModel || task.model;
      if (task.status === 'completed') {
        telemetry.taskCompleted(task.provider, model, duration, (task.output || '').length);
      } else if (task.status === 'failed') {
        telemetry.taskFailed(
          task.provider, model, duration,
          task.error || 'unknown', task.prompt, task.output || '',
        );
      }
    }),
  );

  const sidebarProvider = new SidebarProvider(context.extensionUri, taskManager, telemetry, context.globalState);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('forkn')) { sidebarProvider.refreshWebview(); }
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
    ),
  );

  // ── Fix 26: Notification badges + popups on task completion ──
  let unseenCount = 0;

  const providerLabels: Record<ProviderId, string> = {
    'claude-code': 'Claude',
    'codex': 'Codex',
    'antigravity': 'Antigravity',
    'opencode': 'OpenCode',
  };

  const costMap: Record<string, number> = {
    'claude-opus-4-6': 0.48, 'claude-sonnet-4-6': 0.12, 'claude-haiku-4-5': 0.03,
    'gpt-5.5': 0.30, 'o4-mini': 0.08, 'o3': 0.20,
    'gemini-3.5-flash': 0, 'gemini-3.5-pro': 0.10,
  };

  function formatCost(model: string): string {
    if ((model || '').startsWith('opencode/')) { return '$0.00'; }
    const c = costMap[model];
    return c !== undefined ? `$${c.toFixed(2)}` : '';
  }

  context.subscriptions.push(
    taskManager.onDidFinishTask((task) => {
      const provLabel = providerLabels[task.provider] ?? task.provider;
      const cost = formatCost(task.model);
      const shortPrompt = task.prompt.length > 50
        ? task.prompt.slice(0, 50) + '…'
        : task.prompt;

      // Update activity bar badge
      unseenCount++;
      if (sidebarProvider.view) {
        sidebarProvider.view.badge = {
          value: unseenCount,
          tooltip: `${unseenCount} finished task${unseenCount > 1 ? 's' : ''}`,
        };
      }

      // Show notification popup
      if (task.status === 'completed') {
        vscode.window.showInformationMessage(
          `✅ Task completed: ${shortPrompt} (${provLabel}${cost ? ', ' + cost : ''})`,
        );
      } else if (task.status === 'failed') {
        // Keep the toast short; offer a button for the full error.
        vscode.window
          .showErrorMessage(
            `❌ ${provLabel} task failed: ${shortPrompt}`,
            'Show details',
          )
          .then((choice) => {
            if (choice === 'Show details' && task.error) {
              vscode.window.showErrorMessage(task.error);
            }
          });
      }
    }),
  );

  // Clear badge when the sidebar becomes visible
  context.subscriptions.push(
    sidebarProvider.onDidViewBecomeVisible(() => {
      unseenCount = 0;
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forkn.newTask', async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: 'Enter task description',
        placeHolder: 'e.g. Add input validation to signup form',
      });
      if (!prompt) { return; }

      const provider = await vscode.window.showQuickPick(
        [
          { label: 'Claude Code', id: 'claude-code' as const },
          { label: 'Codex CLI', id: 'codex' as const },
          { label: 'Antigravity CLI', id: 'antigravity' as const },
          { label: 'OpenCode', id: 'opencode' as const },
        ],
        { placeHolder: 'Pick a provider' },
      );
      if (!provider) { return; }

      const modelMap: Record<ProviderId, { label: string; id: string }[]> = {
        'claude-code': [
          { label: 'Opus 4.6', id: 'claude-opus-4-6' },
          { label: 'Sonnet 4.6', id: 'claude-sonnet-4-6' },
          { label: 'Haiku 4.5', id: 'claude-haiku-4-5' },
        ],
        'codex': [
          { label: 'GPT-5.5', id: 'gpt-5.5' },
          { label: 'o4-mini', id: 'o4-mini' },
          { label: 'o3', id: 'o3' },
        ],
        'antigravity': [
          { label: 'Gemini 3.5 Flash', id: 'gemini-3.5-flash' },
          { label: 'Gemini 3.5 Pro', id: 'gemini-3.5-pro' },
        ],
        'opencode': [
          { label: 'big-pickle', id: 'opencode/big-pickle' },
          { label: 'deepseek-v4-flash', id: 'opencode/deepseek-v4-flash-free' },
          { label: 'mimo-v2.5', id: 'opencode/mimo-v2.5-free' },
          { label: 'nemotron-3-ultra', id: 'opencode/nemotron-3-ultra-free' },
          { label: 'north-mini-code', id: 'opencode/north-mini-code-free' },
        ],
      };

      const model = await vscode.window.showQuickPick(
        modelMap[provider.id] ?? [],
        { placeHolder: 'Pick a model' },
      );
      if (!model) { return; }

      taskManager.enqueue(prompt, provider.id, model.id);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forkn.cancelTask', async () => {
      const tasks = taskManager.getAllTasks().filter(
        t => t.status === 'running' || t.status === 'queued',
      );
      if (!tasks.length) {
        vscode.window.showInformationMessage('No active tasks to cancel.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        tasks.map(t => ({ label: t.prompt, description: t.status, id: t.id })),
        { placeHolder: 'Select a task to cancel' },
      );
      if (pick) { taskManager.cancel(pick.id); }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forkn.clearCompleted', () => {
      taskManager.clearCompleted();
    }),
  );
}

export function deactivate(): void {
  taskManager?.dispose();
}
