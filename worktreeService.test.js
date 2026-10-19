'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GitWorktreeService,
  parseManagedWorktrees,
  worktreePathForBranch
} = require('./worktreeService');

test('parseManagedWorktrees 只返回约定路径的 worktree', () => {
  const repositoryRoot = '/repo/picslab';
  const porcelain = [
    'worktree /repo/picslab',
    'HEAD 111',
    'branch refs/heads/dev',
    '',
    'worktree /repo/feature/a',
    'HEAD 222',
    'branch refs/heads/feature/a',
    '',
    'worktree /repo/random-main',
    'HEAD 333',
    'branch refs/heads/main',
    '',
    'worktree /repo/feature/b',
    'HEAD 444',
    'branch refs/heads/feature/b',
    ''
  ].join('\n');

  assert.deepEqual(parseManagedWorktrees(porcelain, repositoryRoot), [
    {
      branch: 'feature/a',
      path: '/repo/feature/a',
      repositoryRoot
    },
    {
      branch: 'feature/b',
      path: '/repo/feature/b',
      repositoryRoot
    }
  ]);
});

test('worktreePathForBranch 使用仓库同级目录', () => {
  assert.equal(worktreePathForBranch('/repo/picslab', 'feature/avatar'), '/repo/feature/avatar');
});

