# Phase 2 设计：微信扫码登录（网关侧）

> 状态：**设计稿，未实现**。等待微信开放平台「网站应用」资质（AppID/AppSecret、备案域名）后按此落地。
> Phase 1 的 token 粘贴制保留为降级通道与管理员通道，不被替换。

## 1. 目标与范围

**目标**：国内普通用户在 Mareo 登录窗用微信扫一扫即完成登录，全程不接触 token、更不接触 DeepSeek key；账号体系归你所有（网关侧 users 表），为将来订阅付费打底。

**本期做**：

- 网关新增微信 OAuth 登录端点 + 账号绑定（首次扫码自动建用户）
- Mareo 登录窗支持扫码流；token 粘贴制作为 fallback
- 数据模型扩展（unionid 唯一键 + oauth_states 一次性授权状态表）

**本期不做**：登出/多设备管理、token 过期刷新、账号合并、微信 App 内嵌登录（`snsapi_userinfo` 需移动应用资质）、付费。

## 2. 前置条件（外部，非代码）

1. 微信开放平台账号 + 创建「**网站应用**」，拿到 `AppID` / `AppSecret`
2. 回调域名走 HTTPS 且已**备案**（`redirect_uri` 必须是该域名下的 https 地址）
3. 网站应用默认只返回 `openid`；要拿跨应用稳定标识 **`unionid`**，需账号绑定开放平台且用户关注/绑定过——设计中以 unionid 为主键、openid 兜底
4. 面向公众提供生成式 AI 的备案/登记、与 DeepSeek 的商务关系（沿用 Phase 1 提醒）

## 3. 总体时序

```
Mareo 登录窗
 1) GET  /auth/providers            →  ["wechat","token"]（未配 AppID 则只返回 ["token"]）
 2) GET  /auth/wechat/start?scheme=http&host=127.0.0.1&port=41327
       网关：生成 state(随机32B) 入库(一次性,TTL 10min) → 302 到微信二维码页
 3) 用户手机微信扫码、确认
 4) 微信 302 → https://<你的域名>/auth/wechat/callback?code=..&state=..
       网关：校验并消费 state
             code 换 openid/unionid（调微信 sns/oauth2/access_token + /sns/userinfo）
             upsert users(provider='wechat', subject=unionid)
             签发 token（与 issue-token 同一套：随机值→库存 sha256）
       302 → http://127.0.0.1:41327/signin?token=..&state=..
 5) Mareo 本地回调端口收到 token → 调 /me 校验 → safeStorage 落库 → 关闭登录窗 → 进主流程
```

Mareo 到微信的中间两跳都发生在**登录窗内**（BrowserWindow 直接导航），只有最后一跳回到本机回调端口——不依赖自定义 URL scheme，绕开 macOS 协议注册与窗口拦截的不确定性。

## 4. 网关侧变更

### 4.1 配置（`.env` 新增）

```env
# 未配置 WECHAT_APP_ID 时，/auth/providers 只暴露 token 通道，微信端点返回 503
WECHAT_APP_ID=
WECHAT_APP_SECRET=
# 回调域名（含 https 前缀，用于拼微信 redirect_uri）
PUBLIC_ORIGIN=https://your-gateway-domain
```

### 4.2 数据模型

```sql
-- users 增加唯一约束（迁移 SQL，兼容已存在的 token 用户）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_subject ON users(provider, subject);

-- 新增：一次性 OAuth 授权状态（防 CSRF + 防重放）
CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,          -- 随机 32B base64url
  scheme     TEXT NOT NULL,             -- 登录窗传回的本机回调：http|mareo
  host       TEXT NOT NULL,             -- 允许 127.0.0.1 / localhost
  port       INTEGER,                   -- scheme=http 时使用
  createdAt  TEXT NOT NULL,
  expiresAt  TEXT NOT NULL              -- TTL 10 分钟
  -- consumedAt 不设列：消费即 DELETE，天然一次性
);
```

token 字段语义不变；一个用户可有多个有效 token（多设备）。

### 4.3 端点规格

| 端点 | 行为 |
|---|---|
| `GET /auth/providers` | 返回可用登录通道：`{ providers: ["token"] }` 或 `{ providers: ["wechat","token"] }` |
| `GET /auth/wechat/start` | 参数 `scheme=http\|mareo`、`host`、`port`（scheme=http 必填）。校验回调目标在 allowlist（127.0.0.1/localhost/[::1]，或配置的 `mareo` scheme）→ 生成 state 入库 → 302 `https://open.weixin.qq.com/connect/qrconnect?appid=..&redirect_uri=<PUBLIC_ORIGIN>/auth/wechat/callback&response_type=code&scope=snsapi_login&state=..&connect_redirect=1#wechat_redirect` |
| `GET /auth/wechat/callback` | 见 4.4 |
| `GET /me` | 不变（Mareo 用同一端点校验扫码签发的 token） |

