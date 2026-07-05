import * as vscode from 'vscode';
import { Task, ProviderId, TaskStatus } from './types';
import { BaseProvider } from '../providers/base';
import { ClaudeCodeProvider } from '../providers/claude';
import { CodexProvider } from '../providers/codex';
import { AntigravityProvider } from '../providers/antigravity';
import { OpenCodeProvider } from '../providers/opencode';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private runningCount = 0;
  private providers: Map<ProviderId, BaseProvider> = new Map();
  private taskCounter = 0;

  // Fallback model order per provider — most capable/stable first.
  // If a task's requested model fails, the next model is tried, and so on.
  private static readonly FALLBACK_ORDER: Record<ProviderId, string[]> = {
    'claude-code': ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    'codex': ['gpt-5.5', 'o4-mini', 'o3'],
    'antigravity': ['gemini-3.5-pro', 'gemini-3.5-flash'],
    'opencode': [
      'opencode/big-pickle',
      'opencode/nemotron-3-ultra-free',
      'opencode/deepseek-v4-flash-free',
      'opencode/mimo-v2.5-free',
      'opencode/north-mini-code-free',
    ],
  };

  /** Build the ordered list of models to try, starting with the requested one. */
  private buildModelChain(providerId: ProviderId, requested: string): string[] {
    const order = TaskManager.FALLBACK_ORDER[providerId] || [];
    // Start with requested, then the rest of the fallback order (deduped).
    const chain = [requested];
    for (const m of order) {
      if (m !== requested) { chain.push(m); }
    }
    return chain;
  }

  private readonly _onDidUpdate = new vscode.EventEmitter<Task[]>();
  readonly onDidUpdate = this._onDidUpdate.event;

  // Fires when a task reaches a terminal state (completed/failed)
  private readonly _onDidFinishTask = new vscode.EventEmitter<Task>();
  readonly onDidFinishTask = this._onDidFinishTask.event;

  // Fires when a task transitions from queued to running
  private readonly _onDidStartTask = new vscode.EventEmitter<Task>();
  readonly onDidStartTask = this._onDidStartTask.event;

  constructor(private workspaceRoot: string) {
    this.initProviders();
  }

  private initProviders(): void {
    const config = vscode.workspace.getConfiguration('forkn');

    this.providers.set('claude-code', new ClaudeCodeProvider(
      config.get<string>('providers.claudeCode.path', 'claude')
    ));
    this.providers.set('codex', new CodexProvider(
      config.get<string>('providers.codex.path', 'codex')
    ));
    this.providers.set('antigravity', new AntigravityProvider(
      config.get<string>('providers.antigravity.path', 'agy')
    ));
    this.providers.set('opencode', new OpenCodeProvider(
      config.get<string>('providers.opencode.path', 'opencode')
    ));
  }

  /** Hot-swap a provider's binary path without restarting. */
  updateProviderPath(id: ProviderId, newPath: string): void {
    switch (id) {
      case 'claude-code':
        this.providers.set(id, new ClaudeCodeProvider(newPath));
        break;
      case 'codex':
        this.providers.set(id, new CodexProvider(newPath));
        break;
      case 'antigravity':
        this.providers.set(id, new AntigravityProvider(newPath));
        break;
      case 'opencode':
        this.providers.set(id, new OpenCodeProvider(newPath));
        break;
    }
  }

  private getMaxParallel(): number {
    return vscode.workspace.getConfiguration('forkn')
      .get<number>('maxParallelTasks', 3);
  }

  private generateId(): string {
    return `task_${Date.now()}_${++this.taskCounter}`;
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  enqueue(prompt: string, providerId: ProviderId, model: string): Task {
    const task: Task = {
      id: this.generateId(),
      prompt,
      provider: providerId,
      model,
      status: 'queued',
      output: '',
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.fireUpdate();
    this.tryRunNext();
    return task;
  }

  rerun(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) { return undefined; }

    // Don't re-run something still in flight
    if (task.status === 'running' || task.status === 'queued') { return task; }

    // Reset the existing task in place (same id, same card)
    task.status = 'queued';
    task.output = '';
    task.error = undefined;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.elapsedMs = undefined;
    // Bump createdAt so it sorts as the newest queued item
    task.createdAt = Date.now();

    this.fireUpdate();
    this.tryRunNext();
    return task;
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) { return; }

    if (task.status === 'running') {
      const provider = this.providers.get(task.provider);
      provider?.kill(taskId);
      this.runningCount--;
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.elapsedMs = task.startedAt ? task.completedAt - task.startedAt : 0;
    this.fireUpdate();
    this.tryRunNext();
  }

  clearCompleted(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        this.tasks.delete(id);
      }
    }
    this.fireUpdate();
  }

  private tryRunNext(): void {
    if (this.runningCount >= this.getMaxParallel()) { return; }

    const queued = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const task of queued) {
      if (this.runningCount >= this.getMaxParallel()) { break; }
      this.runTask(task);
    }
  }

  private runTask(task: Task): void {
    const provider = this.providers.get(task.provider);
    if (!provider) {
      task.status = 'failed';
      task.error = `Provider "${task.provider}" not found.`;
      task.completedAt = Date.now();
      this.fireUpdate();
      return;
    }

    task.status = 'running';
    this._onDidStartTask.fire(task);
    task.startedAt = Date.now();
    this.runningCount++;
    this.fireUpdate();

    const requestedModel = task.model;
    const chain = this.buildModelChain(task.provider, requestedModel);
    const attemptErrors: string[] = [];

    const attempt = (index: number): void => {
      const model = chain[index];
      const isLast = index >= chain.length - 1;
      // Reset per-attempt output so a failed model's partial text doesn't
      // bleed into the next attempt.
      task.output = '';
      task.error = undefined;
      this.fireUpdate();

      provider.run(task.id, task.prompt, model, this.workspaceRoot, {
        onData: (data: string) => {
          task.output += data;
          this.fireUpdate();
        },
        onComplete: () => {
          // Success. Record whether we fell back from the requested model.
          if (model !== requestedModel) {
            task.actualModel = model;
            task.fallbackFrom = requestedModel;
            console.warn(
              `[Forkn] Task ${task.id}: ${requestedModel} failed, ` +
              `succeeded with fallback ${model}.`,
            );
          }
          this.finishTask(task, 'completed');
        },
        onError: (err: string) => {
          attemptErrors.push(`${model}: ${err}`);
          console.warn(`[Forkn] Task ${task.id}: model ${model} failed — ${err}`);

          // A BETA_NONTTY notice from Antigravity is not a real failure we
          // should retry — the model ran fine, output just wasn't captured.
          const isBetaNotice = err.indexOf('BETA_NONTTY:') === 0;

          // If the CLI binary itself is missing/unspawnable, every model will
          // fail identically — don't waste attempts cycling through them.
          const isMissingCli = /failed to spawn|not found|ENOENT|CLI not found/i.test(err);

          if (isLast || isBetaNotice || isMissingCli) {
            if (isBetaNotice) {
              task.error = err;
            } else if (isMissingCli) {
              task.error = err;
            } else if (chain.length > 1) {
              task.error =
                `All ${chain.length} models failed for ${task.provider}.\n` +
                attemptErrors.join('\n');
            } else {
              task.error = err;
            }
            this.finishTask(task, 'failed');
          } else {
            // Try the next model in the chain.
            attempt(index + 1);
          }
        },
      });
    };

    attempt(0);
  }

  private finishTask(task: Task, status: TaskStatus): void {
    if (task.status !== 'running') { return; }
    task.status = status;
    task.completedAt = Date.now();
    task.elapsedMs = task.startedAt ? task.completedAt - task.startedAt : 0;
    this.runningCount--;
    this.fireUpdate();
    this._onDidFinishTask.fire(task);
    this.tryRunNext();
  }

  private fireUpdate(): void {
    this._onDidUpdate.fire(this.getAllTasks());
  }

  dispose(): void {
    for (const [, task] of this.tasks) {
      if (task.status === 'running') {
        const provider = this.providers.get(task.provider);
        provider?.kill(task.id);
      }
    }
    this._onDidUpdate.dispose();
    this._onDidFinishTask.dispose();
    this._onDidStartTask.dispose();
  }
}
