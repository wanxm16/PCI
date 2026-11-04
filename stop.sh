#!/usr/bin/env bash
# 停止 Demo 开发服务器
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=7321
PID_FILE="${ROOT}/.dev.pid"
stopped=0

# 先按 PID 文件停止整个进程树（npm → vite）
if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}")"
  if kill -0 "${PID}" 2>/dev/null; then
    pkill -TERM -P "${PID}" 2>/dev/null
    kill -TERM "${PID}" 2>/dev/null && stopped=1
  fi
  rm -f "${PID_FILE}"
fi

# 兜底：清理仍在监听端口的进程
sleep 0.5
PIDS="$(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  kill -TERM $PIDS 2>/dev/null && stopped=1
  sleep 0.5
  PIDS="$(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$PIDS" ]] && kill -KILL $PIDS 2>/dev/null
fi

if [[ $stopped -eq 1 ]]; then echo "已停止（端口 ${PORT}）"; else echo "未在运行"; fi
