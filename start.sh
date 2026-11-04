#!/usr/bin/env bash
# 启动 Demo 开发服务器（后台运行），访问 http://localhost:7321
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEMO="${ROOT}/demo"
PORT=7321
PID_FILE="${ROOT}/.dev.pid"
LOG_FILE="${ROOT}/.dev.log"

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "已在运行（PID $(cat "${PID_FILE}")）：http://localhost:${PORT}"
  exit 0
fi
if lsof -ti tcp:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 ${PORT} 已被占用（PID $(lsof -ti tcp:${PORT} -sTCP:LISTEN | tr '\n' ' ')），可先运行 ./stop.sh"
  exit 1
fi

cd "${DEMO}"
if [[ ! -d node_modules ]]; then
  echo "首次运行，安装依赖…"
  npm install
fi

nohup npm run dev -- --port ${PORT} --strictPort > "${LOG_FILE}" 2>&1 &
echo $! > "${PID_FILE}"

for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:${PORT}"; then
    echo "已启动（PID $(cat "${PID_FILE}")）：http://localhost:${PORT}"
    echo "日志：${LOG_FILE}；停止：./stop.sh"
    exit 0
  fi
  if ! kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then break; fi
  sleep 0.5
done
echo "启动失败，查看日志：${LOG_FILE}"
tail -n 20 "${LOG_FILE}" || true
rm -f "${PID_FILE}"
exit 1
