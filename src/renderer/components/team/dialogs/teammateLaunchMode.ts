import { parseCliArgs } from '@shared/utils/cliArgsParser';

export type TeammateLaunchMode = 'in-process' | 'tmux';

export const DEFAULT_TEAMMATE_LAUNCH_MODE: TeammateLaunchMode = 'in-process';

export function normalizeTeammateLaunchMode(value: string | null | undefined): TeammateLaunchMode {
  return value === 'tmux' || value === 'in-process' ? value : DEFAULT_TEAMMATE_LAUNCH_MODE;
}

export function buildTeammateModeCliArgs(mode: TeammateLaunchMode): string[] {
  return ['--teammate-mode', mode];
}

function stripTeammateModeArgs(tokens: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--teammate-mode') {
      index += 1;
      continue;
    }
    if (token.startsWith('--teammate-mode=')) {
      continue;
    }
    result.push(token);
  }
  return result;
}

function quoteCliToken(token: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(token)) {
    return token;
  }
  return `"${token.replace(/(["\\$`])/g, '\\$1')}"`;
}

export function buildLaunchExtraCliArgs(
  customArgs: string,
  mode: TeammateLaunchMode
): string | undefined {
  const customTokens = stripTeammateModeArgs(parseCliArgs(customArgs));
  const tokens = [...buildTeammateModeCliArgs(mode), ...customTokens];
  return tokens.length > 0 ? tokens.map(quoteCliToken).join(' ') : undefined;
}
