import { execFile } from 'child_process';
import { ProviderId } from './types';

export const CLI_DEFAULTS: Record<ProviderId, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'antigravity': 'agy',
  'opencode': 'opencode',
};

export interface DetectionResult {
  detected: boolean;
  path?: string;
  version?: string;
}

/**
 * Detect a single CLI by running `<binary> --version`.
 * Returns the resolved path and version string if found.
 */
export async function detectProvider(
  id: ProviderId,
  customPath?: string,
): Promise<DetectionResult> {
  const bin = customPath || CLI_DEFAULTS[id];

  // First, resolve the full path
  const resolvedPath = await resolveBinaryPath(bin);

  // Then verify it works by running --version
  const version = await getVersion(resolvedPath || bin);

  if (version) {
    return { detected: true, path: resolvedPath || bin, version };
  }
  return { detected: false };
}

/** Run `where`/`which` to get the full binary path. */
function resolveBinaryPath(bin: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // If it's already an absolute path, just return it
    if (bin.includes('/') || bin.includes('\\')) {
      resolve(bin);
      return;
    }
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, [bin], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve(undefined);
      } else {
        // `where` on Windows can return multiple lines; take the first
        const firstLine = stdout.trim().split('\n')[0]?.trim();
        resolve(firstLine || undefined);
      }
    });
  });
}

/** Run `<binary> --version` and return the version string, or undefined. */
function getVersion(bin: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    // With shell:true, an unquoted path containing spaces (e.g. under
    // "C:\Program Files\") is re-tokenized and fails. Quote it when shelling.
    const cmd = isWin && /\s/.test(bin) ? `"${bin}"` : bin;
    execFile(
      cmd,
      ['--version'],
      { timeout: 10000, shell: isWin },
      (err, stdout, stderr) => {
        if (err) {
          resolve(undefined);
        } else {
          // Version could be in stdout or stderr
          const out = (stdout || stderr || '').trim();
          // Extract first line, cap at 60 chars
          const firstLine = out.split('\n')[0]?.trim().slice(0, 60);
          resolve(firstLine || 'installed');
        }
      },
    );
  });
}

/** Detect all providers, optionally using custom paths. */
export async function detectAllProviders(
  customPaths?: Partial<Record<ProviderId, string>>,
): Promise<Record<ProviderId, DetectionResult>> {
  const ids: ProviderId[] = ['claude-code', 'codex', 'antigravity', 'opencode'];
  const results = await Promise.all(
    ids.map(async (id) => {
      const result = await detectProvider(id, customPaths?.[id]);
      return [id, result] as const;
    }),
  );
  return Object.fromEntries(results) as Record<ProviderId, DetectionResult>;
}
