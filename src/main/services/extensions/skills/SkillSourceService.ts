import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getAppDataPath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import { execFile } from 'child_process';

import { SkillProjectionService } from './SkillProjectionService';
import { SkillRootsResolver } from './SkillRootsResolver';

import type { SkillSource, SkillSourcesSnapshot } from '@shared/types/extensions';

const logger = createLogger('Extensions:SkillSources');
const GIT_TIMEOUT_MS = 60_000;
const DEFAULT_SOURCES: readonly SkillSource[] = [
  {
    id: 'hermit-official',
    name: 'Hermit 官方 Skills',
    url: 'https://github.com/yancyuu/HermitSkills',
    enabled: true,
    branch: 'main',
    skillsPath: 'skills',
  },
  {
    id: 'anthropic-official',
    name: 'Anthropic 官方 Skills',
    url: 'https://github.com/anthropics/skills.git',
    enabled: true,
    branch: 'main',
    skillsPath: 'skills',
  },
  {
    id: 'lark-cli-official',
    name: 'Lark/Feishu 官方 CLI Skills',
    url: 'https://github.com/larksuite/cli.git',
    enabled: true,
    branch: 'main',
    skillsPath: 'skills',
  },
  {
    id: 'speckit-agent-skills',
    name: 'Spec Kit Agent Skills',
    url: 'https://github.com/dceoy/speckit-agent-skills.git',
    enabled: true,
    branch: 'main',
    skillsPath: 'skills',
  },
];

function getSourcesRoot(): string {
  return path.join(getAppDataPath(), 'skill-sources');
}

function getSourcesConfigPath(): string {
  return path.join(getSourcesRoot(), 'sources.json');
}

function sourceCheckoutPath(sourceId: string): string {
  return path.join(getSourcesRoot(), 'repos', sourceId);
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

function normalizeSource(input: unknown): SkillSource | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Partial<SkillSource>;
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
    skillsPath:
      typeof row.skillsPath === 'string' && row.skillsPath.trim()
        ? row.skillsPath.trim().replace(/^\/+|\/+$/g, '')
        : undefined,
    lastSyncedAt: typeof row.lastSyncedAt === 'string' ? row.lastSyncedAt : undefined,
    lastError: typeof row.lastError === 'string' ? row.lastError : undefined,
  };
}

