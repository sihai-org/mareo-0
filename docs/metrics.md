# 指标定义（安装 / 启动 / 登录 / 引擎 / 首次任务）

数据来源只有两处：**gateway 数据库**（`usage` 与 `events` 表）与 **nginx / OSS 访问日志**（下载）。客户端上报的内容与边界见 [`privacy.md`](privacy.md)。

一条命令看全部：

```sh
# 本地库
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
- 分母：**下载次数**，只能从外部日志取——OSS 访问日志（推荐，需在控制台开启，把日志投递到某个 bucket）或 nginx `access.log` 里 `/downloads/*` 的请求数。
- 口径提醒：这个数本质是"**装上并且登录成功过**"。装好但登录失败的用户不计入分子，因此它同时受登录可用性影响——这正是我们想要的保守口径。

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
