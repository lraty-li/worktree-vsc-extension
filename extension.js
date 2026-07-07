'use strict';

const path = require('path');
const vscode = require('vscode');
const {
  GitWorktreeService,
  WorktreeOperationError
} = require('./worktreeService');

const service = new GitWorktreeService();

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitWorktree.create', async () => {
      await createWorktree();
    }),
    vscode.commands.registerCommand('gitWorktree.delete', async () => {
      await deleteWorktree();
    })
  );
}

function deactivate() {}

async function createWorktree() {
  const workspaceFolder = await pickWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const branch = await vscode.window.showInputBox({
    title: 'Git Worktree: 创建',
    prompt: '输入新的分支名',
    placeHolder: '例如 feature/avatar',
    ignoreFocusOut: true,
    validateInput(value) {
      return value.trim().length > 0 ? null : '分支名不能为空';
    }
  });

  if (!branch) {
    return;
  }

  const baseBranch = getBaseBranch(workspaceFolder);

  try {
    const createdWorktree = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `创建 worktree: ${branch.trim()}`
      },
      async () =>
        service.createManagedWorktree(workspaceFolder.uri.fsPath, {
          branch,
          baseBranch
        })
    );

    addWorkspaceFolderIfNeeded(createdWorktree.path);
    openTerminalForWorktreeIfNeeded(workspaceFolder, createdWorktree);
    void vscode.window.showInformationMessage(`已创建 worktree: ${createdWorktree.branch}`);
  } catch (error) {
    showOperationError('创建 worktree 失败', error);
  }
}

async function deleteWorktree() {
  const workspaceFolder = await pickWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  try {
    const worktrees = await service.listManagedWorktrees(workspaceFolder.uri.fsPath);
    if (worktrees.length === 0) {
      void vscode.window.showInformationMessage('当前没有可删除的受管 worktree。');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      worktrees.map((worktree) => ({
        label: worktree.branch,
        description: path.relative(path.dirname(worktree.repositoryRoot), worktree.path),
        detail: worktree.path,
        worktree
      })),
      {
        title: 'Git Worktree: 删除',
        placeHolder: '选择要删除的 worktree',
        ignoreFocusOut: true
      }
    );

    if (!picked) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `删除 worktree "${picked.worktree.branch}"，并尝试删除对应本地分支？`,
      {
        modal: true,
        detail: picked.worktree.path
      },
      '删除'
    );

    if (confirm !== '删除') {
      return;
    }

    const deleteResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `删除 worktree: ${picked.worktree.branch}`
      },
      async () =>
        service.deleteManagedWorktree(workspaceFolder.uri.fsPath, {
          branch: picked.worktree.branch
        })
    );

    removeWorkspaceFolderIfPresent(deleteResult.path);

    if (deleteResult.warningMessage) {
      void vscode.window.showWarningMessage(deleteResult.warningMessage);
      return;
    }

    void vscode.window.showInformationMessage(`已删除 worktree: ${deleteResult.branch}`);
  } catch (error) {
    showOperationError('删除 worktree 失败', error);
  }
}

async function pickWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage('当前没有打开任何 workspace folder。');
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0];
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) {
      return activeFolder;
    }
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder
    })),
    {
      title: 'Git Worktree: 选择工作区目录',
      placeHolder: '选择要操作的仓库目录',
      ignoreFocusOut: true
    }
  );

  return picked?.folder;
}

function getBaseBranch(workspaceFolder) {
  return vscode.workspace
    .getConfiguration('gitWorktree', workspaceFolder)
    .get('baseBranch', 'dev');
}

function shouldOpenTerminalAfterCreate(workspaceFolder) {
  return vscode.workspace
    .getConfiguration('gitWorktree', workspaceFolder)
    .get('openTerminalAfterCreate', true);
}

function openTerminalForWorktreeIfNeeded(workspaceFolder, createdWorktree) {
  if (!shouldOpenTerminalAfterCreate(workspaceFolder)) {
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `worktree:${createdWorktree.branch}`,
    cwd: createdWorktree.path
  });
  terminal.show(true);
}

function showOperationError(title, error) {
  const message =
    error instanceof WorktreeOperationError || error instanceof Error
      ? error.message
      : String(error);
  void vscode.window.showErrorMessage(`${title}: ${message}`);
}

function addWorkspaceFolderIfNeeded(folderPath) {
  const targetPath = path.resolve(folderPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const alreadyOpen = folders.some((folder) => path.resolve(folder.uri.fsPath) === targetPath);
  if (alreadyOpen) {
    return;
  }

  vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
    uri: vscode.Uri.file(targetPath),
    name: path.basename(targetPath)
  });
}

function removeWorkspaceFolderIfPresent(folderPath) {
  const targetPath = path.resolve(folderPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const index = folders.findIndex((folder) => path.resolve(folder.uri.fsPath) === targetPath);
  if (index < 0) {
    return;
  }

  vscode.workspace.updateWorkspaceFolders(index, 1);
}

module.exports = {
  activate,
  deactivate
};
