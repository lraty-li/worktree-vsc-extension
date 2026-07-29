'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NEW_TERMINAL_WITH_CWD_COMMAND,
  WorkspaceIntegrationError,
  WorktreeWorkspaceIntegration
} = require('./workspaceIntegration');

test('integrateCreatedWorktree 在切换 workspace 前创建标准用户终端', async () => {
  const terminalState = {
    ready: false,
    request: undefined
  };
  const workspaceState = {
    folders: [
      {
        uri: {
          fsPath: '/repo/app'
        },
        name: 'app'
      }
    ],
    terminalWasReadyWhenUpdated: undefined
  };
  const workspace = {
    get workspaceFolders() {
      return workspaceState.folders;
    },
    updateWorkspaceFolders(start, deleteCount, folder) {
      workspaceState.terminalWasReadyWhenUpdated = terminalState.ready;
      workspaceState.folders.splice(start, deleteCount, folder);
      return true;
    }
  };
  const commands = {
    async executeCommand(command, args) {
      terminalState.request = {
        command,
        args
      };
      terminalState.ready = true;
    }
  };
  const integration = new WorktreeWorkspaceIntegration({
    workspace,
    commands,
    uri: {
      file(fsPath) {
        return { fsPath };
      }
    }
  });

  await integration.integrateCreatedWorktree('/repo/feature/../feature/avatar', {
    openTerminal: true
  });

  assert.deepEqual(terminalState.request, {
    command: NEW_TERMINAL_WITH_CWD_COMMAND,
    args: {
      cwd: '/repo/feature/avatar'
    }
  });
  assert.equal(workspaceState.terminalWasReadyWhenUpdated, true);
  assert.deepEqual(workspaceState.folders, [
    {
      uri: {
        fsPath: '/repo/app'
      },
      name: 'app'
    },
    {
      uri: {
        fsPath: '/repo/feature/avatar'
      },
      name: 'avatar'
    }
  ]);
});

test('integrateCreatedWorktree 即使终端创建失败也会加入 workspace', async () => {
  const workspaceState = {
    folders: [
      {
        uri: {
          fsPath: '/repo/app'
        },
        name: 'app'
      }
    ]
  };
  const terminalError = new Error('terminal unavailable');
  const integration = new WorktreeWorkspaceIntegration({
    workspace: {
      get workspaceFolders() {
        return workspaceState.folders;
      },
      updateWorkspaceFolders(start, deleteCount, folder) {
        workspaceState.folders.splice(start, deleteCount, folder);
        return true;
      }
    },
    commands: {
      async executeCommand() {
        throw terminalError;
      }
    },
    uri: {
      file(fsPath) {
        return { fsPath };
      }
    }
  });

  await assert.rejects(
    integration.integrateCreatedWorktree('/repo/feature/avatar', {
      openTerminal: true
    }),
    terminalError
  );
  assert.deepEqual(workspaceState.folders.at(-1), {
    uri: {
      fsPath: '/repo/feature/avatar'
    },
    name: 'avatar'
  });
});

test('工作区拒绝目录变更时返回明确错误', async () => {
  const integration = new WorktreeWorkspaceIntegration({
    workspace: {
      workspaceFolders: [],
      updateWorkspaceFolders() {
        return false;
      }
    },
    commands: {
      async executeCommand() {}
    },
    uri: {
      file(fsPath) {
        return { fsPath };
      }
    }
  });

  await assert.rejects(
    integration.integrateCreatedWorktree('/repo/feature/avatar', {
      openTerminal: false
    }),
    (error) =>
      error instanceof WorkspaceIntegrationError &&
      error.message === 'VS Code 拒绝加入工作区目录: /repo/feature/avatar'
  );
});
