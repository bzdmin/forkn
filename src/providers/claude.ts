import { BaseProvider } from './base';

export class ClaudeCodeProvider extends BaseProvider {
  protected buildArgs(prompt: string, model: string): string[] {
    // --print forces single-shot non-interactive output
    // -p passes the prompt
    return ['--model', model, '--print', '-p', prompt];
  }
}
