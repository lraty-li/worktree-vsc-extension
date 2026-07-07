'use strict';

const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class WorktreeOperationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorktreeOperationError';
  }
}

class GitWorktreeService {
  constructor(options = {}) {
    this.execFileAsync = options.execFileAsync ?? execFileAsync;
    this.mkdirAsync = options.mkdirAsync ?? fs.mkdir;
    this.accessAsync = options.accessAsync ?? fs.access;
  }

  async createManagedWorktree(workingDirectory, options) {
    const workspaceContext = await this.resolveWorkspaceContext(workingDirectory);
    const repositoryRoot = workspaceContext.hostRepositoryRoot;
    const branch = options.branch.trim();
    const baseBranch = options.baseBranch.trim();

    await this.ensureValidBranchName(repositoryRoot, branch);
    await this.ensureLocalBranchExists(repositoryRoot, baseBranch, 'base branch does not exist');

    const targetPath = worktreePathForBranch(repositoryRoot, branch);
    const branchExists = await this.localBranchExists(repositoryRoot, branch);
    if (branchExists) {
      throw new WorktreeOperationError(`branch already exists: ${branch}`);
    }

    if (await this.pathExists(targetPath)) {
      throw new WorktreeOperationError(`target path already exists: ${targetPath}`);
    }

    await this.mkdirAsync(path.dirname(targetPath), { recursive: true });
    await this.runGit(repositoryRoot, ['worktree', 'add', '-b', branch, targetPath, baseBranch]);

    return {
      branch,
      path: targetPath,
      repositoryRoot
    };
  }

  async listManagedWorktrees(workingDirectory) {
    const workspaceContext = await this.resolveWorkspaceContext(workingDirectory);
    const repositoryRoot = workspaceContext.hostRepositoryRoot;
    return this.listManagedWorktreesFromRepositoryRoot(repositoryRoot);
  }

  async deleteManagedWorktree(workingDirectory, options) {
    const workspaceContext = await this.resolveWorkspaceContext(workingDirectory);
    const repositoryRoot = workspaceContext.hostRepositoryRoot;
    const worktrees = await this.listManagedWorktreesFromRepositoryRoot(repositoryRoot);
    const target = worktrees.find((worktree) => worktree.branch === options.branch);

    if (!target) {
      throw new WorktreeOperationError(`managed worktree does not exist for branch: ${options.branch}`);
    }

    await this.runGit(repositoryRoot, ['worktree', 'remove', target.path]);

    const branchExists = await this.localBranchExists(repositoryRoot, target.branch);
    if (!branchExists) {
      return {
        branch: target.branch,
        path: target.path,
        branchDeleted: false
      };
    }

    const deleteBranchResult = await this.runGitAllowFailure(repositoryRoot, ['branch', '-d', target.branch]);
    if (!deleteBranchResult.success) {
      return {
        branch: target.branch,
        path: target.path,
        branchDeleted: false,
        warningMessage: `worktree 已删除，但本地分支未删除。请检查是否已合并: ${target.branch}`
      };
    }

    return {
      branch: target.branch,
      path: target.path,
      branchDeleted: true
    };
  }

  async resolveRepositoryRoot(workingDirectory) {
    const result = await this.runGit(workingDirectory, ['rev-parse', '--show-toplevel']);
    return result.stdout.trim();
  }

  async resolveWorkspaceContext(workingDirectory) {
    const result = await this.runGit(workingDirectory, [
      'rev-parse',
      '--show-toplevel',
      '--absolute-git-dir',
      '--git-common-dir'
    ]);
    const [repositoryRootLine = '', absoluteGitDirLine = '', commonGitDirLine = ''] = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0);

    const repositoryRoot = repositoryRootLine.trim();
    const absoluteGitDir = absoluteGitDirLine.trim();
    const commonGitDir = path.resolve(workingDirectory, commonGitDirLine.trim());
    const isMainWorktree = path.resolve(absoluteGitDir) === commonGitDir;
    const hostRepositoryRoot = isMainWorktree ? repositoryRoot : path.dirname(commonGitDir);

    return {
      repositoryRoot,
      hostRepositoryRoot,
      absoluteGitDir: path.resolve(absoluteGitDir),
      commonGitDir,
      isMainWorktree
    };
  }

  async listManagedWorktreesFromRepositoryRoot(repositoryRoot) {
    const result = await this.runGit(repositoryRoot, ['worktree', 'list', '--porcelain']);
    return parseManagedWorktrees(result.stdout, repositoryRoot);
  }

  async ensureValidBranchName(repositoryRoot, branch) {
    if (branch.length === 0) {
      throw new WorktreeOperationError('branch name is required.');
    }

    const validation = await this.runGitAllowFailure(repositoryRoot, ['check-ref-format', '--branch', branch]);
    if (!validation.success) {
      throw new WorktreeOperationError(`invalid branch name: ${branch}`);
    }
  }

  async ensureLocalBranchExists(repositoryRoot, branch, prefix) {
    const exists = await this.localBranchExists(repositoryRoot, branch);
    if (!exists) {
      throw new WorktreeOperationError(`${prefix}: ${branch}`);
    }
  }

  async localBranchExists(repositoryRoot, branch) {
    const result = await this.runGitAllowFailure(repositoryRoot, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`
    ]);
    return result.success;
  }

  async pathExists(targetPath) {
    try {
      await this.accessAsync(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async runGit(workingDirectory, args) {
    const result = await this.runGitAllowFailure(workingDirectory, args);
    if (!result.success) {
      throw new WorktreeOperationError(result.message);
    }

    return result;
  }

  async runGitAllowFailure(workingDirectory, args) {
    try {
      const result = await this.execFileAsync('git', args, {
        cwd: workingDirectory,
        env: process.env,
        maxBuffer: 1024 * 1024
      });
      return {
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
        message: ''
      };
    } catch (error) {
      return {
        success: false,
        stdout: typeof error.stdout === 'string' ? error.stdout : '',
        stderr: typeof error.stderr === 'string' ? error.stderr : '',
        message: normalizeGitError(error, args)
      };
    }
  }
}

function parseManagedWorktrees(porcelainOutput, repositoryRoot) {
  const lines = porcelainOutput.split(/\r?\n/);
  const records = [];
  let currentPath = '';
  let currentBranch = '';

  for (const line of lines) {
    if (line.length === 0) {
      pushManagedRecord(records, repositoryRoot, currentPath, currentBranch);
      currentPath = '';
      currentBranch = '';
      continue;
    }

    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
      continue;
    }

    if (line.startsWith('branch refs/heads/')) {
      currentBranch = line.slice('branch refs/heads/'.length);
    }
  }

  pushManagedRecord(records, repositoryRoot, currentPath, currentBranch);
  return records;
}

function pushManagedRecord(records, repositoryRoot, worktreePath, branch) {
  if (worktreePath.length === 0 || branch.length === 0) {
    return;
  }

  if (path.resolve(worktreePath) !== path.resolve(worktreePathForBranch(repositoryRoot, branch))) {
    return;
  }

  records.push({
    branch,
    path: worktreePath,
    repositoryRoot
  });
}

function worktreePathForBranch(repositoryRoot, branch) {
  return path.join(path.dirname(repositoryRoot), branch);
}

function normalizeGitError(error, args) {
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
  if (stderr.length > 0) {
    return stderr;
  }

  if (stdout.length > 0) {
    return stdout;
  }

  const joinedArgs = args.join(' ');
  return error instanceof Error ? error.message : `git ${joinedArgs} failed`;
}

module.exports = {
  GitWorktreeService,
  WorktreeOperationError,
  parseManagedWorktrees,
  worktreePathForBranch
};
