export type ProviderId = 'claude-code' | 'codex' | 'antigravity' | 'opencode';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  status: TaskStatus;
  output: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  actualModel?: string;      // model that actually succeeded (if fallback occurred)
  fallbackFrom?: string;     // the originally-requested model, if we fell back
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  color: string;
  detected: boolean;
  detectedPath?: string;
  version?: string;
  beta?: boolean;
  models: ModelOption[];
}

export interface TaskTemplate {
  name: string;
  prompt: string;
  provider: ProviderId;
  model: string;
}

/** Messages from webview → extension */
export type WebviewMessage =
  | { type: 'runTask'; prompt: string; provider: ProviderId; model: string }
  | { type: 'cancelTask'; taskId: string }
  | { type: 'rerunTask'; taskId: string }
  | { type: 'clearCompleted' }
  | { type: 'browsePath'; provider: ProviderId }
  | { type: 'setPath'; provider: ProviderId; path: string }
  | { type: 'authenticate'; provider: ProviderId }
  | { type: 'featureUsed'; feature: string }
  | { type: 'setTelemetry'; key: 'enabled' | 'sharePrompts'; value: boolean }
  | { type: 'requestTemplateName'; prompt: string; provider: string; model: string }
  | { type: 'requestNewTemplate'; draft: string }
  | { type: 'ready' };

/** Messages from extension → webview */
export type ExtensionMessage =
  | { type: 'tasksUpdated'; tasks: Task[] }
  | { type: 'providers'; providers: ProviderConfig[]; telemetry?: { enabled: boolean; sharePrompts: boolean }; templates?: SavedTemplate[] }
  | { type: 'templateCreated'; name: string; prompt: string; provider: string; model: string };

export interface SavedTemplate { name: string; prompt: string; provider: string; model: string; }
