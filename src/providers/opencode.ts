import { BaseProvider } from './base';

export class OpenCodeProvider extends BaseProvider {
  protected buildArgs(prompt: string, model: string): string[] {
    return ['run', '--model', model, prompt];
  }
}
