import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { SKILL_ROOT_DEFINITIONS } from '@shared/utils/skillRoots';

import type { SkillRootKind, SkillScope } from '@shared/types/extensions';

export interface ResolvedSkillRoot {
  scope: SkillScope;
  rootKind: SkillRootKind;
  projectRoot: string | null;
  rootPath: string;
}

const USER_CANONICAL_ROOT = SKILL_ROOT_DEFINITIONS.find(
  (definition) => definition.rootKind === 'hermit'
)!;
const PROJECT_RUNTIME_ROOTS = SKILL_ROOT_DEFINITIONS.filter(
  (definition) => definition.rootKind !== 'hermit'
);

export class SkillRootsResolver {
  resolve(projectPath?: string): ResolvedSkillRoot[] {
    const roots: ResolvedSkillRoot[] = [];
    const homeDir = getHomeDir();

    roots.push({
      scope: 'user',
      rootKind: USER_CANONICAL_ROOT.rootKind,
      projectRoot: null,
      rootPath: path.join(homeDir, ...USER_CANONICAL_ROOT.segments),
    });

    if (projectPath) {
      for (const def of PROJECT_RUNTIME_ROOTS) {
        roots.push({
          scope: 'project',
          rootKind: def.rootKind,
          projectRoot: projectPath,
          rootPath: path.join(projectPath, ...def.segments),
        });
      }
    }

    return roots;
  }
}
