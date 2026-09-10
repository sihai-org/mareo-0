# Windows 构建与发布

Windows 产物是 **Squirrel 安装包**（`MareoSetup.exe`）。Squirrel 不能在 macOS 上交叉构建，因此本流程**必须在 Windows x64 机器上执行**（公司机器或 CI 的 Windows runner）。

## 前置

- Windows 10/11 x64
- Node.js 22+ 与 npm（`node --version` 可用即可）
- Git
- 代码签名证书（`.pfx`）——没有证书也能构建，但安装包未签名，用户会遇到 SmartScreen 警告

## 一、代码与依赖

```powershell
git clone git@github.com:ZheFeng/mareo-0.git
cd mareo-0
git checkout main          # 或待验证的任务分支
npm install
```

## 二、验证运行时归档（首次会下载 Node）

```powershell
npm run check:node:win
# 期望：Verified win32/x64 Node 24.20.0 archive and layout.
```

这一步校验 `runtime/package.json` 里钉死的 Node 版本与 SHA-256，并确认解压后 `bin\node.exe` 存在。

## 三、签名环境变量（可选，但正式发布必做）

```powershell
$env:WINDOWS_CERT_FILE = "C:\certs\mareo.pfx"    # 安装包签名
$env:WINDOWS_CERT_PASSWORD = "<pfx 密码>"
$env:CSC_LINK = "C:\certs\mareo.pfx"             # 应用 exe 签名（等价路径）
$env:CSC_KEY_PASSWORD = "<pfx 密码>"
```

> 未设置这些变量时仍会构建，只是产物未签名。

## 四、构建

```powershell
npm run make:win
```

流程 = `build`（TypeScript）→ `stage:runtime:win`（装 DSH 依赖树 + Windows Node 运行时 + 生成品牌插件）→ `electron-forge make --platform win32 --arch=x64`。

产物：

```text
out\make\squirrel.windows\x64\MareoSetup.exe   ← 对外发布的就是它
out\Mareo-win32-x64\Mareo.exe                  ← 免安装可执行（调试用）
```

## 五、本机验证（发版前必做）

1. 双击 `MareoSetup.exe` 安装 → 开始菜单出现 Mareo
2. 打开 Mareo → 邮箱验证码登录（`https://api.svc.mareo.cn`）
3. 对话一次，确认网关记录到用量
4. 设置 → **账户**：显示邮箱、可改名、可退出登录
5. 退出后换另一个账号登录 → 会话/设置是独立环境
6. 控制面板卸载干净；再次安装覆盖升级正常

## 六、上传与发布

```powershell
# 上传到官网下载目录（与 macOS 的 DMG 并列）
scp out\make\squirrel.windows\x64\MareoSetup.exe root@114.55.15.112:/var/www/mareo-site/downloads/
```

然后更新官网 `website/app.js` 里的 Windows 下载文件名（版本变化时），提交并同步：

```sh
rsync -az -e "ssh -i ~/.ssh/mareo-0.pem" website/index.html website/app.js root@114.55.15.112:/var/www/mareo-site/
```

## 常见问题

| 现象 | 处理 |
|---|---|
| `maker-squirrel` 报错需要 Windows | 属预期：Squirrel 不支持在 macOS/Linux 上构建，请在 Windows 执行 |
| 用户安装时出现"Windows 已保护你的电脑" | 安装包未签名，或新证书尚未积累信誉（EV 证书可立即通过；OV 需一段时间） |
| 图标不是 Mareo | 确认 `assets/app-icon.ico` 已提交；改图标后在 macOS 上跑 `npm run generate:ico` |
| 杀软误报 | 未签名安装包的常见现象，签名后可显著缓解 |
| DSH 无法启动 | 查看 `%APPDATA%\Mareo\logs\mareo.log`；确认 Node 运行时已随包（`Resources\node-runtime\bin\node.exe`） |

## 已知限制（当前版本）

- 仅支持 Windows x64
- 暂无自动更新（后续可接入 Squirrel 更新源）
- 无 MSI / 免安装 ZIP 之外的形态
