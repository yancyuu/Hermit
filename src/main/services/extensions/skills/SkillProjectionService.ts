import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { SKILL_ROOT_DEFINITIONS } from '@shared/utils/skillRoots';

import { SkillRootsResolver } from './SkillRootsResolver';

import type { SkillRootKind } from '@shared/types/extensions';

const PROJECTION_TARGET_ROOT_KINDS: readonly SkillRootKind[] = [
  'claude',
  'cursor',
  'agents',
  'codex',
];

const MANIFEST_FILE = '.hermit-projection.json';

interface ProjectionManifest {
  sourceRoot: string;
  files: string[];
}

export class SkillProjectionService {
  constructor(private readonly rootsResolver = new SkillRootsResolver()) {}

  async syncGlobalSkills(): Promise<void> {
    await this.syncScope({
      sourceRoot: this.getCanonicalUserRoot(),
      targetBasePath: getHomeDir(),
    });
  }

  private getCanonicalUserRoot(): string {
    const root = this.rootsResolver
      .resolve()
      .find((candidate) => candidate.scope === 'user' && candidate.rootKind === 'hermit');
    if (!root) {
      throw new Error('Hermit user skills root is unavailable');
    }
    return root.rootPath;
  }

  private async syncScope(input: { sourceRoot: string; targetBasePath: string }): Promise<void> {
    if (!(await this.directoryExists(input.sourceRoot))) {
      return;
    }

    await Promise.all(
      PROJECTION_TARGET_ROOT_KINDS.map(async (rootKind) => {
        const targetRoot = this.getProjectionTargetRoot(input.targetBasePath, rootKind);
        await this.replaceManagedProjection(input.sourceRoot, targetRoot);
      })
    );
  }

  private getProjectionTargetRoot(basePath: string, rootKind: SkillRootKind): string {
    const definition = SKILL_ROOT_DEFINITIONS.find((candidate) => candidate.rootKind === rootKind);
    if (!definition) {
      throw new Error(`Unknown skill projection target: ${rootKind}`);
    }
    return path.join(basePath, ...definition.segments);
  }

  private async replaceManagedProjection(sourceRoot: string, targetRoot: string): Promise<void> {
    await fs.mkdir(targetRoot, { recursive: true });
    await this.removePreviousProjection(targetRoot);
    const files = await this.copyDirectoryContents(sourceRoot, targetRoot);
    await fs.writeFile(
      path.join(targetRoot, MANIFEST_FILE),
      `${JSON.stringify({ sourceRoot, files } satisfies ProjectionManifest, null, 2)}\n`,
      'utf8'
    );
  }

  private async removePreviousProjection(targetRoot: string): Promise<void> {
    const manifestPath = path.join(targetRoot, MANIFEST_FILE);
    let manifest: ProjectionManifest | null = null;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ProjectionManifest;
    } catch {
      manifest = null;
    }

    if (manifest?.files) {
      await Promise.all(
        manifest.files.map((relativePath) =>
          fs.rm(path.join(targetRoot, relativePath), { recursive: true, force: true })
        )
      );
    }
    await fs.rm(manifestPath, { force: true });
  }

  private async copyDirectoryContents(sourceRoot: string, targetRoot: string): Promise<string[]> {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
    const copied: string[] = [];

    for (const entry of entries) {
      if (entry.name === MANIFEST_FILE) {
        continue;
      }
      const sourcePath = path.join(sourceRoot, entry.name);
      const targetPath = path.join(targetRoot, entry.name);
      await fs.rm(targetPath, { recursive: true, force: true });
      await fs.cp(sourcePath, targetPath, { recursive: true, force: true, errorOnExist: false });
      copied.push(entry.name);
    }

    return copied;
  }

  private async directoryExists(targetPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(targetPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
