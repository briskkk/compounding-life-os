#!/bin/bash
# Family Wealth OS · 定时备份入口（launchd 调用）
set -e
cd /Users/hua/Projects/Portfolio
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
/usr/local/bin/node node_modules/.bin/tsx scripts/backup.ts
