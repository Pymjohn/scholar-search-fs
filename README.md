# scholar-search

通过 openbrowser（Chromium 企业版）的 DevTools 协议检索 Google 学术，输出标题、作者、期刊、年份、被引次数、链接与 PDF 地址。

## 为什么需要它

本机直连 `scholar.google.com:443` 在 TCP 握手阶段即被丢弃，`curl` 与普通无头 Chromium 均无法访问。openbrowser 的请求经其平台网关转发（连接落在 `*.scholar.work` / `*.scholar.edu.cn` 节点），是当前唯一可达的路径。这一点已通过套接字观测确认，因此本工具不提供代理，也不对其他站点生效。

## 依赖

- `openbrowser-cn-stable`，可执行文件位于 `/opt/openbrowser/openbrowser`
- 可用的 X 显示（WSL 下默认 `DISPLAY=:0`，由 WSLg 提供）
- Node.js 18 以上（使用内置 `fetch` 与 `WebSocket`，实测 Node 24）

浏览器是带窗口进程，运行时会弹出窗口；这是该构建剔除了无头模式的直接后果。

## 使用

```bash
node scripts/scholar_search.mjs "retrosynthesis deep learning"
node scripts/scholar_search.mjs "reaction condition prediction" --limit 20
node scripts/scholar_search.mjs "photocatalyst" --from 2022 --to 2026 --sort-date
node scripts/scholar_search.mjs "retrosynthesis" --page 2
node scripts/scholar_search.mjs "electrocatalyst" --limit 50 --json > papers.json
```

脚本会自动拉起浏览器（约 3 秒），取完数据后关闭自己开的标签页。

单独控制浏览器：

```bash
bash scripts/ensure_browser.sh start
bash scripts/ensure_browser.sh status
bash scripts/ensure_browser.sh stop
```

## 参数

| 参数 | 含义 | 默认 |
|---|---|---|
| 位置参数 | 检索词，可多词、可中文 | 必填 |
| `--limit N` | 返回条数 | 10 |
| `--from YYYY` / `--to YYYY` | 年份区间 | 不限 |
| `--sort-date` | 按日期倒序 | 相关性 |
| `--page N` | 页码，每页 10 条 | 1 |
| `--json` | 输出 JSON | 表格 |

`--json` 的 `rows[]` 字段：`title / link / authors / venue / year / cited / snippet / pdf`。

## 目录

```
SKILL.md                    技能说明（触发条件、流程、故障排查）
scripts/scholar_search.mjs  检索与解析
scripts/ensure_browser.sh   浏览器启动、状态、停止
```

## 使用边界

面向个人科研检索，不适合大规模抓取；连续高频请求会触发人机验证。检索词经厂商平台转发，对平台可见。

## 环境变量

- `SCHOLAR_CDP_PORT`：CDP 端口，默认 9222
- `OPENBROWSER_BIN`：浏览器可执行文件路径，默认 `/opt/openbrowser/openbrowser`
