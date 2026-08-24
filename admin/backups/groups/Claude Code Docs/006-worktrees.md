> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 使用 worktrees 运行并行会话

> 在单独的 git worktrees 中隔离并行 Claude Code 会话，以便更改不会相互冲突。涵盖 `--worktree` 标志、子代理隔离、`.worktreeinclude`、清理和非 git VCS hooks。

[git worktree](https://git-scm.com/docs/git-worktree) 是一个单独的工作目录，具有自己的文件和分支，但与主检出共享相同的存储库历史和远程。在自己的 worktree 中运行每个 Claude Code 会话意味着一个会话中的编辑永远不会触及另一个会话中的文件，因此您可以让 Claude 在一个终端中构建功能，同时在第二个终端中修复错误。

本页涵盖 CLI 中的 worktree 隔离。下面的所有内容都假设使用 git 存储库。对于其他版本控制系统，请参阅[非 git 版本控制](#non-git-version-control)。[桌面应用](/docs/zh-CN/desktop#work-in-parallel-with-sessions)会为每个新会话自动创建一个 worktree。

Worktrees 是运行 Claude 并行的几种方式之一。它们隔离文件编辑，而[子代理](/docs/zh-CN/sub-agents)和[代理团队](/docs/zh-CN/agent-teams)协调工作本身。请参阅[并行运行代理](/docs/zh-CN/agents)来比较这些方法，或跳到[使用 worktrees 隔离子代理](#isolate-subagents-with-worktrees)以同时使用 worktrees 和子代理。

<h2 id="start-claude-in-a-worktree">
  在 worktree 中启动 Claude
</h2>

传递 `--worktree` 或 `-w` 来创建隔离的 worktree 并在其中启动 Claude。默认情况下，worktree 在您的存储库根目录下的 `.claude/worktrees/<value>/` 下创建，在名为 `worktree-<value>` 的新分支上：

```bash theme={null}
claude --worktree feature-auth
```

要将 worktrees 放在其他地方，请配置 [`WorktreeCreate` hook](#non-git-version-control)。在另一个终端中使用不同的名称再次运行该命令以启动第二个隔离会话：

```bash theme={null}
claude --worktree bugfix-123
```

如果您省略名称，Claude 会生成一个名称，例如 `bright-running-fox`：

```bash theme={null}
claude --worktree
```

您也可以在会话期间要求 Claude "在 worktree 中工作"，它将使用 [`EnterWorktree`](/docs/zh-CN/tools-reference) 工具创建一个。一旦进入 worktree，Claude 可以通过调用 `EnterWorktree` 并指定目标路径，直接切换到 `.claude/worktrees/` 下的另一个 worktree。之前的 worktree 保留在磁盘上不变。

进入存储库的 `.claude/worktrees/` 目录之外的路径首先会要求您的批准，因为它会移动会话的工作目录、写入访问权限和项目配置，例如 `CLAUDE.md` 和设置到该位置。`EnterWorktree` [权限规则](/docs/zh-CN/permissions)或选择"不再询问"不会抑制此提示；只有 `bypassPermissions` 模式会跳过它。在 v2.1.206 之前，Claude 可以进入任何现有的 worktree 路径而无需询问。

从 v2.1.198 开始，进入或退出 worktree 也会将会话记录重新定位到该目录的项目存储，与 [`/cd`](/docs/zh-CN/commands) 的方式相同，因此 `/desktop` 和 `--resume` 之后会在那里找到会话。由 [`WorktreeCreate` hook](#non-git-version-control) 创建的 Worktrees 被排除在外，并将记录保留在启动目录中。

Worktrees 在启用[沙箱](/docs/zh-CN/sandboxing#filesystem-isolation)的情况下工作：沙箱允许写入主存储库的共享 `.git` 目录，以便 `git commit` 等命令可以从链接的 worktree 内部更新引用和索引。

在首次在目录中使用 `--worktree` 之前，请通过在该目录中运行一次 `claude` 来接受工作区信任对话框。如果尚未接受信任，`--worktree` 将以错误退出并提示您首先在目录中运行 `claude`。使用 `-p` 的非交互式运行会跳过[信任检查](/docs/zh-CN/security)，因此 `claude -p --worktree` 会在没有信任检查的情况下进行。

如果 Claude Code 在启动时无法进入 worktree 目录，例如因为 [`WorktreeCreate` hook](/docs/zh-CN/hooks#worktreecreate) 打印了除了它创建的目录之外的其他内容，或者因为目录在设置后被删除，Claude Code 会打印一个错误，命名该路径并以代码 1 退出。在 v2.1.205 之前，这会导致会话崩溃，使用 `-p` 时会在大约 30 秒后停滞，然后以代码 0 退出。

从 Claude Code v2.1.200 开始，在主检出处从[项目范围](/docs/zh-CN/plugins-reference#plugin-installation-scopes)安装的插件也会在同一存储库的 worktrees 中加载，因此您无需为每个 worktree 重新安装它们。这适用于您是使用 `--worktree` 还是使用 `git worktree add` 创建 worktree。需要 Claude Code v2.1.200 或更高版本。

<Tip>
  将 `.claude/worktrees/` 添加到您的 `.gitignore`，以便 worktree 内容不会在您的主检出中显示为未跟踪的文件。
</Tip>

<h3 id="choose-the-base-branch">
  选择基础分支
</h3>

Worktrees 从您的存储库的默认分支 `origin/HEAD` 分支，因此它们从与远程匹配的干净树开始。当在过去 24 小时内没有任何内容获取存储库时，Claude Code 会使用默认分支的获取来刷新 `origin/HEAD`，上限为 5 秒，如果获取失败，则使用本地缓存的引用。如果未配置远程，或 `origin/HEAD` 未在本地缓存且无法获取，worktree 会回退到您当前的本地 `HEAD`。

刷新需要 Claude Code v2.1.208 或更高版本；在此之前，新的 worktree 使用已经本地缓存的任何 `origin/HEAD`。

要始终从本地 `HEAD` 分支，请在[设置](/docs/zh-CN/settings#worktree-settings)中将 `worktree.baseRef` 设置为 `"head"`。将 `baseRef` 设置为 `"head"` 会使新 worktrees 携带您未推送的提交和功能分支状态，这在隔离需要在进行中的工作上操作的子代理时很有用。当会话在链接的 worktree 内运行时，`"head"` 解析为该 worktree 的 `HEAD`，而不是主检出的。该设置仅接受 `"fresh"` 或 `"head"`，不接受任意 git refs：

```json theme={null}
{
  "worktree": {
    "baseRef": "head"
  }
}
```

要从特定的拉取请求分支，请传递以 `#` 为前缀的 PR 编号或完整的 GitHub 拉取请求 URL。Claude Code 从 `origin` 获取 `pull/<number>/head` 并在 `.claude/worktrees/pr-<number>` 创建 worktree：

```bash theme={null}
claude --worktree "#1234"
```

要完全控制 worktrees 的创建方式，请配置 [`WorktreeCreate` hook](/docs/zh-CN/hooks#worktreecreate)，它完全替代默认的 `git worktree` 逻辑。

<h3 id="reuse-a-worktree-name">
  重用 worktree 名称
</h3>

重用已存在目录的 worktree 名称会恢复该 worktree。

当以下所有条件都成立时，恢复的 worktree 会重置为[当前基础](#choose-the-base-branch)，而不是在其旧提示处恢复：

* 它没有未提交的更改或未跟踪的文件。
* 它仍然在 Claude Code 为其创建的分支上。
* 它从未提交，或其拉取请求已合并且其远程分支已删除。

在 v2.1.208 之前，重用名称总是在其旧提示处恢复旧的 worktree。

<h2 id="copy-gitignored-files-into-worktrees">
  将 gitignored 文件复制到 worktrees
</h2>

Worktree 是一个新的检出，因此来自您主存储库的未跟踪文件（如 `.env` 或 `.env.local`）不存在。要在 Claude 创建 worktree 时自动复制它们，请将 `.worktreeinclude` 文件添加到您的项目根目录。

该文件使用 `.gitignore` 语法。只有匹配模式且也被 gitignored 的文件才会被复制，因此跟踪的文件永远不会被重复。

此 `.worktreeinclude` 将两个 env 文件和一个 secrets 配置复制到每个新 worktree：

```text .worktreeinclude theme={null}
.env
.env.local
config/secrets.json
```

这适用于使用 `--worktree` 创建的 worktrees、[子代理 worktrees](#isolate-subagents-with-worktrees) 和[桌面应用](/docs/zh-CN/desktop#work-in-parallel-with-sessions)中的并行会话。

<h2 id="isolate-subagents-with-worktrees">
  使用 worktrees 隔离子代理
</h2>

子代理可以在自己的 worktrees 中运行，以便并行编辑不会冲突。要求 Claude "为您的代理使用 worktrees"，或通过向 frontmatter 添加 `isolation: worktree` 在[自定义子代理](/docs/zh-CN/sub-agents#supported-frontmatter-fields)上永久设置它。每个子代理都会获得一个临时 worktree，当子代理完成且没有更改时会自动删除。

子代理 worktrees 使用与 `--worktree` 相同的[基础分支](#choose-the-base-branch)，因此它们从您的存储库的默认分支分支，除非 `worktree.baseRef` 设置为 `"head"`。

<h2 id="clean-up-worktrees">
  清理 worktrees
</h2>

当您退出 worktree 会话时，清理取决于您是否进行了更改：

* **无未提交的更改、无未跟踪的文件且无新提交**：worktree 及其分支会自动删除。如果会话有[名称](/docs/zh-CN/sessions#name-your-sessions)，Claude 会提示您，以便您可以稍后保留 worktree
* **存在未提交的更改、未跟踪的文件或新提交**：Claude 提示您保留或删除 worktree。保留会保留目录和分支，以便您稍后可以返回。删除会删除 worktree 目录及其分支，丢弃所有未提交的更改、未跟踪的文件和提交
* **非交互式运行**：使用 `--worktree` 和 `-p` 创建的 worktrees 不会自动清理，因为没有退出提示。使用 `git worktree remove` 删除它们

Claude 为子代理和[后台会话](/docs/zh-CN/agent-view#how-file-edits-are-isolated)创建的 worktrees 一旦超过您的 [`cleanupPeriodDays`](/docs/zh-CN/settings#available-settings) 设置，就会自动删除，前提是它们没有未提交的更改、没有未跟踪的文件和没有未推送的提交。使用 `--worktree` 创建的 Worktrees 永远不会被此扫描删除。

当代理运行时，Claude 在其 worktree 上运行 `git worktree lock`，以便并发清理无法将其删除。当代理完成时，锁会被释放。要清理扫描保留的 worktree，请运行 `git worktree remove`，如果 worktree 有未提交的更改或未跟踪的文件，请添加 `--force`。

在 Windows 上，删除 worktree 之前，Claude Code 会将其内部任何深度的 NTFS 接合点或目录符号链接作为链接条目删除，以便删除 worktree 不会删除链接指向的文件。在 v2.1.205 之前，Claude Code 仅将顶级链接作为链接条目删除，删除包含嵌套在子目录中的接合点的 worktree 可能会删除 worktree 外链接指向的目录的内容。

<h2 id="manage-worktrees-manually">
  手动管理 worktrees
</h2>

要完全控制 worktree 位置和分支配置，请直接使用 Git 创建 worktrees。当您需要检出特定的现有分支或将 worktree 放在存储库外时，这很有用。

在新分支上创建 worktree：

```bash theme={null}
git worktree add ../project-feature-a -b feature-a
```

从现有分支创建 worktree：

```bash theme={null}
git worktree add ../project-bugfix bugfix-123
```

在 worktree 中启动 Claude：

```bash theme={null}
cd ../project-feature-a && claude
```

列出您的 worktrees：

```bash theme={null}
git worktree list
```

完成后删除一个：

```bash theme={null}
git worktree remove ../project-feature-a
```

有关完整的命令参考，请参阅 [Git worktree 文档](https://git-scm.com/docs/git-worktree)。记住在每个新 worktree 中初始化您的开发环境：安装依赖项、设置虚拟环境或运行您的项目设置所需的任何内容。

<h2 id="non-git-version-control">
  非 git 版本控制
</h2>

Worktree 隔离默认使用 git。对于 SVN、Perforce、Mercurial 或其他系统，请配置 [`WorktreeCreate` 和 `WorktreeRemove` hooks](/docs/zh-CN/hooks#worktreecreate) 以提供自定义创建和清理逻辑。因为 hook 替代了默认的 git 行为，当您使用 `--worktree` 时，[`.worktreeinclude`](#copy-gitignored-files-into-worktrees) 不会被处理。改为在您的 hook 脚本内复制任何本地配置文件。

此 `WorktreeCreate` hook 从 stdin 读取 worktree 名称，检出一个新的 SVN 工作副本，并打印目录路径，以便 Claude Code 可以将其用作会话的工作目录：

```json theme={null}
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'NAME=$(jq -r .name); DIR=\"$HOME/.claude/worktrees/$NAME\"; svn checkout https://svn.example.com/repo/trunk \"$DIR\" >&2 && echo \"$DIR\"'"
          }
        ]
      }
    ]
  }
}
```

将其与 `WorktreeRemove` hook 配对以在会话结束时进行清理。有关输入架构和删除示例，请参阅 [hooks 参考](/docs/zh-CN/hooks#worktreecreate)。

<h2 id="see-also">
  另请参阅
</h2>

Worktrees 处理文件隔离。下面的相关页面涵盖将工作委派到这些隔离的检出中以及在您创建的会话之间切换：

* [子代理](/docs/zh-CN/sub-agents)：在会话内将工作委派给隔离的代理
* [代理团队](/docs/zh-CN/agent-teams)：自动协调多个 Claude 会话
* [管理会话](/docs/zh-CN/sessions)：命名、恢复和在对话之间切换
* [桌面并行会话](/docs/zh-CN/desktop#work-in-parallel-with-sessions)：桌面应用中由 worktree 支持的会话
