# 发布流程（tag 驱动，CI 自动出包）

一次发布 = **打一个版本 tag**，其余全自动。

```sh
# 1. 提升版本号（唯一真正的人工步骤）
#    package.json 的 "version": "0.1.1"
git commit -am "Release 0.1.1"
git push
# 2. 打 tag 并推送（tag 必须与 package.json 版本一致）
git tag v0.1.1 && git push origin v0.1.1
```

## 触发与产物

| 触发 | 行为 |
|---|---|
| `push tag v*` | 校验版本 → macOS 构建/签名/公证 → Windows 构建/签名 → 发布（上传 + 清单 + GitHub Release） |
| 手动 `workflow_dispatch` | **只构建**，产物留在 Artifacts，不动线上（干跑用） |

发布任务会：
1. 收集两端安装包（含 Windows 的 `.nupkg` 与 `RELEASES`，为将来自动更新备用）
2. 生成 `updates/latest.json`（版本、发布时间、两端下载直链）
3. 上传到 OSS（若已配置）与官网主机（若配置了 `ECS_HOST`/`ECS_SSH_KEY`）
4. 创建 GitHub Release（附全部产物，作为审计与备用下载源）

## 命名规范

```
Mareo-<version>-<os>-<arch>[-<variant>].<ext>

Mareo-0.1.1-macos-arm64.dmg          # 给人下载（签名+公证）
Mareo-0.1.1-macos-arm64.zip          # （Phase 2）给更新器
Mareo-0.1.1-windows-x64-setup.exe    # 给人下载
MareoSetup.exe                       # 固定名副本：Squirrel 更新链要求
Mareo-0.1.1-windows-x64-full.nupkg   # （Phase 2）给更新器
RELEASES                             # （Phase 2）Squirrel 更新索引
```

- `os`：`macos` / `windows` / `linux` / `harmony`
- `arch`：`arm64` / `x64`
- 未来平台沿用同一规则（Linux `.AppImage`、鸿蒙 `.hap`）
- 自动化位置：`forge.config.cjs` 的 `postMake` 钩子负责改名/生成版本化副本

## 需要的 Secrets（Settings → Secrets and variables → Actions）

| 用途 | Secret |
|---|---|
| macOS 签名 | `MACOS_CERT_P12_BASE64`、`MACOS_CERT_PASSWORD` |
| macOS 公证 | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` |
| Windows 签名（可选） | `WINDOWS_CERT_BASE64`、`WINDOWS_CERT_PASSWORD` |
| OSS 上传（可选） | `OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` |
| 官网清单更新（可选） | `ECS_HOST`（如 `root@114.55.15.112`）、`ECS_SSH_KEY`（部署私钥内容） |

变量（Variables，可选）：`RELEASE_DOWNLOAD_BASE` —— 清单里下载链接的前缀，默认 `https://mareo.cn/downloads`；**接入 CDN 后改成 `https://dl.mareo.cn` 即可，不用改代码**。

未配置的步骤会**自动跳过并打印提示**，所以可以先只配 Apple/Windows 证书跑通，再逐步接入 OSS/CDN。

## 下载加速（OSS + CDN）接入步骤

1. 阿里云开通 OSS，创建 Bucket（建议与用户同地域，如华东 1）
2. 绑定自定义域名 `dl.mareo.cn`（该子域需解析到 OSS/CDN 并具备证书）
3. 开通 CDN，源站指向该 Bucket，加速域名用 `dl.mareo.cn`
4. 添加 Secrets：`OSS_REGION`（如 `oss-cn-hangzhou`）、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
5. 设置变量 `RELEASE_DOWNLOAD_BASE=https://dl.mareo.cn`
6. **兼容旧链接**：在 nginx 给 `mareo.cn/downloads/` 加 302 到 `https://dl.mareo.cn`（已发布客户端里写死的旧链接不会失效）
7. 刷新 CDN 缓存（发新版后对 `latest.json` 做一次刷新，或给它设短缓存）

## 官网下载链接

官网已改为**运行时读取 `updates/latest.json`**（`website/app.js`），所以发版**不再需要改站点代码**；清单不可达时回退到内置链接。

## 回滚

- 清单回滚：把 `updates/latest.json` 改回上一版本（用户端提示会消失）
- 安装包保留：OSS/ECS 上旧版本文件不删，便于用户重新下载
- GitHub Release 保留每个版本的产物，必要时可重新分发

## 干跑与验证

- 手动触发 Release workflow（不推 tag）→ 只构建、只出 Artifacts
- 本地验证 macOS 包：`spctl -a -t exec -vv out/Mareo-darwin-arm64/Mareo.app`
- 验证清单：`curl -s https://mareo.cn/updates/latest.json`
