# Mareo 静态官网

独立于桌面应用和服务端。原生 HTML / CSS / JavaScript，无构建工具依赖。中英文内容均在 HTML 中；默认中文，切换后在当前浏览器记住选择。无统计、外部字体、登录或网关调用。

## 预览与部署

在仓库根目录运行 `python3 -m http.server 8080 --bind 127.0.0.1 --directory website`，打开 http://127.0.0.1:8080 。也可以直接打开 `index.html`（语言偏好保存取决于浏览器的本地文件策略）。

将以下内容原样上传到静态服务器的站点目录或子目录：

- `index.html`
- `privacy.html`
- `styles.css`
- `app.js`
- `assets/`

所有站内资源使用相对路径，不需要 SPA 路由回退或 Node.js。`README.md` 和 `test.mjs` 不需要部署。

## 开放下载

页面读取 `updates/latest.json` 中的 `version`、`downloads.macos` 和 `downloads.windows`。首屏与底部共用同一份下载配置。

沿用现有发布流程上传安装包并更新清单，无需逐个修改按钮。清单不可用时使用 `app.js` 中的 `downloadFallback`；清单提供下载对象但缺少某个平台时，该平台显示待开放提示。上线前验证清单和真实安装包链接，以及平台、版本和签名状态。

没有 JavaScript 时仍能浏览中文产品介绍，首屏提示启用 JavaScript 获取下载链接。请使用 HTTP 预览验证下载功能。

## 维护

- 文案：修改 `index.html` 中成对的 `lang="zh-CN"` / `lang="en"` 内容。页标题和描述在 `app.js` 的 `pageText` 中，同时保持 HTML 的默认中文元信息一致。
- 图片：复用已有品牌素材；`assets/mareo-workspace.png` 为用户提供的真实产品截图，保持完整比例。
- 下载入口使用 `data-download` 标识平台，待开放提示使用 `data-pending`，由同一次清单读取同步更新。
- 保留隐私说明、联系方式和备案信息。免费文案仅表示当前免费，不承诺永久免费。
- 署名保留 `Built on DeepSeek Harness`，明确 Mareo 是独立产品。模型请求需联网，页面没有承诺所有数据仅在本地处理。

## 验证

运行 `node --test website/test.mjs`，覆盖语言切换、记忆、存储不可用、双平台首屏与底部下载同步、清单不可用与缺失平台，以及本地资源与锚点。发布前检查中英文桌面和手机首屏入口及真实下载链接。
