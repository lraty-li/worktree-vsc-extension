# Git Worktree Commands

提供两个 VS Code 命令：

- `Git Worktree: 创建`
- `Git Worktree: 删除`

扩展内部直接执行 git worktree 命令，不依赖项目里的 shell 脚本：

- 创建时会从配置的基础分支切出新分支，并把新 worktree 加入当前 VS Code workspace。
- 创建成功后默认会自动新开一个终端，并把终端目录切到新 worktree。
- 删除时会动态读取当前仓库的受管 worktree，并通过 Quick Pick 列出可删除项。
- 受管 worktree 的判定规则与原脚本保持一致：仅管理位于“仓库目录同级、以分支名命名”的 worktree。

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

- 打包产物文件名默认是 `git-worktree-commands-0.0.2.vsix`
- `package:vsix` 使用 `npx -y @vscode/vsce package --allow-missing-repository`
- 如果你后续要发布到 Marketplace，建议再补 `LICENSE`、`repository`、`homepage` 等元数据
