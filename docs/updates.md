# 更新机制（Phase 1：提示式）

当前实现是"**检查到新版本 → 提示 → 用户前往下载**"，不自动下载或安装。真正的自动更新是 Phase 2（见文末）。

## 清单文件

托管在官网静态目录：`https://mareo.cn/updates/latest.json`

```json
{
  "version": "0.1.1",
  "releasedAt": "2026-09-12T10:00:00Z",
  "notes": "修复 Windows 菜单栏；安装器快捷方式",
  "downloads": {
    "windows": "https://mareo.cn/downloads/MareoSetup.exe",
    "macos": "https://mareo.cn/downloads/Mareo-0.1.1-arm64.dmg"
  }
}
```

- `version` 必填，语义化版本；客户端与 `app.getVersion()`（即 `package.json` 的 version）比较
- `downloads` 按平台给直链；缺失的平台不会弹提示
- 其余字段可选，`notes` 会显示在提示框里

## 客户端行为

- 仅**打包版**在启动 10 秒后检查一次；开发模式不检查
- 有新版本且当前平台有下载链接 → 弹窗「Mareo 有新版本」，按钮 `[前往下载] [稍后]`
- **任何失败（离线、清单损坏、超时）都静默忽略**，绝不影响启动
- 可用环境变量调试：`MAREO_UPDATE_URL`（换清单地址）、`MAREO_UPDATE_CHECK=off`（关闭检查）

## 发布新版本时

1. 改 `package.json` 的 `version`（例如 `0.1.1`），构建并上传安装包
2. 更新 `updates/latest.json`：`version` 填新版本、`downloads` 指向新安装包
3. 建议同时把 `notes` 写成用户看得懂的一句话

> 顺序很重要：**先传安装包，再改 latest.json**，避免用户点开链接时 404。

## Phase 2（自动更新，尚未实现）

- **Windows**：CI 额外产出 `RELEASES` 与 `Mareo-<version>-full.nupkg` 并上传到 `updates/win/`；客户端用 Electron 内置 `autoUpdater`（零依赖）→ 后台下载 → 提示"重启更新"
- **macOS**：引入 `electron-updater`，发布时额外产出**已签名+公证的 zip** 与 `latest-mac.yml` → 同样"重启更新"体验
- 共同前置：安装包/更新包持续签名；版本号单调递增；保留上一版本以便回滚
