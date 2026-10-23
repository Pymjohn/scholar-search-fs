#!/usr/bin/env node
// Google 学术检索：通过 openbrowser 的 CDP 接口取回结构化结果。
//
// 用法:
//   node scholar_search.mjs "查询词" [--limit N] [--from YYYY] [--to YYYY]
//                              [--sort-date] [--page N] [--json]
//
// 依赖: openbrowser 已安装（默认 /opt/openbrowser），脚本会自动拉起并开启 9222 端口。

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.SCHOLAR_CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;
const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, "ensure_browser.sh");

const argv = process.argv.slice(2);
const opts = { limit: 10, from: null, to: null, sortDate: false, page: 1, json: false };

const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--limit") opts.limit = Number(argv[++i]) || 10;
  else if (a === "--from") opts.from = Number(argv[++i]);
  else if (a === "--to") opts.to = Number(argv[++i]);
  else if (a === "--page") opts.page = Number(argv[++i]) || 1;
  else if (a === "--sort-date") opts.sortDate = true;
  else if (a === "--json") opts.json = true;
  else positional.push(a);
}

const query = positional.join(" ").trim();
if (!query) {
  console.error('用法: node scholar_search.mjs "查询词" [--limit N] [--from 2020] [--to 2026] [--sort-date] [--page 2] [--json]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpAlive() {
  try {
    const res = await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  if (await cdpAlive()) return;
  try {
    execFileSync(LAUNCHER, ["start"], { stdio: "ignore", timeout: 40000 });
  } catch {
    // 失败在下面统一报错
  }
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await cdpAlive()) return;
  }
  throw new Error(
    `无法连接 CDP（端口 ${PORT}）。请确认已安装 openbrowser，或手动运行: bash ${LAUNCHER} start`
  );
}

async function newTarget(url) {
  const res = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`创建标签页失败: HTTP ${res.status}`);
  return res.json();
}

async function closeTarget(id) {
  try {
    await fetch(`${BASE}/json/close/${id}`, { signal: AbortSignal.timeout(3000) });
  } catch {
    // 关闭失败不影响结果
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    ws.onopen = () => resolve({ ws, send });
    ws.onerror = () => reject(new Error("CDP 连接失败"));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    };
    function send(method, params = {}) {
      const id = ++seq;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
  });
}

// 页面内只负责抓原始文本，字段解析放在 Node 侧，避免模板字符串里的转义失误。
const EXTRACT = `(() => {
  const body = document.body.innerText || "";
  const rows = [...document.querySelectorAll(".gs_ri")].slice(0, ${opts.limit}).map((el) => ({
    title: (el.querySelector("h3 a") || {}).innerText || "",
    link: (el.querySelector("h3 a") || {}).href || "",
    meta: (el.querySelector(".gs_a") || {}).innerText || "",
    snippet: (el.querySelector(".gs_rs") || {}).innerText || "",
    fl: [...el.querySelectorAll(".gs_fl a")].map((x) => x.innerText).join(" | "),
    pdf: (el.querySelector(".gs_or_ggsm a") || {}).href || "",
  }));
  return JSON.stringify({
    url: location.href,
    title: document.title,
    summary: (document.querySelector(".gs_ab_md") || {}).innerText || "",
    bodyHead: body.slice(0, 500),
    rows,
  });
})()`;

function parseRow(raw) {
  // Google 的元信息里用不换行空格包围连字符，先归一化再分段
  const meta = (raw.meta || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const parts = meta.split(" - ").map((s) => s.trim());
  const yearMatch = meta.match(/\b(1[89]\d{2}|20\d{2})\b/);
  const citedMatch = raw.fl.match(/被引用次数：(\d+)/) || raw.fl.match(/Cited by (\d+)/);
  const venueRaw = parts[1] || "";
  const venue = venueRaw.replace(/[,，]\s*(1[89]\d{2}|20\d{2})\s*$/, "").trim();
  return {
    title: raw.title,
    link: raw.link,
    authors: parts[0] || "",
    venue,
    year: yearMatch ? Number(yearMatch[1]) : null,
    cited: citedMatch ? Number(citedMatch[1]) : 0,
    snippet: raw.snippet,
    pdf: raw.pdf,
  };
}

function isChallenged(title, bodyHead) {
  return /unusual traffic|机器人|验证码|Just a moment|not a robot/i.test(`${title}\n${bodyHead}`);
}

(async () => {
  await ensureBrowser();

  const qs = new URLSearchParams({ hl: "zh-CN", q: query });
  if (opts.from) qs.set("as_ylo", String(opts.from));
  if (opts.to) qs.set("as_yhi", String(opts.to));
  if (opts.sortDate) qs.set("scisbd", "1");
  if (opts.page > 1) qs.set("start", String((opts.page - 1) * 10));
  const searchUrl = `https://scholar.google.com/scholar?${qs.toString()}`;

  const target = await newTarget(searchUrl);
  const { ws, send } = await connect(target.webSocketDebuggerUrl);

  await send("Page.enable");
  await send("Page.navigate", { url: searchUrl });

  let payload = null;
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    const r = await send("Runtime.evaluate", { expression: EXTRACT, returnByValue: true });
    const raw = r?.result?.value;
    if (!raw) continue;
    const parsed = JSON.parse(raw);
    if (isChallenged(parsed.title, parsed.bodyHead)) { payload = parsed; break; }
    if (parsed.rows?.length) { payload = parsed; break; }
  }
  ws.close();
  await closeTarget(target.id);

  if (payload && isChallenged(payload.title, payload.bodyHead)) {
    console.error("被 Google 判定为异常流量（出现人机验证）。降低频率后重试，或在浏览器窗口中手动完成一次验证。");
    process.exit(3);
  }
  if (!payload || !payload.rows?.length) {
    console.error("未取到结果：页面未加载完成或检索词无匹配。");
    process.exit(1);
  }

  const rows = payload.rows.map(parseRow);
  const summary =
    payload.summary.trim() ||
    (payload.bodyHead.match(/找到约[^\n]{0,40}/) || [])[0] ||
    (payload.bodyHead.match(/About [\d,]+ results/) || [])[0] ||
    `${rows.length} 条`;

  if (opts.json) {
    console.log(JSON.stringify({
      query,
      filters: { from: opts.from, to: opts.to, sortDate: opts.sortDate, page: opts.page },
      url: payload.url,
      summary,
      rows,
    }, null, 2));
    return;
  }

  console.log(`查询: ${query}${opts.from || opts.to ? `  [${opts.from || ""}-${opts.to || ""}]` : ""}`);
  console.log(`结果: ${summary}`);
  console.log("");
  rows.forEach((r, i) => {
    console.log(`${(opts.page - 1) * 10 + i + 1}. ${r.title}`);
    const line2 = [r.authors, r.venue, r.year].filter(Boolean).join(" · ");
    if (line2) console.log(`   ${line2}`);
    if (r.snippet) console.log(`   ${r.snippet.replace(/\s+/g, " ").slice(0, 160)}`);
    console.log(`   被引 ${r.cited} | ${r.link}${r.pdf ? ` | PDF ${r.pdf}` : ""}`);
    console.log("");
  });
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
