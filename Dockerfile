# Family Wealth OS · 一体化镜像（SQLite 内嵌，开箱即用）
FROM node:22-alpine AS build
WORKDIR /app
# 先复制依赖清单与 schema（postinstall 需要 prisma generate）
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# curl：行情传输兜底；sqlite：一致备份；python3：发行商公开文件兼容传输。
RUN apk add --no-cache curl sqlite python3
COPY --from=build /app ./
# schema 备份：数据卷首次挂载为空时由入口脚本恢复
RUN cp /app/prisma/schema.prisma /app/schema.prisma.dist \
  && chmod +x /app/scripts/docker-entrypoint.sh
EXPOSE 3000
VOLUME ["/app/prisma"]
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
