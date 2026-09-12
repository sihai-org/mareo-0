# 更新机制（Phase 1：提示式 + 可选强制）

默认行为是"**检查到新版本 → 提示 → 用户前往下载**"，不自动下载或安装。发布时若指定 `minimumVersion`，低于该版本的客户端将被**强制更新**（不更新无法使用）。真正的自动更新是 Phase 2（见文末）。

## 清单文件

托管在官网静态目录：`https://mareo.cn/updates/latest.json`，**由发布流程自动生成**（`scripts/generate-release-manifest.mjs`）。

```json
{
  "version": "0.1.3",
  "releasedAt": "2026-09-12T10:00:00Z",
  "notes": "修复账户隔离问题",
  "minimumVersion": "0.1.2",
  "downloads": {
    "windows": "https://mareo.cn/downloads/Mareo-0.1.3-windows-x64-setup.exe",
    "macos": "https://mareo.cn/downloads/Mareo-0.1.3-macos-arm64.dmg"
  }
}
```

- `version` 必填，语义化版本；客户端与 `app.getVersion()`（即 `package.json` 的 version）比较
- `downloads` 按平台给直链；缺失的平台不会弹提示
- `notes` 会显示在提示框里，来自**打 tag 时的注解第一行**（见下）
- `minimumVersion` 可选：**低于它的客户端启动即被拦下**，不启动 DSH，只显示"请更新 Mareo"

## 客户端行为

- 仅**打包版**检查；开发模式不检查
- **启动时先看最低版本**：低于 `minimumVersion` → 弹「请更新 Mareo」（只有 `[前往下载] [退出]`），点"前往下载"在浏览器打开下载页，窗口会一直回来直到用户去更新；**不启动 DSH**
- 否则启动 10 秒后检查是否有新版本 → 弹窗「Mareo <新版本> 已发布」，按钮 `[前往下载] [明天再提醒]`
- **每天最多提醒一次**（记录在 `<userData>/update-prompt.json`），避免每次启动都弹同一句话
- **任何失败（离线、清单损坏、超时）都放行**：网络问题绝不能把用户锁在外面
- 以下情况即使填了 `minimumVersion` 也不拦人：清单读不到、该平台没有下载链接、`MAREO_UPDATE_CHECK=off`
- 可用环境变量调试：`MAREO_UPDATE_URL`（换清单地址）、`MAREO_UPDATE_CHECK=off`（关闭检查与强制）

## 发布新版本时

用 `npm run release`（见 [`signing.md`](signing.md)）即可，它会问你要不要强制更新，并把这些信息写进 tag 注解：

```sh
git tag -a v0.1.3 -m "修复账户隔离问题" -m "minimum-version: 0.1.2"
#          ↑ 第一行 = 用户看到的 notes      ↑ 低于 0.1.2 的客户端将被强制更新（不写这行 = 不强制）
```

清单由 CI 生成，不需要手工维护。轻量 tag（无注解）没有 notes，此时回退到仓库 Variable `RELEASE_NOTES`；两者都为空则提示框使用默认文案。

## Phase 2（自动更新，尚未实现）

- **Windows**：CI 额外产出 `RELEASES` 与 `Mareo-<version>-full.nupkg` 并上传到 `updates/win/`；客户端用 Electron 内置 `autoUpdater`（零依赖）→ 后台下载 → 提示"重启更新"
- **macOS**：引入 `electron-updater`，发布时额外产出**已签名+公证的 zip** 与 `latest-mac.yml` → 同样"重启更新"体验
- 共同前置：安装包/更新包持续签名；版本号单调递增；保留上一版本以便回滚
