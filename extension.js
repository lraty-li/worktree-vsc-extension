'use strict';

const path = require('path');
const vscode = require('vscode');
const { GitWorktreeService } = require('./worktreeService');
const { WorktreeWorkspaceIntegration } = require('./workspaceIntegration');

const service = new GitWorktreeService();
const workspaceIntegration = new WorktreeWorkspaceIntegration({
  workspace: vscode.workspace,
  commands: vscode.commands,
  uri: vscode.Uri
});

class WorktreeCommandError extends Error {
  constructor(title, cause) {
    super(errorMessage(cause));
    this.name = 'WorktreeCommandError';
    this.title = title;
    this.cause = cause;
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitWorktree.create', async () => {
      await runCommand(createWorktree, '创建 worktree 失败');
    }),
    vscode.commands.registerCommand('gitWorktree.delete', async () => {
      await runCommand(deleteWorktree, '删除 worktree 失败');
    })
  );
}

function deactivate() {}

async function runCommand(command, fallbackErrorTitle) {
  try {
    await command();
  } catch (error) {
    if (error instanceof WorktreeCommandError) {
      showOperationError(error.title, error.cause);
      return;
    }

    showOperationError(fallbackErrorTitle, error);
  }
}

async function createWorktree() {
  const repositoryTarget = await pickRepositoryTarget();
  if (!repositoryTarget) {
    return;
  }

  const branch = await promptBranchName();

  if (!branch) {
    return;
  }

  const baseBranch = getBaseBranch(repositoryTarget.workspaceFolder);
  const createdWorktree = await service.createManagedWorktree(repositoryTarget.repositoryPath, {
    branch,
    baseBranch
  });

  try {
    await workspaceIntegration.integrateCreatedWorktree(createdWorktree.path, {
      openTerminal: shouldOpenTerminalAfterCreate(repositoryTarget.workspaceFolder)
    });
  } catch (error) {
    throw new WorktreeCommandError('worktree 已创建，但工作区集成失败', error);
  }
}

async function deleteWorktree() {
  const repositoryTarget = await pickRepositoryTarget();
  if (!repositoryTarget) {
    return;
  }

  const worktrees = await service.listManagedWorktrees(repositoryTarget.repositoryPath);
  if (worktrees.length === 0) {
    return;
  }

  const picked = await promptManagedWorktree(worktrees);

  if (!picked) {
    return;
  }

  if (!(await confirmDeleteWorktree(picked.worktree))) {
    return;
  }

  const deleteResult = await service.deleteManagedWorktree(repositoryTarget.repositoryPath, {
    branch: picked.worktree.branch
  });

  workspaceIntegration.removeWorkspaceFolderIfPresent(deleteResult.path);

  if (deleteResult.warningMessage) {
    showTransientDeleteWarning(deleteResult.warningMessage);
  }
}