test('createManagedWorktree 执行预期的 git 流程', async () => {
  const executedCommands = [];
  const createdDirectories = [];

  const service = new GitWorktreeService({
    execFileAsync: async (command, args, options) => {
      executedCommands.push({ command, args, cwd: options.cwd });

      if (args[0] === 'rev-parse') {
        return {
          stdout: ['/repo/picslab', '/repo/picslab/.git', '.git', ''].join('\n'),
          stderr: ''
        };
      }

      if (args[0] === 'check-ref-format') {
        return { stdout: '', stderr: '' };
      }

      if (args[0] === 'show-ref' && args[3] === 'refs/heads/dev') {
        return { stdout: '', stderr: '' };
      }

      if (args[0] === 'show-ref' && args[3] === 'refs/heads/feature/avatar') {
        const error = new Error('missing');
        error.stdout = '';
        error.stderr = '';
        throw error;
      }

      if (args[0] === 'worktree' && args[1] === 'add') {
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected git args: ${args.join(' ')}`);
    },
    mkdirAsync: async (targetPath, options) => {
      createdDirectories.push({ targetPath, options });
    },
    accessAsync: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
  });

  const createdWorktree = await service.createManagedWorktree('/repo/picslab', {
    branch: 'feature/avatar',
    baseBranch: 'dev'
  });

  assert.deepEqual(createdDirectories, [
    {
      targetPath: '/repo/feature',
      options: { recursive: true }
    }
  ]);

  assert.deepEqual(executedCommands, [
    {
      command: 'git',
      args: ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['check-ref-format', '--branch', 'feature/avatar'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['show-ref', '--verify', '--quiet', 'refs/heads/dev'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['show-ref', '--verify', '--quiet', 'refs/heads/feature/avatar'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['worktree', 'add', '-b', 'feature/avatar', '/repo/feature/avatar', 'dev'],
      cwd: '/repo/picslab'
    }
  ]);

  assert.deepEqual(createdWorktree, {
    branch: 'feature/avatar',
    path: '/repo/feature/avatar',
    repositoryRoot: '/repo/picslab'
  });
});

test('listLocalBranches 从宿主仓库返回按名称排序的本地分支', async () => {
  const service = new GitWorktreeService({
    execFileAsync: async (command, args, options) => {
      assert.equal(command, 'git');

      if (args[0] === 'rev-parse') {
        assert.deepEqual(args, [
          'rev-parse',
          '--show-toplevel',
          '--absolute-git-dir',
          '--git-common-dir'
        ]);
        assert.equal(options.cwd, '/repo/feature/avatar');
        return {
          stdout: ['/repo/feature/avatar', '/repo/app/.git/worktrees/feature-avatar', '/repo/app/.git', ''].join(
            '\n'
          ),
          stderr: ''
        };
      }

      assert.deepEqual(args, [
        'for-each-ref',
        '--format=%(refname:short)',
        '--sort=refname',
        'refs/heads'
      ]);
      assert.equal(options.cwd, '/repo/app');
      return {
        stdout: ['feature/avatar', 'main', 'release/1.0', ''].join('\n'),
        stderr: ''
      };
    }
  });

  const branches = await service.listLocalBranches('/repo/feature/avatar');

  assert.deepEqual(branches, ['feature/avatar', 'main', 'release/1.0']);
});

test('deleteManagedWorktree 在分支删除失败时返回 warning', async () => {
  const executedCommands = [];

  const service = new GitWorktreeService({
    execFileAsync: async (command, args, options) => {
      executedCommands.push({ command, args, cwd: options.cwd });

      if (args[0] === 'rev-parse') {
        return {
          stdout: ['/repo/picslab', '/repo/picslab/.git', '.git', ''].join('\n'),
          stderr: ''
        };
      }

      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          stdout: [
            'worktree /repo/picslab',
            'HEAD 000',
            'branch refs/heads/dev',
            '',
            'worktree /repo/feature/avatar',
            'HEAD 111',
            'branch refs/heads/feature/avatar',
            ''
          ].join('\n'),
          stderr: ''
        };
      }

      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { stdout: '', stderr: '' };
      }

      if (args[0] === 'show-ref' && args[3] === 'refs/heads/feature/avatar') {
        return { stdout: '', stderr: '' };
      }

      if (args[0] === 'branch' && args[1] === '-d') {
        const error = new Error('not merged');
        error.stdout = '';
        error.stderr = 'error: not merged';
        throw error;
      }

      throw new Error(`unexpected git args: ${args.join(' ')}`);
    }
  });

  const deleteResult = await service.deleteManagedWorktree('/repo/picslab', {
    branch: 'feature/avatar'
  });

  assert.deepEqual(executedCommands, [
    {
      command: 'git',
      args: ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['worktree', 'list', '--porcelain'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['worktree', 'remove', '/repo/feature/avatar'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['show-ref', '--verify', '--quiet', 'refs/heads/feature/avatar'],
      cwd: '/repo/picslab'
    },
    {
      command: 'git',
      args: ['branch', '-d', 'feature/avatar'],
      cwd: '/repo/picslab'
    }
  ]);

  assert.deepEqual(deleteResult, {
    branch: 'feature/avatar',
    path: '/repo/feature/avatar',
    branchDeleted: false,
    warningMessage: 'worktree 已删除，但本地分支未删除。请检查是否已合并: feature/avatar'
  });
});

test('resolveWorkspaceContext 能识别链接 worktree 并回到宿主仓库', async () => {
  const service = new GitWorktreeService({
    execFileAsync: async (command, args, options) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
      assert.equal(options.cwd, '/repo/feature/avatar');
      return {
        stdout: ['/repo/feature/avatar', '/repo/app/.git/worktrees/feature-avatar', '/repo/app/.git', ''].join(
          '\n'
        ),
        stderr: ''
      };
    }
  });

  const workspaceContext = await service.resolveWorkspaceContext('/repo/feature/avatar');

  assert.deepEqual(workspaceContext, {
    repositoryRoot: '/repo/feature/avatar',
    hostRepositoryRoot: '/repo/app',
    absoluteGitDir: '/repo/app/.git/worktrees/feature-avatar',
    commonGitDir: '/repo/app/.git',
    isMainWorktree: false
  });
});

test('listManagedWorktrees 从链接 worktree 触发时使用宿主仓库根目录', async () => {
  const executedCommands = [];

  const service = new GitWorktreeService({
    execFileAsync: async (command, args, options) => {
      executedCommands.push({ command, args, cwd: options.cwd });

      if (args[0] === 'rev-parse') {
        return {
          stdout: ['/repo/feature/avatar', '/repo/app/.git/worktrees/feature-avatar', '/repo/app/.git', ''].join(
            '\n'
          ),
          stderr: ''
        };
      }

      if (args[0] === 'worktree' && args[1] === 'list') {
        assert.equal(options.cwd, '/repo/app');
        return {
          stdout: [
            'worktree /repo/app',
            'HEAD 111',
            'branch refs/heads/dev',
            '',
            'worktree /repo/feature/avatar',
            'HEAD 222',
            'branch refs/heads/feature/avatar',
            ''
          ].join('\n'),
          stderr: ''
        };
      }

      throw new Error(`unexpected git args: ${args.join(' ')}`);
    }
  });

  const worktrees = await service.listManagedWorktrees('/repo/feature/avatar');

  assert.deepEqual(executedCommands, [
    {
      command: 'git',
      args: ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
      cwd: '/repo/feature/avatar'
    },
    {
      command: 'git',
      args: ['worktree', 'list', '--porcelain'],
      cwd: '/repo/app'
    }
  ]);

  assert.deepEqual(worktrees, [
    {
      branch: 'feature/avatar',
      path: '/repo/feature/avatar',
      repositoryRoot: '/repo/app'
    }
  ]);
});
