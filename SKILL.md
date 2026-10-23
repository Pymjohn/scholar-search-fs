---
name: scholar-search
description: 用本机已安装的 openbrowser（Chromium 企业版）检索 Google 学术，返回标题、作者、期刊、年份、被引次数、链接与 PDF 地址。当用户想查文献、找论文、做文献综述、看某个方向的最新进展、核对被引次数、收集参考文献或直接提到 Google Scholar / 学术搜索 / 谷歌学术时使用。即使用户没说"Google 学术"，只要涉及学术文献检索也应优先用本技能，因为本机的 curl 与无头 Chromium 都无法访问该站点，只有这个浏览器进程能取到数据。
---

# Google 学术检索

本技能把"在浏览器里手动搜 Google 学术"变成一条命令：脚本通过 DevTools 协议驱动 openbrowser，导航到检索页，解析结果条目，输出结构化数据。

## 为什么必须是这个浏览器

这不是偏好问题，而是唯一可行路径。实测结论：

- 本机直接连接 `scholar.google.com:443` 会在 TCP 握手阶段被丢弃（`SYN-SENT` 无响应），`curl` 与普通无头 Chromium 都一样失败；
- openbrowser 加载同一页面却能返回真实结果，而其进程没有任何到 Google 网段的连接，连接都落在 `*.scholar.work` / `*.scholar.edu.cn` 的平台节点上；
- 也就是说，这个浏览器把请求交给了平台侧网关，由网关回源取回内容。

因此遇到"连不上 Google"时，不要尝试换 curl、换代理或改 DNS，直接用本技能的脚本。

## 前置条件

1. `openbrowser` 已安装，可执行文件在 `/opt/openbrowser/openbrowser`（包名 `openbrowser-cn-stable`）。若不存在，先让用户提供该 deb 并安装；不要用其他浏览器替代。
2. 有可用的 X 显示。WSL 下默认 `DISPLAY=:0`（WSLg）。浏览器是带窗口的进程，会弹出窗口，这是正常现象。
3. 端口 `9222` 未被占用；可用 `SCHOLAR_CDP_PORT` 改端口。

## 快速开始

```bash
# 检索 10 条
node scripts/scholar_search.mjs "retrosynthesis deep learning"

# 指定条数
node scripts/scholar_search.mjs "retrosynthesis template extraction" --limit 20

# 限定年份区间
node scripts/scholar_search.mjs "reaction condition prediction" --from 2020 --to 2026

# 按日期倒序（看最新进展）
node scripts/scholar_search.mjs "retrosynthesis" --sort-date --limit 15

# 分页取第二页
node scripts/scholar_search.mjs "retrosynthesis" --page 2

# 机器可读输出，便于写文件或二次处理
node scripts/scholar_search.mjs "retrosynthesis" --limit 50 --json > papers.json
```

脚本会自动判断浏览器是否在运行；不在则调用 `scripts/ensure_browser.sh start` 拉起，约 3 秒，取完数据后关闭自己开的标签页。

需要单独控制浏览器时：

```bash
bash scripts/ensure_browser.sh start    # 启动
bash scripts/ensure_browser.sh status   # 查看
bash scripts/ensure_browser.sh stop     # 停止
```

## 参数

| 参数 | 含义 | 默认 |
|---|---|---|
| 第一个位置参数 | 检索词，支持中英文与多词 | 必填 |
| `--limit N` | 返回条数（单页最多约 10 条，超过请配合 `--page`） | 10 |
| `--from YYYY` / `--to YYYY` | 年份区间，映射到 `as_ylo` / `as_yhi` | 不限 |
| `--sort-date` | 按日期排序（`scisbd=1`），用于追踪最新工作 | 按相关性 |
| `--page N` | 结果页码，每页 10 条 | 1 |
| `--json` | 输出 JSON，含 `rows[]` 与每条的被引数、PDF 链接 | 表格 |

## 输出字段

每条结果包含：

```
title     标题
link      落地页（出版商或仓储）
authors   作者串（来自 .gs_a 的第一段）
venue     期刊/会议（第二段）
year      年份（从元信息中提取）
cited     被引次数
snippet   摘要片段
pdf       PDF 直链（若无则为空）
```

`--json` 的顶层还有 `query`、`filters`、`url`、`summary`（如"找到约 721 条结果"）。

## 推荐的检索流程

1. 先用 5–10 条探路，确认关键词是否命中预期领域；Google 学术对同义词敏感，中英文结果差异较大，必要时两种语言各跑一次。
2. 确认方向后扩量：`--limit 20 --page 1..3`，每次之间停 2–3 秒，避免触发人机验证。
3. 需要按影响力筛选时，用 `--json` 取出后按 `cited` 排序；需要追踪前沿时用 `--sort-date`。
4. 需要全文时，优先用结果里的 `pdf` 字段；没有则用 `link` 拼 DOI 走出版商或开放获取渠道。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| `无法连接 CDP（端口 9222）` | 浏览器未安装或未启动。检查 `/opt/openbrowser/openbrowser` 是否存在，或手动执行 `bash scripts/ensure_browser.sh start` 看日志 `~/.local/share/openbrowser-auto/launch.log` |
| `被 Google 判定为异常流量` | 出现人机验证。降低频率、间隔 3 秒以上重试；或在弹出的浏览器窗口里手动完成一次验证后再跑 |
| 结果为空但页面正常 | 关键词太窄或语言不匹配。换同义词、放宽年份、去掉过长的词组 |
| 浏览器窗口干扰操作 | 这是无头模式不可用的结果（该构建剔除了 headless）。若必须静默运行，可安装 Xvfb 并用它提供虚拟显示，但需用户确认后再改 |
| 端口被占用 | 用 `SCHOLAR_CDP_PORT=9333` 换端口，脚本与启动器都读这个环境变量 |

## 边界与注意事项

- 这是面向个人科研的检索工具，不适合大规模抓取。单次几十条、带间隔使用没有问题；连续高频请求会触发验证，也会给对方服务造成负担。
- 请求经厂商平台转发，检索词对平台可见。涉及未公开课题时，提醒用户这一点。
- 结果来自 Google 学术的页面结构，若对方改版导致 `.gs_ri` 等选择器失效，需要更新 `scripts/scholar_search.mjs` 中的 `EXTRACT` 片段。
- 不要把这个能力用于访问文献之外的站点；它在设计上只解析学术检索页。
