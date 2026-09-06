# Mareo 官网（website/）

无框架纯静态站：`index.html` + `styles.css` + `app.js`。中英双语单页（页内语言切换，默认按浏览器语言；选择记忆在 localStorage）。

## 本地预览

```sh
cd website
python3 -m http.server 8080    # 打开 http://127.0.0.1:8080
```

## 改文案

文案直接在 `index.html` 里改。每个可翻译文本是一对内联节点：

```html
<p><span class="zh">中文文案</span><span class="en">English copy</span></p>
```

`html[lang]` 由 `app.js` 切换，CSS 只显示当前语言。新增小节时保持这个成对结构即可，不需要任何构建。

## 上线前必填的占位（都在 index.html 里搜注释）

| 占位 | 位置 | 说明 |
|---|---|---|
| ICP 备案号 | footer | `<!-- 上线前填写你的 ICP 备案号 -->` |
| 联系邮箱 | footer | `mailto:hello@example.com` |
| DMG SHA-256 | 下载区 | `<code id="dmg-sha">（待补充 / pending）</code>`，传完 DMG 后补 |

## 下载文件（不入 Git）

DMG 放哪：ECS 上站点根目录的 `downloads/` 下（约 200MB，不入仓库）。部署时从本机 `out/make/` 上传：

```sh
# 部署到服务器后
scp out/make/Mareo-0.1.0-arm64.dmg root@<ECS>:/var/www/mareo-site/downloads/
shasum -a 256 out/make/Mareo-0.1.0-arm64.dmg   # 把结果填进 index.html 的 SHA-256
```

## 部署（同 ECS nginx）

网站与网关同机（`mareo.cn` 大陆站）。服务器上：

```sh
mkdir -p /var/www/mareo-site/downloads
rsync -az website/ root@<ECS>:/var/www/mareo-site/
```

站点 nginx 配置示例见 `nginx-mareo.cn.conf.example`（需 DNS：`mareo.cn` 与 `www.mareo.cn` 的 A 记录指向 ECS；证书用阿里云免费证书或 Let's Encrypt，流程与网关一致）。

> 注意：这是**面向公众的官网**，正式上线前还需：补 ICP 备案号展示、隐私政策/用户协议页（后续新增）、替换为**签名版** DMG 下载。
