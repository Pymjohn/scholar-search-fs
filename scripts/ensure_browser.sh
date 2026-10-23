#!/usr/bin/env bash
# 启动 openbrowser 并开启 CDP 端口，供 scholar_search.mjs 使用。
# 用法: ensure_browser.sh [start|stop|status]
set -uo pipefail

PORT="${SCHOLAR_CDP_PORT:-9222}"
PROFILE="${HOME}/.local/share/openbrowser-auto"
BIN="${OPENBROWSER_BIN:-/opt/openbrowser/openbrowser}"
URL="http://127.0.0.1:${PORT}/json/version"

alive() { curl -sf -m 2 "$URL" >/dev/null 2>&1; }

case "${1:-start}" in
  status)
    if alive; then echo "运行中，端口 ${PORT}"; else echo "未运行"; fi
    ;;
  stop)
    pkill -f "${BIN}.*remote-debugging-port=${PORT}" && echo "已停止" || echo "未在运行"
    ;;
  start)
    if alive; then echo "已在运行，端口 ${PORT}"; exit 0; fi
    if [ ! -x "$BIN" ]; then
      echo "找不到浏览器: ${BIN}" >&2
      echo "请先安装 openbrowser-cn-stable，或设置 OPENBROWSER_BIN 指向其可执行文件。" >&2
      exit 1
    fi
    mkdir -p "$PROFILE"
    export DISPLAY="${DISPLAY:-:0}"
    nohup "$BIN" \
      --remote-debugging-port="${PORT}" \
      --user-data-dir="$PROFILE" \
      --no-first-run --no-default-browser-check \
      --disable-background-networking \
      about:blank >"${PROFILE}/launch.log" 2>&1 &
    for _ in $(seq 1 40); do
      sleep 0.5
      if alive; then echo "已启动，端口 ${PORT}"; exit 0; fi
    done
    echo "启动失败，日志: ${PROFILE}/launch.log" >&2
    exit 1
    ;;
  *)
    echo "用法: ensure_browser.sh [start|stop|status]" >&2
    exit 2
    ;;
esac
