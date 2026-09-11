# OSS + CDN 下载加速（阿里云）

目标：安装包从 `mareo.cn/downloads/*`（ECS 直连）迁到 **OSS + CDN**，下载地址形如
`https://dl.mareo.cn/Mareo-0.1.1-macos-arm64.dmg`，ECS 不再扛带宽。

> 前提：`mareo.cn` 已在**阿里云**完成备案接入（子域 `dl.mareo.cn` 随主域备案生效）。若备案接入商不是阿里云，需要先做接入备案。

## 步骤 A：创建 OSS Bucket（控制台）

1. 对象存储 OSS → Bucket 列表 → **创建 Bucket**
2. 名称：如 `mareo-downloads`；地域：与用户同地域（如 **华东1 杭州**）
3. 读写权限：**公共读**（下载站常规做法；后续可用 CDN 鉴权/防盗链收紧）
4. 其他保持默认即可

## 步骤 B：给 Bucket 绑定自定义域名

1. Bucket → **传输管理 → 域名管理 → 绑定域名**，填 `dl.mareo.cn`
2. 按提示到**云解析 DNS** 添加 CNAME：`dl.mareo.cn` → Bucket 的外网访问域名
3. 上传/申请证书：可直接用阿里云**免费 SSL 证书**（数字证书管理服务）为该域名签发，然后在此处开启 HTTPS

## 步骤 C：创建 CDN 加速域名

1. CDN → 域名管理 → **添加域名**
2. 加速域名：`dl.mareo.cn`
3. 源站类型：**OSS 域名**，选择步骤 A 的 Bucket（或填 Bucket 外网域名）
4. 缓存配置：
   - `*.dmg` / `*.exe` / `*.nupkg` / `*.zip` / `*.ico`：**缓存 30 天**（文件名带版本号，内容不变）
   - `latest.json`：**不缓存或缓存 60 秒**（发版后要立刻生效）
5. 计费与安全（重要）：
   - 计费方式建议**按流量**，并设置**流量/带宽封顶**，避免异常盗刷
   - 可选开启 **Referer 防盗链**（允许 `mareo.cn` 与空 Referer）

## 步骤 D：创建 RAM 子账号给 CI 用

1. RAM 访问控制 → 用户 → **创建用户**（仅编程访问）→ 保存 **AccessKey ID / Secret**
2. 授权：只给它该 Bucket 的读写权限（自定义策略或 `AliyunOSSFullAccess` 仅限于测试）
3. 这两个值只填进 GitHub Secrets，不要发给任何人

## 步骤 E：配置 GitHub

Settings → Secrets and variables → Actions：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `OSS_REGION` | 如 `oss-cn-hangzhou` |
| Secret | `OSS_BUCKET` | 如 `mareo-downloads` |
| Secret | `OSS_ACCESS_KEY_ID` | RAM 用户的 AccessKey ID |
| Secret | `OSS_ACCESS_KEY_SECRET` | RAM 用户的 AccessKey Secret |
| Variable | `RELEASE_DOWNLOAD_BASE` | `https://dl.mareo.cn` |

配置后，下一次打 tag 发布时安装包会**同时上传到 OSS**，清单里的下载链接自动指向 CDN。

## 步骤 F：迁移现有安装包（一次性）

在**本机**（仓库根目录）执行，把当前官网上的文件搬到 OSS：

```bash
export OSS_REGION=oss-cn-hangzhou
export OSS_BUCKET=mareo-downloads
export OSS_ACCESS_KEY_ID=...
export OSS_ACCESS_KEY_SECRET=...

# 现有产物（按需取用）
npm run publish:oss -- \
  /tmp/mareo-win-artifact/MareoSetup.exe \
  out/make/Mareo-0.1.0-macos-arm64.dmg \
  assets/app-icon.ico
```

验证：
```bash
curl -sI https://dl.mareo.cn/MareoSetup.exe | head -3      # 期望 200
curl -sI https://dl.mareo.cn/app-icon.ico | head -3
```

## 步骤 G：旧链接兼容（ECS nginx）

已发布的客户端与旧清单里写死的是 `https://mareo.cn/downloads/...`，迁移后要给它们留跳转：

```nginx
location /downloads/ {
    return 302 https://dl.mareo.cn$request_uri;
}
```

（`/downloads/` 之后的路径不变，所以 `mareo.cn/downloads/MareoSetup.exe` 会跳到 CDN 上的同名文件。）

## 验证清单

- [ ] `https://dl.mareo.cn/MareoSetup.exe` → 200，且响应头含 CDN 标识（`Via`/`X-Cache`）
- [ ] `https://dl.mareo.cn/Mareo-0.1.0-macos-arm64.dmg` → 200
- [ ] `https://mareo.cn/downloads/MareoSetup.exe` → 302 到 CDN
- [ ] 官网下载按钮可用（读取 `updates/latest.json` 的链接）
- [ ] 用手机 4G 实测下载速度明显优于之前

## 注意事项

- **OSS 直链与 CDN 域名是两个地址**：清单里用 CDN 域名；OSS 直链仅作回源/调试
- 缓存刷新：`latest.json` 若设置了缓存，发版后到 CDN 控制台**刷新缓存**（或保持不缓存）
- 成本：存储很小；主要成本是 CDN 流量（国内约 ¥0.2/GB 量级），300MB 安装包 × 下载次数
