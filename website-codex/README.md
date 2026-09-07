# Mareo 静态官网

独立于桌面应用、服务端及 `website/`。原生 HTML / CSS / JavaScript，无安装步骤、构建工具或服务端依赖。中英文内容均在 HTML 中；默认中文，切换后在当前浏览器记住选择。无统计、外部字体、登录或网关调用。

## 预览与部署

在仓库根目录运行 `python3 -m http.server 8080 --bind 127.0.0.1 --directory website-codex`，打开 http://127.0.0.1:8080 。也可以直接打开 `index.html`（语言偏好保存取决于浏览器的本地文件策略）。

将以下内容原样上传到静态服务器的站点目录或子目录：

- `index.html`
- `styles.css`
- `app.js`
- `assets/`

所有站内资源使用相对路径，不需要 SPA 路由回退或 Node.js。`README.md` 和 `test.mjs` 不需要部署。

## 开放下载

当前未提供安装包地址，页面明确显示「下载即将开放」，不会指向不存在的文件。

1. 上传准备发布的 macOS Apple Silicon DMG 到自己的服务器或下载存储。
2. 修改 `app.js` 第一项配置 `downloadUrl`，填入真实 HTTPS URL，或相对地址，例如 `downloads/Mareo-0.1.0-arm64.dmg`。使用相对地址时，把对应文件一起部署。
3. 刷新页面，下载按钮会自动取代待开放提示。检查链接返回真实 DMG 文件，而非 HTML 错误页；外部存储应设置正确的下载文件名和响应头。
4. 上线前自行确认安装包版本、支持的 macOS 版本、签名和公证状态。此页面不宣称现有安装包已经签名、公证或正式发布；不要把内部测试包误标为正式版。

没有 JavaScript 时仍能浏览中文产品介绍，下载保持待开放状态。若要求关闭 JavaScript 也可下载，发布时直接在 HTML 的 `download-link` 上填入 `href`、移除 `hidden`，并给 `download-pending` 添加 `hidden`。

## 维护

- 文案：修改 `index.html` 中成对的 `lang="zh-CN"` / `lang="en"` 内容。页标题和描述在 `app.js` 的 `pageText` 中，同时保持 HTML 的默认中文元信息一致。
- 图片：`assets/logo.png`、`assets/app-icon.png` 直接复用已有品牌素材，没有重新绘制。
- 更多平台：在下载区添加对应平台条目与真实链接即可；当前没有自动更新、版本解析或操作系统检测。
- 域名、联系方式、备案信息等未提供，因此未虚构这些内容；按自己的实际发布要求补充。
- 署名保留 `Built on DeepSeek Harness`，明确 Mareo 是独立产品。模型请求需联网，页面没有承诺所有数据仅在本地处理。

## 验证

运行 `node --test website-codex/test.mjs`，覆盖语言切换、记忆、存储不可用、下载开关以及本地资源与锚点引用。发布前同时检查中英文桌面和手机布局，以及真实下载链接。
