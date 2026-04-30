import { getAppDataPath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { atomicWriteAsync } from './atomicWrite';

import type {
  TeamTemplateMember,
  TeamTemplateSource,
  TeamTemplateSourcesSnapshot,
  TeamTemplateSummary,
} from '@shared/types';

const logger = createLogger('Service:TeamTemplateSource');

const DEFAULT_SOURCE: TeamTemplateSource = {
  id: 'hermit-official',
  name: 'Hermit 官方团队模板',
  url: 'https://github.com/yancyuu/HermitTeams.git',
  enabled: true,
  branch: 'main',
  isDefault: true,
};

const GIT_TIMEOUT_MS = 60_000;

function getTemplateDataRoot(): string {
  return path.join(getAppDataPath(), 'team-template-sources');
}

function getSourcesConfigPath(): string {
  return path.join(getTemplateDataRoot(), 'sources.json');
}

function slugifySourceId(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `source-${Date.now().toString(36)}`
  );
}

function sourceCheckoutPath(sourceId: string): string {
  return path.join(getTemplateDataRoot(), 'repos', sourceId);
}

function execGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || 'git command failed').trim()));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function normalizeSource(input: unknown): TeamTemplateSource | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Partial<TeamTemplateSource>;
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  if (!url) return null;
  const id =
    typeof row.id === 'string' && row.id.trim()
      ? slugifySourceId(row.id)
      : slugifySourceId(
          url
            .replace(/\.git$/, '')
            .split('/')
            .slice(-2)
            .join('-')
        );
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id,
    url,
    enabled: row.enabled !== false,
    branch: typeof row.branch === 'string' && row.branch.trim() ? row.branch.trim() : undefined,
    isDefault: row.isDefault === true,
    lastSyncedAt: typeof row.lastSyncedAt === 'string' ? row.lastSyncedAt : undefined,
    lastError: typeof row.lastError === 'string' ? row.lastError : undefined,
  };
}

function dedupeSources(sources: TeamTemplateSource[]): TeamTemplateSource[] {
  const byId = new Map<string, TeamTemplateSource>();
  for (const source of sources) {
    byId.set(source.id, source);
  }
  if (!byId.has(DEFAULT_SOURCE.id)) {
    byId.set(DEFAULT_SOURCE.id, DEFAULT_SOURCE);
  }
  return Array.from(byId.values());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readMarkdownIfExists(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 128 * 1024) return undefined;
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function parseMembers(rawMembers: unknown, templateDir: string): TeamTemplateMember[] {
  if (!Array.isArray(rawMembers)) return [];
  return rawMembers.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return [];
    const workflowFile = typeof raw.workflowFile === 'string' ? raw.workflowFile.trim() : undefined;
    const workflow =
      typeof raw.workflow === 'string' && raw.workflow.trim()
        ? raw.workflow.trim()
        : workflowFile
          ? readMarkdownIfExists(path.join(templateDir, workflowFile))
          : undefined;
    return [
      {
        name: raw.name.trim(),
        role: typeof raw.role === 'string' && raw.role.trim() ? raw.role.trim() : undefined,
        workflow,
        workflowFile,
      },
    ];
  });
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  return items.length > 0 ? items.map((item) => item.trim()) : undefined;
}

function isTemplateSource(value: TeamTemplateSource | null): value is TeamTemplateSource {
  return value !== null;
}

function scanSourceTemplates(source: TeamTemplateSource): TeamTemplateSummary[] {
  const repoPath = sourceCheckoutPath(source.id);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(repoPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const templates: TeamTemplateSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const templateDir = path.join(repoPath, entry.name);
    const manifestPath = path.join(templateDir, 'hermit-team.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
      if (!isRecord(manifest)) continue;
      const templateId =
        typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : entry.name;
      templates.push({
        sourceId: source.id,
        sourceName: source.name,
        templateId,
        displayName:
          typeof manifest.displayName === 'string' && manifest.displayName.trim()
            ? manifest.displayName.trim()
            : templateId,
        description:
          typeof manifest.description === 'string' && manifest.description.trim()
            ? manifest.description.trim()
            : readMarkdownIfExists(path.join(templateDir, 'README.md')),
        tags: parseStringArray(manifest.tags),
        members: parseMembers(manifest.members, templateDir),
        skillPaths: parseStringArray(manifest.skillPaths),
        memoryPaths: parseStringArray(manifest.memoryPaths),
      });
    } catch (error) {
      logger.warn(`Failed to read template manifest ${manifestPath}: ${String(error)}`);
    }
  }
  return templates;
}