function dedupeSources(sources: SkillSource[]): SkillSource[] {
  const byId = new Map<string, SkillSource>();
  for (const source of sources) {
    byId.set(source.id, source);
  }
  for (const defaultSource of DEFAULT_SOURCES) {
    const existingDefault = byId.get(defaultSource.id);
    byId.set(defaultSource.id, {
      ...(existingDefault ?? defaultSource),
      name: defaultSource.name,
      url: defaultSource.url,
      branch: existingDefault?.branch ?? defaultSource.branch,
      enabled: existingDefault?.enabled ?? defaultSource.enabled,
      skillsPath: existingDefault?.skillsPath ?? defaultSource.skillsPath,
    });
  }
  return Array.from(byId.values());
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

export class SkillSourceService {
  constructor(
    private readonly rootsResolver = new SkillRootsResolver(),
    private readonly projectionService = new SkillProjectionService(rootsResolver)
  ) {}

  async getSnapshot(): Promise<SkillSourcesSnapshot> {
    return { sources: await this.readSources() };
  }

  async saveSources(rawSources: unknown): Promise<SkillSourcesSnapshot> {
    if (!Array.isArray(rawSources)) {
      throw new Error('sources must be an array');
    }
    const previousSources = await this.readSources();
    const sources = dedupeSources(
      rawSources.map(normalizeSource).filter((source): source is SkillSource => !!source)
    );
    await fs.mkdir(getSourcesRoot(), { recursive: true });
    await fs.writeFile(getSourcesConfigPath(), `${JSON.stringify({ sources }, null, 2)}\n`, 'utf8');
    await this.cleanupRemovedSources(previousSources, sources);
    return this.getSnapshot();
  }

  async refreshSources(): Promise<SkillSourcesSnapshot> {
    const sources = await this.readSources();
    const nextSources: SkillSource[] = [];
    await fs.mkdir(path.join(getSourcesRoot(), 'repos'), { recursive: true });

    for (const source of sources) {
      if (!source.enabled) {
        nextSources.push(source);
        continue;
      }
      try {
        await this.syncSource(source);
        await this.installSourceSkills(source);
        nextSources.push({
          ...source,
          lastSyncedAt: new Date().toISOString(),
          lastError: undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to refresh skill source ${source.id}: ${message}`);
        nextSources.push({ ...source, lastError: message });
      }
    }

    await fs.writeFile(
      getSourcesConfigPath(),
      `${JSON.stringify({ sources: nextSources }, null, 2)}\n`,
      'utf8'
    );
    await this.projectionService.syncGlobalSkills();
    return this.getSnapshot();
  }

  private async readSources(): Promise<SkillSource[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(getSourcesConfigPath(), 'utf8')) as {
        sources?: unknown;
      };
      const sources = Array.isArray(parsed.sources)
        ? parsed.sources.map(normalizeSource).filter((source): source is SkillSource => !!source)
        : [];
      return dedupeSources(sources);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Failed to read skill sources: ${String(error)}`);
      }
      return [...DEFAULT_SOURCES];
    }
  }

  private async syncSource(source: SkillSource): Promise<void> {
    const checkoutPath = sourceCheckoutPath(source.id);
    try {
      await fs.access(path.join(checkoutPath, '.git'));
      await execGit(['fetch', '--depth', '1', 'origin', source.branch ?? 'main'], checkoutPath);
      await execGit(['checkout', 'FETCH_HEAD'], checkoutPath);
    } catch {
      await fs.rm(checkoutPath, { recursive: true, force: true });
      const args = ['clone', '--depth', '1'];
      if (source.branch) args.push('--branch', source.branch);
      args.push(source.url, checkoutPath);
      await execGit(args);
    }
  }

  private async installSourceSkills(source: SkillSource): Promise<void> {
    const checkoutPath = sourceCheckoutPath(source.id);
    const sourceSkillsRoot = source.skillsPath
      ? path.join(checkoutPath, source.skillsPath)
      : checkoutPath;
    const targetRoot = this.getHermitUserSkillsRoot();
    await fs.mkdir(targetRoot, { recursive: true });
    const entries = await fs.readdir(sourceSkillsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillDir = path.join(sourceSkillsRoot, entry.name);
      if (!(await this.hasSkillFile(skillDir))) continue;
      const targetDir = path.join(targetRoot, entry.name);
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.cp(skillDir, targetDir, { recursive: true, force: true });
    }
  }

  private getHermitUserSkillsRoot(): string {
    const root = this.rootsResolver
      .resolve()
      .find((candidate) => candidate.scope === 'user' && candidate.rootKind === 'hermit');
    if (!root) throw new Error('Hermit user skills root is unavailable');
    return root.rootPath;
  }

  private async hasSkillFile(skillDir: string): Promise<boolean> {
    for (const name of ['SKILL.md', 'Skill.md', 'skill.md']) {
      try {
        const stat = await fs.stat(path.join(skillDir, name));
        if (stat.isFile()) return true;
      } catch {
        // ignore
      }
    }
    return false;
  }

  private async cleanupRemovedSources(
    previousSources: readonly SkillSource[],
    nextSources: readonly SkillSource[]
  ): Promise<void> {
    const nextIds = new Set(nextSources.map((source) => source.id));
    await Promise.all(
      previousSources
        .filter((source) => !nextIds.has(source.id))
        .map((source) => fs.rm(sourceCheckoutPath(source.id), { recursive: true, force: true }))
    );
  }
}
