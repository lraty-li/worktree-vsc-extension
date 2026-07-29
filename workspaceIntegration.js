'use strict';

const path = require('path');

const NEW_TERMINAL_WITH_CWD_COMMAND = 'workbench.action.terminal.newWithCwd';

class WorkspaceIntegrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkspaceIntegrationError';
  }
}

class WorktreeWorkspaceIntegration {
  constructor(options) {
    this.workspace = options.workspace;
    this.commands = options.commands;
    this.uri = options.uri;
  }

  async integrateCreatedWorktree(folderPath, options) {
    const targetPath = path.resolve(folderPath);

    try {
      if (options.openTerminal) {
        await this.commands.executeCommand(NEW_TERMINAL_WITH_CWD_COMMAND, {
          cwd: targetPath
        });
      }
    } finally {
      // 单目录切换为多目录 workspace 会重启扩展宿主，因此目录变更必须是最后一步。
      this.addWorkspaceFolderIfNeeded(targetPath);
    }
  }

  addWorkspaceFolderIfNeeded(folderPath) {
    const targetPath = path.resolve(folderPath);
    const folders = this.workspace.workspaceFolders ?? [];
    const alreadyOpen = folders.some(
      (folder) => path.resolve(folder.uri.fsPath) === targetPath
    );
    if (alreadyOpen) {
      return;
    }

    const updateStarted = this.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri: this.uri.file(targetPath),
      name: path.basename(targetPath)
    });
    if (!updateStarted) {
      throw new WorkspaceIntegrationError(`VS Code 拒绝加入工作区目录: ${targetPath}`);
    }
  }

  removeWorkspaceFolderIfPresent(folderPath) {
    const targetPath = path.resolve(folderPath);
    const folders = this.workspace.workspaceFolders ?? [];
    const index = folders.findIndex(
      (folder) => path.resolve(folder.uri.fsPath) === targetPath
    );
    if (index < 0) {
      return;
    }

    const updateStarted = this.workspace.updateWorkspaceFolders(index, 1);
    if (!updateStarted) {
      throw new WorkspaceIntegrationError(`VS Code 拒绝移除工作区目录: ${targetPath}`);
    }
  }
}

module.exports = {
  NEW_TERMINAL_WITH_CWD_COMMAND,
  WorkspaceIntegrationError,
  WorktreeWorkspaceIntegration
};
