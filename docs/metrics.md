# 指标定义（安装 / 启动 / 登录 / 引擎 / 首次任务）

数据来源只有两处：**gateway 数据库**（`usage` 与 `events` 表）与 **nginx / OSS 访问日志**（下载）。客户端上报的内容与边界见 [`privacy.md`](privacy.md)。

一条命令看全部：

```sh
# 1) 先算出下载次数（分母），从 OSS 访问日志读
npm run downloads:oss                 # 最近 7 天，凭据取 .env.oss
npm run downloads:oss -- --days 30

# 2) 再出全部指标（本地库）
npm run --prefix server metrics -- --downloads 137

# 线上（ECS 上的容器里跑）
ssh root@114.55.15.112 'cd /srv/mareo/server/deploy && docker compose exec -T gateway node dist/src/metrics.js --downloads 137'
```

`--downloads` 传最近的下载完成次数（见下文"下载次数"），不传则跳过安装成功率。

## 1. 安装成功率

```
安装成功率 = 有 install_confirmed 事件的账户数 ÷ 下载次数
```

- 分子：客户端在**首次成功启动并登录后**上报一次 `install_confirmed`，本地用 `<userData>/.install-reported` 去重；上报失败不写标记，下次启动会重试。
- 分母：**下载次数**，来自 OSS 访问日志——`npm run downloads:oss` 统计的是"HTTP 200 的 `GetObject` 且对象名是我们的安装包（`.dmg` / `.exe`）"，自动排除图标、清单、nupkg、目录列举与 HEAD 请求。
- 口径提醒：这个数本质是"**装上并且登录成功过**"。装好但登录失败的用户不计入分子，因此它同时受登录可用性影响——这正是我们想要的保守口径。

### OSS 访问日志

- bucket `mareo-downloads` → 日志管理 → 日志转存：已开启，前缀 `oss-accesslog/`，**开启日期前缀**（后置，形如 `<SourceBucket>/YYYYMMDD/`）。
- 因此实际对象形如 `oss-accesslog/mareo-downloads/20260913/…`；`npm run downloads:oss` 直接遍历 `oss-accesslog/` 前缀，所以布局变化不影响它。
- **按小时投递**：某个小时的日志要等该小时结束后才写入，刚开启或近一小时没有真实下载时结果为空——这是正常的，不代表配置错误。
- 只有真实下载才产生 `GetObject`；官网点击走 `mareo.cn/downloads/...` 的 302 也会落到这里（客户端跟随重定向到 OSS）。
- ⚠️ **日志不要留在 `mareo-downloads`**：该 bucket 是公共读，日志对象（含访客 IP、User-Agent、请求对象名）会同样公开可读。应把日志转存到**另一个私有 bucket**（例如 `mareo-logs`，读写权限设为私有），然后：
  - 在 `.env.oss` 里加 `OSS_LOG_BUCKET=mareo-logs`（脚本优先用它，未设置时回退到 `OSS_BUCKET`）；
  - 给 RAM 用户补上该 bucket 的读权限。

## 2. 第一次启动是否稳定

```
启动成功率 = 事件 launch 中 ok=true 的数量 ÷ launch 总数      （按平台 / 版本分组）
```

- 每次启动结束于某个阶段都会上报一次；失败事件带 `stage`：`update-required`（被最低版本拦下）、`signed-out`（用户在登录页退出）、`account-incomplete`、`harness`（引擎起不来，带错误描述）。
- 只有打包版会上报，开发模式不上报。

## 3. 登录 / 模型调用稳定性

```
登录：signin 事件按 result 分组（ok / wrong-code / expired / too-many-attempts / send-failed / unreachable / cancelled）
模型：usage 表 status = 200 的比例，配合 latencyMs 的 p50 / p95
```

- `signin` 里的 `send-*` 是发验证码这一步的结果，`cancelled` 表示用户关掉了登录窗口——两者一起能看出漏斗在哪一步漏。
- 模型调用由网关自己记账，不依赖客户端，所以即使客户端上报失败也拿得到。

## 4. 引擎（DSH）异常退出

```
异常退出率 = harness_exit 事件数 ÷ launch 成功数 × 1000   （每千次启动）
```

- 引擎进程非预期退出时上报，带 `reason`（截断的错误描述）与 `ms`（已运行时长）；正常退出（用户关窗、退出登录）不会上报。
- 客户端同时会弹本地错误框并把日志写到 `<userData>/logs/mareo.log`。

## 5. 第一次任务能否完成

```
首次任务成功 = 该账户的首个 status = 200 的模型请求 ÷ 有模型请求的账户数
```

- 直接从 `usage` 算，不需要客户端埋点：`min(ts) FILTER (status = 200)` per account。
- 口径提醒：这是"**第一次调用就拿到了模型响应**"，不等于"用户对结果满意"。后者需要产品层的反馈机制，不在本指标内。

## 数据边界

- `events` 表只有四个事件名，写成白名单；字段固定为 `accountId`（可空）、`name`、`version`、`platform`、`ts`、`detail`（≤500 字符，客户端自行截断）。
- 单次请求最多 20 条事件；未登录的匿名事件按来源地址限流（默认每小时 60 条），且不落库 IP。
- 用户关闭统计后，客户端不再发送任何请求（`src/telemetry.ts` 的 `record` / `sendNow` 直接返回）。