export class TeamTemplateSourceService {
  async getSnapshot(): Promise<TeamTemplateSourcesSnapshot> {
    const sources = await this.readSources();
    const templates = sources.filter((source) => source.enabled).flatMap(scanSourceTemplates);
    return { sources, templates };
  }

  async saveSources(rawSources: unknown): Promise<TeamTemplateSourcesSnapshot> {
    if (!Array.isArray(rawSources)) {
      throw new Error('sources must be an array');
    }
    const sources = dedupeSources(rawSources.map(normalizeSource).filter(isTemplateSource));
    await fs.promises.mkdir(getTemplateDataRoot(), { recursive: true });
    await atomicWriteAsync(getSourcesConfigPath(), `${JSON.stringify({ sources }, null, 2)}\n`);
    return this.getSnapshot();
  }

  async refreshSources(): Promise<TeamTemplateSourcesSnapshot> {
    const sources = await this.readSources();
    const nextSources: TeamTemplateSource[] = [];
    await fs.promises.mkdir(path.join(getTemplateDataRoot(), 'repos'), { recursive: true });
    for (const source of sources) {
      if (!source.enabled) {
        nextSources.push(source);
        continue;
      }
      try {
        await this.syncSource(source);
        nextSources.push({
          ...source,
          lastSyncedAt: new Date().toISOString(),
          lastError: undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to refresh team template source ${source.id}: ${message}`);
        nextSources.push({ ...source, lastError: message });
      }
    }
    await this.writeSources(nextSources);
    return this.getSnapshot();
  }

  private async readSources(): Promise<TeamTemplateSource[]> {
    try {
      const raw = await fs.promises.readFile(getSourcesConfigPath(), 'utf8');
      const parsed = JSON.parse(raw) as { sources?: unknown };
      const sources = Array.isArray(parsed.sources)
        ? parsed.sources.map(normalizeSource).filter(isTemplateSource)
        : [];
      return dedupeSources(sources);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Failed to read team template sources: ${String(error)}`);
      }
      return [DEFAULT_SOURCE];
    }
  }

  private async writeSources(sources: TeamTemplateSource[]): Promise<void> {
    await fs.promises.mkdir(getTemplateDataRoot(), { recursive: true });
    await atomicWriteAsync(
      getSourcesConfigPath(),
      `${JSON.stringify({ sources: dedupeSources(sources) }, null, 2)}\n`
    );
  }

  private async syncSource(source: TeamTemplateSource): Promise<void> {
    const checkoutPath = sourceCheckoutPath(source.id);
    if (!fs.existsSync(path.join(checkoutPath, '.git'))) {
      await fs.promises.rm(checkoutPath, { recursive: true, force: true }).catch(() => undefined);
      const args = ['clone', '--depth', '1'];
      if (source.branch) {
        args.push('--branch', source.branch);
      }
      args.push(source.url, checkoutPath);
      await execGit(args);
      return;
    }
    await execGit(['fetch', '--depth', '1', 'origin'], checkoutPath);
    await execGit(
      ['reset', '--hard', source.branch ? `origin/${source.branch}` : 'origin/HEAD'],
      checkoutPath
    );
  }
}

let singleton: TeamTemplateSourceService | null = null;

export function getTeamTemplateSourceService(): TeamTemplateSourceService {
  singleton ??= new TeamTemplateSourceService();
  return singleton;
}
