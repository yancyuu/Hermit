import { formatProjectPath } from '@renderer/utils/pathDisplay';
import { normalizePath, type TaskStatusCounts } from '@renderer/utils/pathNormalize';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { sortDashboardProviderIds } from '../utils/projectDecorations';

import type { DashboardRecentProject } from '@features/recent-projects/contracts';
import type { TeamSummary } from '@shared/types';

export interface RecentProjectCardModel {
  id: string;
  project: DashboardRecentProject;
  name: string;
  formattedPath: string;
  lastActivityLabel: string;
  providerIds: DashboardRecentProject['providerIds'];
  primaryBranch?: string;
  taskCounts?: TaskStatusCounts;
  tasksLoading: boolean;
  activeTeams?: TeamSummary[];
  additionalPathCount: number;
  pathSummary?: {
    badgeLabel: string;
    description: string;
    paths: {
      label: string;
      fullPath: string;
    }[];
  };
}

interface RecentProjectsSectionAdapterInput {
  projects: DashboardRecentProject[];
  taskCountsByProject: Map<string, TaskStatusCounts>;
  activeTeamsByProject: Map<string, TeamSummary[]>;
  tasksLoading: boolean;
}

function sumTaskCounts(
  project: DashboardRecentProject,
  taskCountsByProject: Map<string, TaskStatusCounts>
): TaskStatusCounts | undefined {
  const total = project.associatedPaths.reduce<TaskStatusCounts>(
    (counts, currentPath) => {
      const next = taskCountsByProject.get(normalizePath(currentPath));
      if (!next) {
        return counts;
      }

      return {
        pending: counts.pending + next.pending,
        inProgress: counts.inProgress + next.inProgress,
        completed: counts.completed + next.completed,
      };
    },
    { pending: 0, inProgress: 0, completed: 0 }
  );

  return total.pending > 0 || total.inProgress > 0 || total.completed > 0 ? total : undefined;
}

function collectActiveTeams(
  project: DashboardRecentProject,
  activeTeamsByProject: Map<string, TeamSummary[]>
): TeamSummary[] | undefined {
  const seen = new Set<string>();
  const activeTeams: TeamSummary[] = [];

  for (const projectPath of project.associatedPaths) {
    const teams = activeTeamsByProject.get(normalizePath(projectPath));
    if (!teams) {
      continue;
    }

    for (const team of teams) {
      if (seen.has(team.teamName)) {
        continue;
      }

      seen.add(team.teamName);
      activeTeams.push(team);
    }
  }

  return activeTeams.length > 0 ? activeTeams : undefined;
}

function buildPathSummary(
  project: DashboardRecentProject
): RecentProjectCardModel['pathSummary'] | undefined {
  const orderedPaths = [project.primaryPath, ...project.associatedPaths].filter(Boolean);
  const uniquePaths = Array.from(new Set(orderedPaths));

  if (uniquePaths.length <= 1) {
    return undefined;
  }

  return {
    badgeLabel: `${uniquePaths.length} 个路径`,
    description: '此卡片合并了相关 worktree 和项目路径的最近活动。',
    paths: uniquePaths.map((fullPath, index) => ({
      label: index === 0 ? '主路径' : `相关路径 ${index}`,
      fullPath,
    })),
  };
}

export function adaptRecentProjectsSection({
  projects,
  taskCountsByProject,
  activeTeamsByProject,
  tasksLoading,
}: RecentProjectsSectionAdapterInput): RecentProjectCardModel[] {
  return projects.map((project) => ({
    id: project.id,
    project,
    name: project.name,
    formattedPath: formatProjectPath(project.primaryPath),
    lastActivityLabel: formatDistanceToNow(new Date(project.mostRecentActivity), {
      addSuffix: true,
      locale: zhCN,
    }),
    providerIds: sortDashboardProviderIds(project.providerIds),
    primaryBranch: project.primaryBranch,
    taskCounts: sumTaskCounts(project, taskCountsByProject),
    tasksLoading,
    activeTeams: collectActiveTeams(project, activeTeamsByProject),
    additionalPathCount: Math.max(0, project.associatedPaths.length - 1),
    pathSummary: buildPathSummary(project),
  }));
}
