'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { waitForDatabase } = require('./db');
const apiRouter = require('./app');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const WEB_DIST = process.env.WEB_DIST || path.join(__dirname, '..', '..', 'web', 'dist');

// JSON 请求体（修订、发布等）
app.use(express.json({ limit: '1mb' }));
// 纯文本请求体（SRT 原文上传）
app.use('/api/projects', express.text({ type: ['text/plain', 'application/x-subrip'], limit: '10mb' }));

// 健康检查（无需身份），必须挂在 /api 路由之前
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', apiRouter);

// 托管前端构建产物
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.status(404).send('前端尚未构建（web/dist 不存在）');
  });
}

waitForDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] 监听 http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });
