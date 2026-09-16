# Sponsored Ad Slot（V1）

一个手工配置的通用推荐卡片，不接广告 SDK、推荐算法、rewarded ads 或结算系统。通过 DSH 官方 `sidebar.footer.action` 插件位置展示在设置上方，不修改 DSH。无广告、配置无效、网络失败、图片失败或侧栏折叠时隐藏，不占空白位置。

## 配置与发布

本地：将 `server/sponsored-ad.example.json` 复制到 `server/data/sponsored-ad.json`，替换示例内容，再设置 `enabled: true`。默认禁用，无测试广告投放。

Docker：配置放在服务器 `server/deploy/data/sponsored-ad.json`，已有数据目录挂载使容器看到 `/app/data/sponsored-ad.json`。容器用户 uid 1000 必须能读取。默认无需新增挂载、修改环境或重启；自定义位置可设置 `SPONSORED_AD_FILE`（更改环境需要重建容器）。广告文件与数据库都不要提交 Git。

配置字段为 `enabled`、`id`、`image`、`title`、`description`、`targetUrl`、`advertiser`。ID 仅允许字母、数字、下划线和连字符，最长 80 字符；标题 120、描述 300、广告主 80 字符；URL 最长 2048 字符，仅允许不带用户名密码的 HTTPS。

图片建议宽幅、体积小，使用你控制的静态素材存储，必须支持匿名跨域加载（例如 `Access-Control-Allow-Origin: *`），不需要 Cookie 或登录。客户端不发送来源信息或跨域凭据；不支持 HTML、iframe 或脚本素材。目标链接可以保留 CPS / affiliate 所需的非用户专属推广参数，但不要放 Mareo 用户标识或密钥。

用临时文件写完整 JSON 后原子替换配置文件，避免读到半份配置。服务端每次请求读取文件；客户端每次主页面加载获取一次，不轮询、不在对话切换时刷新。新配置在下次页面加载或重启客户端后展示。`enabled: false` 或移除文件使后续获取返回空；已打开的页面不会立即消失。更换内容时必须使用新 ID；旧卡片在配置更新后的新事件将被服务端拒收，仍可正常打开原链接。

首次上线顺序：先部署支持广告接口的服务端与隐私说明，再发布带卡片的客户端，最后启用真实配置。本次开发不自动执行任何线上部署。

## 请求与事件

- `GET /sponsored-ad`：要求 Bearer 登录令牌，返回 `{ "ad": null }` 或包含六个广告字段的 `ad`。响应不缓存。
- `POST /sponsored-ad/events`：要求登录，接收 `eventId`（UUID）、`adId`、`placement: "sidebar-footer"`、`type: "impression" | "click"`。服务端从令牌确定 `userId`、自行记录时间，其余字段不落库。
- 无效参数或广告 ID 返回 400，未登录 401，重复 ID 的内容或用户不同返回 409。相同事件重发返回 200，不重复写入。每用户每分钟最多写入 30 个新事件，超限返回 429，仅影响广告统计，不影响模型请求或跳转。
- 曝光：图片加载成功，侧栏展开，窗口获得焦点、页面可见，卡片至少 50% 可见持续 1 秒。短暂显示、后台与加载失败不计入。主进程保证同一主页面、同一广告最多记一次曝光；重新加载页面可再次记录。
- 点击：主动点击时记录，每次生成独立 UUID。仅传广告 ID 给主进程，由它使用已校验的广告目标打开系统浏览器；界面不能通过广告接口指定任意 URL。点击并不证明浏览器加载成功或产生转化。
- 统计失败不阻塞展示、聊天或点击，无持久化重试队列；本版可能丢失事件，不提供广告结算级准确性或完整防作弊。

## 数据与隐私

现有 SQLite 新增 `ad_events` 表，版本 6 升至 7，保留原有数据：

`eventId`（主键）、`adId`、`placement`、`userId`、`type`、`createdAt`。

广告统计独立于诊断统计开关。关联用户 ID，但不存邮箱、昵称、会话标识、对话、文件、工作区或设备指纹。不向广告主发送 Mareo ID 或令牌。广告素材请求会让素材主机看到网络请求信息，外部浏览器网站遵循其自己的隐私政策。

写入新事件时清理超过 180 天的广告事件；没有新事件时不运行清理。不新增独立调度任务。用户数据删除操作需要同步删除 `ad_events WHERE userId = ?`。

按广告和 UTC 日期汇总的只读示例：

```sql
SELECT adId, substr(createdAt, 1, 10) AS day,
       SUM(type = 'impression') AS impressions,
       SUM(type = 'click') AS clicks,
       COUNT(DISTINCT userId) AS users
FROM ad_events
GROUP BY adId, day ORDER BY day DESC;
```

不建立广告管理后台、广告内容表或平台适配层。后续不同推广来源只需提供相同六个字段；需要转化归因或结算时另行设计。

## 验证

`npm test`、`npm run server:test`、`npm run typecheck`。覆盖空配置、非法链接、认证、用户 ID 归属、去重、限频、数据库升级、外链安全、统计失败及可见曝光时机。

发布前在 macOS / Windows 实机验收：正常卡片、深浅色、侧栏收起、失焦最小化不曝光、坏图隐藏、系统浏览器跳转，以及关闭诊断统计后广告事件仍独立记录。
