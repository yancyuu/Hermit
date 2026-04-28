import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  claudeRoot: '',
}));

vi.mock('@main/utils/pathDecoder', () => ({
  getClaudeBasePath: () => hoisted.claudeRoot,
}));

import { TeamMemberWorktreeManager } from '../../../../src/main/services/team/TeamMemberWorktreeManager';

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim()));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'member'
  );
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

async function createGitRepo(root: string): Promise<string> {
  const repoPath = path.join(root, 'repo');
  await fs.mkdir(repoPath, { recursive: true });
  await execGit(['init'], repoPath);
  await fs.writeFile(path.join(repoPath, 'README.md'), 'test repo\n', 'utf8');
  await execGit(['add', 'README.md'], repoPath);
  await execGit(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], repoPath);
  return await fs.realpath(repoPath);
}

describe('TeamMemberWorktreeManager', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'team-member-worktree-'));
    hoisted.claudeRoot = path.join(tempRoot, 'claude');
    await fs.mkdir(hoisted.claudeRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('creates deterministic member worktrees on agent-teams branches', async () => {
    const repoPath = await createGitRepo(tempRoot);
    const manager = new TeamMemberWorktreeManager();

    const resolution = await manager.ensureMemberWorktree({
      teamName: 'Atlas HQ',
      memberName: 'Bob',
      baseCwd: repoPath,
    });

    expect(resolution.baseRepoPath).toBe(repoPath);
    expect(resolution.branchName).toBe(`agent-teams/atlas-hq/bob-${shortHash(repoPath)}`);
    expect(resolution.worktreePath).toBe(
      path.join(hoisted.claudeRoot, 'team-worktrees', shortHash(repoPath), 'atlas-hq', 'bob')
    );
    await expect(execGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolution.worktreePath)).resolves.toBe(
      resolution.branchName
    );
  });

  it('rejects an existing deterministic path checked out on the wrong branch', async () => {
    const repoPath = await createGitRepo(tempRoot);
    const wrongPath = path.join(
      hoisted.claudeRoot,
      'team-worktrees',
      shortHash(repoPath),
      slugify('Atlas HQ'),
      slugify('Bob')
    );
    await fs.mkdir(path.dirname(wrongPath), { recursive: true });
    await execGit(['worktree', 'add', '-b', 'some-other-branch', wrongPath, 'HEAD'], repoPath);

    await expect(
      new TeamMemberWorktreeManager().ensureMemberWorktree({
        teamName: 'Atlas HQ',
        memberName: 'Bob',
        baseCwd: repoPath,
      })
    ).rejects.toThrow('expected "agent-teams/atlas-hq/bob-');
  });
});
