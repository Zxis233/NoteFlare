<div align="center">

# 🔥 NoteFlare

**随手记，随处见。**

一个运行在 Cloudflare 上的轻量在线剪贴板。<br />
打开即写，用一个链接，在不同设备间接续你的文字。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Cloudflare D1](https://img.shields.io/badge/Storage-D1-F38020?style=flat&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.12-5FA04E?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-86B89A?style=flat)](LICENSE)

[功能特性](#功能特性) · [快速开始](#快速开始) · [部署指南](#部署指南) · [开发与测试](#开发与测试) · [路线图](#路线图)

</div>

---

NoteFlare 面向个人及少量熟人的日常记录、文本传递和 Markdown 草稿。无需普通用户注册，也无需自行维护服务器；笔记存储在 D1，页面与 API 由 Workers 提供，管理员通过 Cloudflare Access 登录。

> **链接即读写凭证。** 任何持有笔记链接的人都可以读取和修改内容，请妥善分享。实际免费运行范围取决于 Cloudflare 配额和使用量。

## 功能特性

|       | 功能          | 说明                                                   |
| :---: | ------------- | ------------------------------------------------------ |
|   ✍️   | 打开即写      | 自动生成随机链接，首次保存非空内容时创建笔记           |
|   🌓   | 暗色工作区    | 扁平界面、自定义图片背景、可调深色遮罩                 |
|   📝   | Markdown 编辑 | 行号、等宽字体、语法高亮、自动换行，单篇最大 200 KiB   |
|   👀   | 实时预览      | 桌面双栏可关闭，移动端切换编辑与预览                   |
|   ☁️   | 自动保存      | 每 30 秒保存修改，支持 `Ctrl / Cmd + S` 手动保存       |
|   💾   | 本地草稿      | 刷新后恢复未保存内容，支持下载 Markdown                |
|   🔗   | 可调短链接    | 3–8 位字母与数字，默认 8 位，碰撞不会覆盖已有笔记      |
|   ⏳   | 到期清理      | 默认最后修改后保留 30 天，支持设置 1–365 天保留期      |
|   ⚙️   | 管理面板      | 外观设置、数量统计、过期清理及清空确认，不公开列举正文 |
|   🛡️   | 访问保护      | 管理端验证 Access JWT，笔记接口限流，Markdown 安全处理 |

## 快速开始

需要 Node.js 22.12+ 与 npm。首次安装需要联网下载依赖；本地运行不需要 Cloudflare 账号。

克隆或下载本仓库，进入项目目录后运行：

```sh
npm ci
npm run dev
```

| 入口     | 地址                          |
| -------- | ----------------------------- |
| 编辑器   | <http://127.0.0.1:5173>       |
| 管理面板 | <http://127.0.0.1:5173/admin> |

`dev` 会先构建静态资源、应用本地 D1 migrations，再启动 Wrangler（8787）和 Vite（5173）。Vite 提供热更新，`/api` 代理到 Wrangler。首次编译可能需要等待几秒。使用 Ctrl+C 停止。

<details>
<summary>本地运行与生产构建预览</summary>

本地管理员免登录，仅当公共配置开启 `ALLOW_LOCAL_ADMIN` 且请求主机是 localhost/127.0.0.1/::1 时生效。脚本只监听 127.0.0.1，不要将本地开发端口反向代理到公网。

本地数据库保存在 `.wrangler/state`，不影响远程数据库。修改 migration 后可执行 `npm run db:local`。本地不会自动运行 Cron，可在后台测试清理，或访问 `http://127.0.0.1:8787/cdn-cgi/local/scheduled` 手动触发本地定时任务。

测试生产构建（无热更新）：

```sh
npm run preview
# http://127.0.0.1:8787
```

</details>

## 技术栈

| 层级       | 技术                                   |
| ---------- | -------------------------------------- |
| 界面       | React · TypeScript · Vite              |
| 编辑与预览 | CodeMirror 6 · markdown-it · DOMPurify |
| API        | Cloudflare Workers · Hono              |
| 数据库     | Cloudflare D1                          |
| 静态资源   | Workers Static Assets                  |
| 管理认证   | Cloudflare Access                      |
| 定时维护   | Workers Cron Triggers                  |

当前版本仅使用 Workers 与 D1，无需配置 KV 或 R2。

## 部署指南

部署前需要 Cloudflare 账号，以及已接入 Cloudflare 的域名或子域名。

### 1. 准备部署配置

项目使用 **TOML** 格式的 Wrangler 配置：

| 文件                             | 用途                                       | 是否提交 Git            |
| -------------------------------- | ------------------------------------------ | ----------------------- |
| [`wrangler.toml`](wrangler.toml) | 通用模板及本地开发；公开的数据库 ID 占位符 | 是                      |
| `wrangler.private.toml`          | 个人域名、数据库和 Access 应用配置         | 否，已加入 `.gitignore` |

两份配置都是完整配置，**不会自动合并**。从 GitHub 克隆后，私人文件不存在，可执行：

```powershell
# PowerShell
Copy-Item wrangler.toml wrangler.private.toml
```

```sh
# macOS/Linux
cp wrangler.toml wrangler.private.toml
```

如果私人配置已经存在，直接编辑即可。填写实际部署参数，不要提交个人配置。

密钥不要写入 TOML。线上 `APP_SECRET` 通过 Wrangler secret 保存；本地可选用未跟踪的 `.dev.vars`。只在本机开发且未设置密钥时，应用使用固定的开发密钥。

### 2. 登录并创建数据库

```sh
npx wrangler login
npx wrangler d1 create noteflare-personal --config wrangler.private.toml
```

将返回的 `database_id` 和数据库名称填入 `wrangler.private.toml`，并设置 Worker 名称。配置自己的域名，例如：

```toml
workers_dev = false
preview_urls = false
routes = [{ pattern = "notes.your-domain.com", custom_domain = true }]
```

以上字段应放在 `[assets]`、`[vars]` 等表定义之前。域名应已托管在 Cloudflare。私人配置建议关闭 workers.dev 和预览地址；服务端仍会独立验证管理请求。

### 3. 配置管理员 Access

在 Cloudflare Zero Trust 中创建 Self-hosted Access 应用，将同一个应用保护范围设为：

- `notes.your-domain.com/admin` 及其子路径。
- `notes.your-domain.com/api/admin` 及其子路径。

使用 Allow 策略仅允许你指定的邮箱，配置 One-time PIN 或已有身份提供方。**不要保护整个站点**，普通笔记仍需匿名访问。当前版本只接受一个应用 AUD，请将两个管理路径配置在同一个 Access 应用中。

将团队域名与该应用 AUD 填入私人 TOML：

```toml
[vars]
ALLOW_LOCAL_ADMIN = "false"
ACCESS_TEAM_DOMAIN = "your-team.cloudflareaccess.com"
ACCESS_AUD = "your-application-aud"
```

团队域名不带 `https://`。应用会验证 JWT 的签名、签发者、受众和有效期，不仅检查 header 是否存在。Access 未配置时，公网管理入口拒绝访问。

### 4. 设置应用密钥、迁移并部署

生成至少 32 字符的随机密钥（例如 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`），然后在下面命令的交互提示中粘贴：

```sh
npx wrangler secret put APP_SECRET --config wrangler.private.toml
npm run db:remote
npm run deploy
```

`APP_SECRET` 用于签发新笔记创建凭证。新凭证 7 天有效；超过期限仍未首次保存时，下载或复制草稿，再新建笔记。更换密钥会使未保存的新建凭证失效，不影响已经保存的笔记。

若希望直接使用通用配置部署，填写 `wrangler.toml` 对应值，使用 `--config wrangler.toml` 设置 secret 和执行远程迁移，再执行 `npm run deploy:public`。本地部署脚本不会自动运行远程迁移，以免误改线上库。

## 使用约定

- 单篇上限为 200 KiB（204,800 个 UTF-8 字节，界面标作 KB）。已有笔记允许清空正文。
- 只有正文修改并成功保存时续期；阅读或保存相同内容不续期。调整保留期限仅影响新建或下一次修改保存，不批量改变已有到期时间。
- “活跃笔记”指尚未过期的笔记，不代表当前在线人数。
- 创建限制：每 IP 每分钟 20 次；保存：120 次；读取笔记：180 次。可在两份 TOML 中分别调整。Cloudflare Rate Limit 绑定按地点计数，是尽力而为的限流，不是严格全球计数器。多个设备共用出口 IP 时共享限额。
- 3 位链接空间有限，且持有链接即可读写；默认使用 8 位。数据库唯一约束阻止碰撞覆盖，空间不足时请求失败，不自动更改管理员设定的长度。
- 保存只存最新正文。多设备修改会覆盖；同一页面的请求串行提交。本地草稿不是跨设备备份，可下载 Markdown 保存副本。
- 附件暂不支持；Markdown 外链图片由浏览器访问，图片地址和加载可用性由外部站点决定。
- 清理每批最多 500 篇，每日任务最多 10 批，避免无界执行；超出部分留待后续清理，后台显示最近批次/任务状态。未物理删除的过期笔记仍不可访问。后台手动清理会连续调用小批次，关闭页面会停止后续批次。
- 清空全部按操作开始时的时间截点删除，操作期间新创建的笔记保留；已删除笔记的旧页面不能通过普通保存恢复。
- D1 超额或断网时会显示保存失败并保留本地草稿。自动保存无法保证关页前最后一次修改已上传。
- 默认 Cron 为 UTC `15 19 * * *`，即北京时间每日 03:15。线上 Cron 生效可能需要等待平台传播。
- 所有页面禁止索引；笔记 API 不缓存；这不是端到端加密，Cloudflare 账户管理员可以访问数据库。

## 开发与测试

```sh
# 类型检查与单元测试
npm run typecheck
npm test

# 构建及本地接口集成测试
npm run build
npm run test:integration

# 浏览器测试（首次需要安装 Chromium）
npx playwright install chromium
npm run test:e2e
```

| 测试         | 覆盖内容                                                |
| ------------ | ------------------------------------------------------- |
| 单元测试     | UTF-8 大小限制、链接格式、设置校验                      |
| 接口集成测试 | 创建与碰撞、保存与续期、过期、定时清理、设置及访问保护  |
| 浏览器测试   | 自动保存、草稿恢复、Markdown 安全、移动端预览、管理操作 |

集成测试使用 `8791` 端口，浏览器测试使用 `8792` 端口，均创建独立本地数据库，不修改日常开发库。浏览器截图及失败追踪输出到 `test-results/`。

### 项目结构

```text
NoteFlare/
├── src/                    # React 编辑器与管理界面
├── server/                 # API、Access 验证、定时清理
├── shared/                 # 公共类型与限制
├── migrations/             # D1 数据库迁移
├── scripts/                # 本地测试辅助脚本
├── tests/                  # Playwright 浏览器测试
├── wrangler.toml           # 通用配置
└── wrangler.private.toml   # 私人部署配置，不随仓库分发
```

发布 GitHub 前运行 `git status --short` 与 `git check-ignore wrangler.private.toml`，确认个人配置、`.dev.vars`、本地数据库及构建产物未被提交。

## 路线图

以下为后续计划，当前版本尚未提供附件上传：

- [ ] 使用 R2 存储附件，D1 保存附件元数据。
- [ ] 支持上传大小、类型限制及附件与笔记关联。
- [ ] 删除笔记时清理附件，并支持失败重试。
- [ ] 清理孤立附件，避免无关联对象长期占用空间。

## 参与贡献

欢迎通过 Issues 反馈问题或提交 Pull Request。报告问题时请附上复现步骤、运行环境和必要的脱敏日志；提交代码前请运行相关测试。

请勿在 Issue、截图或提交记录中包含私人笔记链接、Access 凭据或部署密钥。

## 许可证

本项目采用 [MIT License](LICENSE)。

Copyright © 2026 Esing.
