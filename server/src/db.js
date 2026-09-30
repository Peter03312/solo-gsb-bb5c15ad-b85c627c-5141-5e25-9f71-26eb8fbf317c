'use strict';

const pg = require('pg');

// pg 默认把 BIGINT 转成字符串。本系统所有毫秒值、ID 都在安全整数范围内，
// 统一解析为 number，避免前后端/校验环节的类型坑（必须在建池前设置）。
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

async function waitForDatabase(retries = 30, delayMs = 1000) {
  // 容器环境下数据库容器可能尚未就绪，启动时进行有限重试。
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await pool.query('SELECT 1 AS ok');
      if (res.rows[0].ok === 1) {
        console.log('[db] 连接成功');
        return;
      }
    } catch (err) {
      console.log(`[db] 等待数据库就绪（${attempt}/${retries}）: ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('数据库在重试后仍不可用');
}

/** 在事务中执行；projectLockId 提供时先获取项目级咨询锁，串行化对同一项目的写操作 */
async function withTransaction(fn, { projectLockId } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (projectLockId != null) {
      // pg_advisory_xact_lock 在事务结束（提交/回滚）时自动释放
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
        493715,
        projectLockId,
      ]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* 忽略回滚错误 */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, waitForDatabase, withTransaction };
