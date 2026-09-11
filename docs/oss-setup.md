# OSS 直连下载（阿里云）

安装包托管在阿里云 OSS，直连下载（**暂不使用 CDN**）。下载地址形如：

```
https://<bucket>.<region>.aliyuncs.com/Mareo-0.1.1-macos-arm64.dmg
例如 https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/MareoSetup.exe
```

- OSS 自带 HTTPS（阿里云域名证书），**无需自己配证书、也不占用自有域名**
- 带宽与稳定性远好于小带宽 ECS；以后要加速，只需把下载前缀换成 CDN 域名（改一个变量），客户端与代码都不用动

## 已有配置（你的环境）

| 项 | 值 |
|---|---|
| Bucket | `mareo-downloads` |
| 地域 | 华东1（杭州）→ `oss-cn-hangzhou` |
| 访问域名 | `https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com` |
| 权限 | **公共读**（下载站必需；只读不列举） |

> 如果 Bucket 不是"公共读"，直链会返回 403，用户无法下载。

## RAM 子账号授权（一次性）

只授予该 Bucket 的读写权限，不要用 `AliyunOSSFullAccess`：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject", "oss:GetObject", "oss:DeleteObject",
        "oss:ListObjects", "oss:GetBucketInfo", "oss:ListParts", "oss:AbortMultipartUpload"
      ],
      "Resource": [
        "acs:oss:*:*:mareo-downloads",
        "acs:oss:*:*:mareo-downloads/*"
      ]
    }
  ]
}
```

## GitHub 配置（打 tag 自动上传用）

Settings → Secrets and variables → Actions：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `OSS_REGION` | `oss-cn-hangzhou` |
| Secret | `OSS_BUCKET` | `mareo-downloads` |
| Secret | `OSS_ACCESS_KEY_ID` | RAM 用户 AccessKey ID |
| Secret | `OSS_ACCESS_KEY_SECRET` | RAM 用户 AccessKey Secret |
| Variable | `RELEASE_DOWNLOAD_BASE` | `https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com` |

配置后，下次打 tag 发布时安装包会自动上传到 OSS，清单里的下载链接也会指向 OSS。
（以后若接入 CDN，只把这个变量改成 CDN 域名即可。）

## 本地迁移（一次性，把现有安装包搬到 OSS）

在仓库根目录创建 `.env.oss`（已被 git 忽略）：

```bash
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=mareo-downloads
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
```

然后：

```bash
set -a; source .env.oss; set +a
npm run publish:oss -- MareoSetup.exe Mareo-0.1.0-macos-arm64.dmg app-icon.ico
```

## 旧链接兼容（ECS nginx）

已发布客户端与旧清单里写死的是 `https://mareo.cn/downloads/...`，给它留一个跳转：

```nginx
location /downloads/ {
    return 302 https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com$request_uri;
}
```

## 验证清单

- [ ] `https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/MareoSetup.exe` → 200
- [ ] 同一地址的 DMG → 200
- [ ] `https://mareo.cn/downloads/MareoSetup.exe` → 302 到 OSS
- [ ] 官网下载按钮可用（读取 `updates/latest.json`）
- [ ] 手机 4G 实测下载速度优于迁移前

## 费用与注意

- 存储费极低；主要成本是**外网流出流量**（国内约 ¥0.25–0.5/GB），建议在 OSS 控制台设置**流量封顶/告警**
- 直连没有边缘缓存，热点下载会直接消耗 OSS 带宽——用户量上来后再考虑 CDN（改一个变量即可）
- 不要把 AccessKey 写进仓库；`.env.oss` 已在 .gitignore 中