### 4.4 回调处理逻辑（`callback`）

1. 校验 `code`、`state` 存在；按 state 查 `oauth_states`，**不存在或过期则 400 页面**；命中后 `DELETE` 该行（一次性）。
2. `GET https://api.weixin.qq.com/sns/oauth2/access_token?appid=..&secret=..&code=..&grant_type=authorization_code`
   - 取 `openid`；同时请求 `/sns/userinfo?access_token=..&openid=..` 取 `unionid`（拿不到 unionid 时退化为 openid 作 subject，并记录日志——同一微信用户换应用将无法合并，属可接受的降级）。
   - 微信侧返回 `errcode` → 按 4.5 错误处理。
3. upsert 用户：
   - `SELECT id FROM users WHERE provider='wechat' AND subject=:unionid` → 命中则复用；
   - 未命中 → `INSERT users(displayName=unionid 截断或昵称, provider='wechat', subject=unionid)`。
4. 签发 token（复用 Phase 1 `generateTokenSecret`/`hashToken`/`storeToken`），`label='wechat-login'`。
5. 302 回登录窗本机回调：
   - `scheme=http` → `http://{host}:{port}/signin?token=..&state=..`
   - `scheme=mareo`（预留，本期不做）→ `mareo://signin?token=..&state=..`

### 4.5 错误处理

| 场景 | 行为 |
|---|---|
| 微信回调带 `errcode`（如用户取消/`code` 过期） | 302 回本机回调 `?error=<code>`，登录窗展示"登录未完成，请重试" |
| `state` 无效/过期/重放 | 400 静态页，不携带任何 token |
| 未配置微信（AppID 空） | `/auth/wechat/*` 返回 503；`/auth/providers` 只给 `token` |
| 本机回调端口不可达 | 网关仍先 302（回调是浏览器行为）；Mareo 侧 10s 超时后提示重试 |

### 4.6 安全要点

- **state 一次性 + TTL**：防 CSRF 与授权码重放；不采用 JWT state（免密钥编排，库查即验）。
- **回调目标 allowlist**：`/auth/wechat/start` 只接受 127.0.0.1/localhost/[::1] 的回调地址或固定 scheme，防开放重定向。
- **token 不经 URL 之外泄露**：最后一跳是 loopback HTTP；token 落库前必须经 `/me` 校验成功（校验本身证明持有者）。
- 沿用 Phase 1：token 只存哈希；DeepSeek key 只在网关进程内。

## 5. Mareo 客户端变更（随实现细化，此处给设计意图）

1. **本地回调接收器**：主进程起一个一次性 `http://127.0.0.1:0` 监听，随机端口在发起 `/auth/wechat/start` 时传给网关；收到 `/signin?token=` 即停服。
2. **登录窗流程**：
   - 加载登录页 → 页面向主进程要 `/auth/providers`；
   - 含 `wechat`：主进程在登录窗内导航到 `/auth/wechat/start?scheme=http&host=127.0.0.1&port=<本地端口>`（自动随 302 进微信二维码页），并监听本机回调收 token → 校验 → 落库 → 关窗；
   - 仅 `token`（或用户点"使用访问令牌"）：沿用 Phase 1 粘贴框。
3. 登录页需展示当前网关地址（调试可见性）与微信/令牌两种入口的切换。

## 6. 验收清单（实现后）

1. 未配 AppID：登录窗只有 token 通道，原流程完全不变。
2. 配 AppID 后：扫码 → 授权 → 自动建用户 → Mareo 进主流程；`/me` 返回该用户昵称。
3. 再次扫码同 unionid：不重复建用户，复用原用户并叠加新 token。
4. `state` 重放/过期被拒；手工改回调 host 被拒。
5. 用户取消授权：登录窗显示可重试错误，不落任何 token。
6. usage 正常按用户记录（新老用户一致）。

## 7. 遗留与后续（非本期）

- token 长期有效（与 Phase 1 一致）：订阅付费阶段再加有效期/刷新/吊销管理
- unionid 不可用的降级合并策略
- `snsapi_userinfo` 移动端登录（若 Mareo 未来出移动版）
- 微信昵称/头像入库与展示（本期只存 unionid）
