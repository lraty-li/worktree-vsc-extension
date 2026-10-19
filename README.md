# Git Worktree Commands

提供两个 VS Code 命令：

- `Git Worktree: Create`
- `Git Worktree: Delete`

扩展内部直接执行 git worktree 命令，不依赖项目里的 shell 脚本：

- 创建时会优先从配置的基础分支切出新分支；配置的分支不存在时会展开本地分支列表供选择，然后把新 worktree 加入当前 VS Code workspace。
- 创建成功后默认会通过 VS Code 的标准终端流程新开终端，并把终端目录切到新 worktree；终端标题、运行状态和动画行为与手动新建的终端一致。
- 创建失败、仓库识别失败或工作区集成失败时，会弹出包含具体原因的错误提示；主动取消创建时不会提示错误。
- 删除时会动态读取 Git 登记的关联 worktree，通过 Quick Pick 列出主工作区以外的可删除项；没有可删除项时会提示。
- 删除失败，或 worktree 已删除但本地分支因未合并等原因未删除时，会显示自动收起的非模态提示。
- 如果当前 workspace 已经加入了多个 worktree，命令只会基于宿主仓库目录解析目标，不会把这些 worktree 当成额外候选仓库。
- 创建时仍将分支名作为仓库同级目录名；识别和删除以 Git 登记的 worktree 路径为准，切换分支、分离 HEAD 或目录名与分支名不同时仍能识别。删除后只尝试删除该 worktree 当前检出的本地分支。

配置项：

- `gitWorktree.baseBranch`
- `gitWorktree.openTerminalAfterCreate`

开发校验：

- `npm test`

打包：

- `npm run package:vsix`

安装到本机 VS Code：

- `npm run install:vsix`
- 如果要覆盖已安装版本：`npm run reinstall:vsix`

说明：

- 打包产物文件名默认是 `git-worktree-commands-0.0.7.vsix`
- `package:vsix` 使用 `npx -y @vscode/vsce package --allow-missing-repository`
- 如果你后续要发布到 Marketplace，建议再补 `LICENSE`、`repository`、`homepage` 等元数据