async function pickRepositoryTarget() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    throw new Error('当前没有打开任何工作区目录。');
  }

  const repositoryResolutionResults = await Promise.all(
    folders.map(async (workspaceFolder) => {
      try {
        const workspaceContext = await service.resolveWorkspaceContext(workspaceFolder.uri.fsPath);
        return {
          workspaceFolder,
          workspaceContext
        };
      } catch (error) {
        return {
          workspaceFolder,
          error
        };
      }
    })
  );
  const resolvedEntries = repositoryResolutionResults.filter(
    (result) => result.workspaceContext !== undefined
  );
  if (resolvedEntries.length === 0) {
    const details = repositoryResolutionResults
      .map(
        (result) =>
          `${result.workspaceFolder.name} (${result.workspaceFolder.uri.fsPath}): ${errorMessage(result.error)}`
      )
      .join('；');
    throw new Error(`当前工作区中没有可用的 Git 仓库目录。${details ? ` ${details}` : ''}`);
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeFolderPath = activeUri
    ? vscode.workspace.getWorkspaceFolder(activeUri)?.uri.fsPath
    : undefined;
  const repositoryTargets = buildRepositoryTargets(resolvedEntries);

  if (repositoryTargets.length === 1) {
    return repositoryTargets[0];
  }

  if (activeFolderPath) {
    const activeTarget = resolvedEntries
      .find((entry) => entry.workspaceFolder.uri.fsPath === activeFolderPath)
      ?.workspaceContext.hostRepositoryRoot;
    if (activeTarget) {
      const matchedTarget = repositoryTargets.find(
        (repositoryTarget) => repositoryTarget.repositoryPath === activeTarget
      );
      if (matchedTarget) {
        return matchedTarget;
      }
    }
  }

  const picked = await vscode.window.showQuickPick(
    repositoryTargets.map((repositoryTarget) => ({
      label: repositoryTarget.workspaceFolder.name,
      description: repositoryTarget.repositoryPath,
      repositoryTarget
    })),
    {
      title: 'Git Worktree: Select Repository',
      placeHolder: '选择要操作的宿主仓库目录',
      ignoreFocusOut: true
    }
  );

  return picked?.repositoryTarget;
}

function buildRepositoryTargets(repositoryEntries) {
  const repositoryTargetMap = new Map();

  for (const repositoryEntry of repositoryEntries) {
    const repositoryPath = repositoryEntry.workspaceContext.hostRepositoryRoot;
    const existingTarget = repositoryTargetMap.get(repositoryPath);

    if (!existingTarget) {
      repositoryTargetMap.set(repositoryPath, {
        workspaceFolder: repositoryEntry.workspaceFolder,
        repositoryPath
      });
      continue;
    }

    if (repositoryEntry.workspaceContext.isMainWorktree) {
      repositoryTargetMap.set(repositoryPath, {
        workspaceFolder: repositoryEntry.workspaceFolder,
        repositoryPath
      });
    }
  }

  return [...repositoryTargetMap.values()];
}

function promptBranchName() {
  return vscode.window.showInputBox({
    title: 'Git Worktree: Create',
    prompt: '输入新的分支名',
    placeHolder: '例如 feature/avatar',
    ignoreFocusOut: true,
    validateInput(value) {
      return value.trim().length > 0 ? null : '分支名不能为空';
    }
  });
}

function promptManagedWorktree(worktrees) {
  return vscode.window.showQuickPick(
    worktrees.map((worktree) => ({
      label: worktree.branch,
      description: path.relative(path.dirname(worktree.repositoryRoot), worktree.path),
      detail: worktree.path,
      worktree
    })),
    {
      title: 'Git Worktree: Delete',
      placeHolder: '选择要删除的 worktree',
      ignoreFocusOut: true
    }
  );
}

async function confirmDeleteWorktree(worktree) {
  const decision = await vscode.window.showQuickPick(
    [
      {
        label: '确认删除',
        description: worktree.branch,
        detail: worktree.path,
        confirmed: true
      },
      {
        label: '取消',
        confirmed: false
      }
    ],
    {
      title: 'Git Worktree: Confirm Delete',
      placeHolder: `删除 ${worktree.branch}，并尝试删除对应本地分支`,
      ignoreFocusOut: true
    }
  );

  return decision?.confirmed === true;
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

function logOperationIssue(title, error) {
  const message = formatOperationIssue(title, error);
  console.warn(`[git-worktree] ${message}`);
}

function showOperationError(title, error) {
  const message = formatOperationIssue(title, error);
  logOperationIssue(title, error);
  void vscode.window.showErrorMessage(message, { modal: false });
}

function showTransientDeleteWarning(message) {
  logOperationIssue(message);
  void vscode.window.showWarningMessage(message, { modal: false });
}

function formatOperationIssue(title, error) {
  const suffix = errorMessage(error);
  return suffix ? `${title}: ${suffix}` : title;
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  return error ? String(error) : '';
}

module.exports = {
  activate,
  deactivate
};
