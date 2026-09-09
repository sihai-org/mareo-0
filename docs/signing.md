# Mareo macOS 签名与公证（Developer ID + Notarytool）

让官网下载的 DMG 在普通用户双击时**不再被 Gatekeeper 拦截**。只影响打包环节，不影响代码与运行时。

## 前置（一次性，Apple 侧）

1. **证书**：钥匙串里必须有 **Developer ID Application** 证书。验证：
   ```sh
   security find-identity -v -p codesigning | grep "Developer ID Application"
   # 期望输出：1) <HASH> "Developer ID Application: 你的名字 (TEAMID)"
   ```
   没有的话：Xcode → Settings → Accounts → 登录 Apple ID → Manage Certificates → **+** → Developer ID Application（会立即装进钥匙串）。
   > 注意："Apple Development" 证书不能用于对外分发，且**不要**让它被自动选中。

2. **Team ID**：developer.apple.com → Membership（本项目：`Q85U66X3JF`）。

3. **App 专用密码**：`appleid.apple.com` → 登录与安全 → App 专用密码 → 生成（如 `Mareo Notary`），得到 `xxxx-xxxx-xxxx-xxxx`。它只用于公证上传，别发给别人、别写进仓库。

## 执行

```sh
# 证书名可省略（脚本会自动找 Developer ID Application）；有多个时可显式指定：
export CSC_NAME="Developer ID Application: 你的名字 (Q85U66X3JF)"

# 公证三件套（都设了才会公证；不设则只签名/或都跳过）
export APPLE_ID="你的AppleID邮箱"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="Q85U66X3JF"

# 你的网络拉 Electron 需要镜像（否则打包会超时）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

npm run make
```

脚本行为（`scripts/sign-macos.mjs`，挂在 forge `postPackage` hook）：
- 找到 Developer ID 证书 → **签名**（hardened runtime + `entitlements.mac.plist`）；
- 三件套齐全 → **公证**（notarytool `--wait`）并 **staple**；
- 两者任一缺失 → 打印跳过提示，退回未签名打包（开发流程不受影响）。

## 验证

```sh
APP=out/Mareo-darwin-arm64/Mareo.app
codesign --verify --deep --strict "$APP" && echo "签名有效"
xcrun stapler validate "$APP" && echo "公证已附带"
spctl -a -t exec -vv "$APP"            # 期望: accepted, source=Notarized Developer ID
```

## 发布

把签名 DMG 上传服务器替换 `downloads/` 下旧文件，并把官网"未签名内测版"提示改为正式版说明（改 `website/index.html` 文案 + 重新 rsync）。

## 常见问题

| 问题 | 处理 |
|---|---|
| 提示无 Developer ID 证书 | 按上文在 **这台 Mac** 用 Xcode 生成；`security find-identity` 应能看到 |
| 公证报错 invalid | 确认 `APPLE_APP_SPECIFIC_PASSWORD` 是 App 专用密码（不是登录密码）且账号是开发者账号本人 |
| `npm run make` 拉 Electron 超时 | 记得 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| 只想快速出个未签名包 | 不设任何签名环境变量直接 `npm run make`（自动跳过） |

## 一键发布

`scripts/release.mjs`（`npm run release`）把整条发布链串成一条命令：
检查证书 → `npm run make`（签名+公证）→ 本地验证（codesign/stapler/spctl）→ 上传 DMG 到服务器 `downloads/` → 同步官网文件 → 验证线上下载 URL → 打印 sha256。

用法：

```sh
cp scripts/release.env.example .release.env   # 首次：填密钥与服务器（.release.env 已被 git 忽略）
npm run release                               # 全流程
npm run release -- --no-upload                # 只本地打包+验证，不发布
```

> 若改了 `package.json` 的版本号，DMG 文件名随之变化——记得同步更新 `website/app.js` 的 `downloadUrl`（脚本结束时会提醒）。

