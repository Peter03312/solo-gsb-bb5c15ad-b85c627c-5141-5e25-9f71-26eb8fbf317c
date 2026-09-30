# syntax=docker/dockerfile:1
# ---- 阶段 1：构建 React 前端 ----
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json ./
# package-lock.json 存在时 npm ci 会自动使用，否则正常安装
COPY web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 阶段 2：安装后端依赖 ----
FROM node:20-alpine AS server-deps
WORKDIR /app
COPY server/package.json ./
COPY server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- 阶段 3：运行镜像 ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

# 以非 root 用户运行
RUN addgroup -S app && adduser -S app -G app

COPY --from=server-deps /app/node_modules ./node_modules
COPY server/src ./src
# 前端静态产物由 Express 一并托管
COPY --from=web-build /web/dist ./public

ENV WEB_DIST=/app/public

USER app
EXPOSE 4000
CMD ["node", "src/index.js"]
