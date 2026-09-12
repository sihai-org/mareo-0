# 更新机制（Phase 1：提示式）

当前实现是"**检查到新版本 → 提示 → 用户前往下载**"，不自动下载或安装。真正的自动更新是 Phase 2（见文末）。

## 清单文件

托管在官网静态目录：`https://mareo.cn/updates/latest.json`，**由发布流程自动生成**（`scripts/generate-release-manifest.mjs`）。

```json
{
  "version": "0.1.2",
  "releasedAt": "2026-09-12T10:00:00Z",
  "notes": "修复账户隔离问题",
  "downloads": {
    "windows": "https://mareo.cn/downloads/Mareo-0.1.2-windows-x64-setup.exe",
    "macos": "https://mareo.cn/downloads/Mareo-0.1.2-macos-arm64.dmg"
  }
}
```

- `version` 必填，语义化版本；客户端与 `app.getVersion()`（即 `package.json` 的 version）比较
- `downloads` 按平台给直链；缺失的平台不会弹提示
- `notes` 会显示在提示框里，来自**打 tag 时的注解**（见下）

## 客户端行为

- 仅**打包版**在启动 10 秒后检查一次；开发模式不检查
- 有新版本且当前平台有下载链接 → 弹窗「Mareo <新版本> 已发布」，按钮 `[前往下载] [明天再提醒]`
- **每天最多提醒一次**（记录在 `<userData>/update-prompt.json`），避免每次启动都弹同一句话
- **任何失败（离线、清单损坏、超时）都静默忽略**，绝不影响启动
- 可用环境变量调试：`MAREO_UPDATE_URL`（换清单地址）、`MAREO_UPDATE_CHECK=off`（关闭检查）

## 发布新版本时

清单由 CI 生成，不需要手工维护。唯一要做的是**把更新说明写进 tag 注解**，它会出现在用户的提示框里：

```sh
git tag -a v0.1.2 -m "修复账户隔离问题"     # 第一行就是用户看到的 notes
git push origin v0.1.2
```

轻量 tag（`git tag v0.1.2`，无 `-m`）没有注解，此时回退到仓库 Variable `RELEASE_NOTES`；两者都为空则提示框使用默认文案。

## Phase 2（自动更新，尚未实现）

- **Windows**：CI 额外产出 `RELEASES` 与 `Mareo-<version>-full.nupkg` 并上传到 `updates/win/`；客户端用 Electron 内置 `autoUpdater`（零依赖）→ 后台下载 → 提示"重启更新"
- **macOS**：引入 `electron-updater`，发布时额外产出**已签名+公证的 zip** 与 `latest-mac.yml` → 同样"重启更新"体验
- 共同前置：安装包/更新包持续签名；版本号单调递增；保留上一版本以便回滚
