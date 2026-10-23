#!/usr/bin/env bash
# 启动 openbrowser 并开启 CDP 端口，供 scholar_search.mjs 使用。
# 用法: ensure_browser.sh [start|stop|status]
# 环境变量:
#   SCHOLAR_CDP_PORT   调试端口，默认 9222
#   OPENBROWSER_BIN    浏览器路径，默认 /opt/openbrowser/openbrowser
#   SCHOLAR_HEADLESS   1（默认）无窗口运行；0 则弹出窗口
set -uo pipefail

PORT="${SCHOLAR_CDP_PORT:-9222}"
PROFILE="${HOME}/.local/share/openbrowser-auto"
BIN="${OPENBROWSER_BIN:-/opt/openbrowser/openbrowser}"
HEADLESS="${SCHOLAR_HEADLESS:-1}"
URL="http://127.0.0.1:${PORT}/json/version"

alive() { curl -sf -m 2 "$URL" >/dev/null 2>&1; }

case "${1:-start}" in
  status)
    if alive; then
      echo "运行中，端口 ${PORT}"
    else
      echo "未运行"
    fi
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

    # 该构建剔除了 --headless，但 Chromium 的 headless 臭氧平台仍可用，
    # 能让窗口完全不出现；需要看界面调试时设 SCHOLAR_HEADLESS=0。
    extra=()
    if [ "$HEADLESS" = "1" ]; then
      unset DISPLAY WAYLAND_DISPLAY
      extra+=(--ozone-platform=headless)
    else
      export DISPLAY="${DISPLAY:-:0}"
    fi

    nohup "$BIN" "${extra[@]}" \
      --remote-debugging-port="${PORT}" \
      --user-data-dir="$PROFILE" \
      --no-first-run --no-default-browser-check \
      --disable-background-networking \
      about:blank >"${PROFILE}/launch.log" 2>&1 &

    for _ in $(seq 1 40); do
      sleep 0.5
      if alive; then
        echo "已启动，端口 ${PORT}（$( [ "$HEADLESS" = "1" ] && echo 无窗口 || echo 有窗口 )）"
        exit 0
      fi
    done
    echo "启动失败，日志: ${PROFILE}/launch.log" >&2
    exit 1
    ;;
  *)
    echo "用法: ensure_browser.sh [start|stop|status]" >&2
    exit 2
    ;;
esac
