'use strict';

const express = require('express');
const { pool, withTransaction } = require('./db');
const { SrtError, parseSrt, serializeSrt } = require('./srt');
const { validateCandidate, validateFullTimeline } = require('./timeline');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- 认证：演示环境用 x-user-id 头选择身份 ----------
async function requireUser(req, res, next) {
  const id = Number(req.header('x-user-id'));
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(401).json({ error: '缺少或无效的用户身份（x-user-id 头）' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(401).json({ error: '用户不存在' });
  req.user = rows[0];
  next();
}

function requireReviewer(req, res, next) {
  if (!['reviewer', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: '该操作需要审核者（reviewer/admin）权限' });
  }
  next();
}

router.use(requireUser);

// ---------- 数据映射 ----------
function mapSegment(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    position: row.position,
    text: row.text,
    startMs: row.start_ms,
    endMs: row.end_ms,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    currentRevisionNo: row.current_revision_no ?? null,
    currentAuthor: row.current_author_name ?? null,
    revisedAt: row.revised_at ?? null,
  };
}

function mapRevision(row) {
  return {
    id: row.id,
    segmentId: row.segment_id,
    position: row.position ?? null,
    revisionNo: row.revision_no,
    text: row.text,
    startMs: row.start_ms,
    endMs: row.end_ms,
    author: row.author_name ?? null,
    basedOnRevisionId: row.based_on_revision_id ?? null,
    basedOnRevisionNo: row.based_on_revision_no ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
}

// ---------- 用户 ----------
router.get('/users', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, role FROM users ORDER BY id',
  );
  res.json({ users: rows });
}));

// ---------- 项目 ----------
router.get('/projects', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*,
           (SELECT count(*) FROM segments s WHERE s.project_id = p.id) AS segment_count,
           (SELECT count(*) FROM segments s WHERE s.project_id = p.id AND s.status = 'confirmed') AS confirmed_count,
           (SELECT max(r.version) FROM releases r WHERE r.project_id = p.id) AS latest_version
    FROM projects p
    ORDER BY p.id DESC
  `);
  res.json({
    projects: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      segmentCount: Number(r.segment_count),
      confirmedCount: Number(r.confirmed_count),
      latestVersion: r.latest_version,
    })),
  });
}));

// 上传 SRT 创建项目：原始文本作为请求体（Content-Type: text/plain），
// 标题通过 ?title= 传入。解析失败不写入任何数据。
router.post('/projects', wrap(async (req, res) => {
  const title = (req.query.title || '').toString().trim();
  if (!title) return res.status(400).json({ error: '缺少项目标题（?title=）' });

  let parsed;
  try {
    parsed = parseSrt(req.body.toString('utf8'));
  } catch (err) {
    if (err instanceof SrtError) {
      return res.status(422).json({ error: err.message, line: err.line ?? null });
    }
    throw err;
  }

  const result = await withTransaction(async (client) => {
    const proj = await client.query(
      'INSERT INTO projects (title, created_by) VALUES ($1, $2) RETURNING *',
      [title, req.user.id],
    );
    const projectId = proj.rows[0].id;

    for (const [idx, e] of parsed.entries.entries()) {
      const position = idx + 1;
      const seg = await client.query(
        `INSERT INTO segments (project_id, position, text, start_ms, end_ms, status)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
        [projectId, position, e.text, e.startMs, e.endMs],
      );
      const rev = await client.query(
        `INSERT INTO revisions (segment_id, project_id, revision_no, text, start_ms, end_ms,
                                 author_id, based_on_revision_id, note)
         VALUES ($1, $2, 1, $3, $4, $5, $6, NULL, $7) RETURNING *`,
        [seg.rows[0].id, projectId, e.text, e.startMs, e.endMs, req.user.id,
         `导入 SRT（原文件第 ${e.timingLine} 行）`],
      );
      await client.query('UPDATE segments SET current_revision_id = $1 WHERE id = $2',
        [rev.rows[0].id, seg.rows[0].id]);
    }
    return projectId;
  });

  res.status(201).json({ id: result });
}));

const SEGMENT_SELECT = `
  SELECT s.*, r.revision_no AS current_revision_no,
         u.name AS current_author_name, r.created_at AS revised_at
  FROM segments s
  LEFT JOIN revisions r ON r.id = s.current_revision_id
  LEFT JOIN users u ON u.id = r.author_id
`;

router.get('/projects/:id', wrap(async (req, res) => {
  const projectId = Number(req.params.id);
  const p = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (p.rows.length === 0) return res.status(404).json({ error: '项目不存在' });

  const segs = await pool.query(
    `${SEGMENT_SELECT} WHERE s.project_id = $1 ORDER BY s.position`,
    [projectId],
  );
  const rels = await pool.query(
    `SELECT r.*, u.name AS publisher_name FROM releases r
     JOIN users u ON u.id = r.published_by
     WHERE r.project_id = $1 ORDER BY r.version DESC`,
    [projectId],
  );

  res.json({
    project: {
      id: p.rows[0].id,
      title: p.rows[0].title,
      createdAt: p.rows[0].created_at,
      segmentCount: segs.rows.length,
      confirmedCount: segs.rows.filter((s) => s.status === 'confirmed').length,
    },
    segments: segs.rows.map(mapSegment),
    releases: rels.rows.map((r) => ({
      id: r.id,
      version: r.version,
      segmentCount: r.segment_count,
      publisher: r.publisher_name,
      publishedAt: r.published_at,
    })),
  });
}));

// ---------- 片段修订 ----------
router.get('/projects/:id/segments/:position/revisions', wrap(async (req, res) => {
  const projectId = Number(req.params.id);
  const position = Number(req.params.position);
  const { rows } = await pool.query(`
    SELECT rv.*, s.position, u.name AS author_name,
           br.revision_no AS based_on_revision_no
    FROM revisions rv
    JOIN segments s ON s.id = rv.segment_id
    JOIN users u ON u.id = rv.author_id
    LEFT JOIN revisions br ON br.id = rv.based_on_revision_id
    WHERE rv.project_id = $1 AND s.position = $2
    ORDER BY rv.revision_no DESC
  `, [projectId, position]);
  res.json({ revisions: rows.map(mapRevision) });
}));

/**
 * 提交一次片段修订。
 * body: { text, startMs, endMs, basedOnRevisionId, note }
 *
 * 并发规则（项目级咨询锁串行化）：
 *  - 与相邻片段重叠：422 + 冲突详情，不落库，不改动相邻片段；
 *  - 基于旧修订：409 + 当前内容 + 当前邻居冲突信息，由用户决定后重新提交；
 *  - 不同片段：互不影响，可继续提交（锁只做瞬时串行化）；
 *  - 已确认片段被编辑：状态回到 pending，需重新审核。
 */
router.post('/projects/:id/segments/:position/revisions', wrap(async (req, res) => {
  const projectId = Number(req.params.id);
  const position = Number(req.params.position);
  const { startMs, endMs, note } = req.body || {};
  const text = req.body?.text;
  const basedOnRevisionId = req.body?.basedOnRevisionId ?? null;

  if (typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: '字幕文本不能为空' });
  }
  if (text.length > 10000) return res.status(400).json({ error: '文本过长' });

  const outcome = await withTransaction(async (client) => {
    const segRes = await client.query(
      `SELECT * FROM segments WHERE project_id = $1 AND position = $2 FOR UPDATE`,
      [projectId, position],
    );
    if (segRes.rows.length === 0) return { code: 404, body: { error: '片段不存在' } };
    const seg = segRes.rows[0];

    // 邻居只查一次（FOR UPDATE 已锁住本段；项目咨询锁保证邻居集合稳定）
    const neighbors = (
      await client.query(
        `SELECT id, position, text, start_ms, end_ms, status
         FROM segments WHERE project_id = $1 AND id <> $2`,
        [projectId, seg.id],
      )
    ).rows;

    // 1) 自身字段校验（非负、起点早于终点、整数毫秒）
    const { fieldErrors, conflicts } = validateCandidate(neighbors, { startMs, endMs });
    if (fieldErrors.length > 0) {
      return { code: 400, body: { error: fieldErrors.join('；'), fieldErrors } };
    }

    const isStale =
      basedOnRevisionId != null &&
      Number(basedOnRevisionId) !== Number(seg.current_revision_id);

    // 2) 乐观并发优先：基于旧修订提交时，返回当前内容，并附带该候选时间
    //    在“当前邻居”下的冲突信息，供提交方一次性核对后重新提交。
    if (isStale) {
      const curRev = await client.query(
        `SELECT rv.*, u.name AS author_name, s.position,
                br.revision_no AS based_on_revision_no
         FROM revisions rv
         JOIN users u ON u.id = rv.author_id
         JOIN segments s ON s.id = rv.segment_id
         LEFT JOIN revisions br ON br.id = rv.based_on_revision_id
         WHERE rv.id = $1`,
        [seg.current_revision_id],
      );
      return {
        code: 409,
        body: {
          error: '该片段已被他人修改，请基于当前内容核对后重新提交',
          code: 'STALE_REVISION',
          currentSegment: mapSegment({
            ...seg,
            current_revision_no: curRev.rows[0]?.revision_no,
            current_author_name: curRev.rows[0]?.author_name,
            revised_at: curRev.rows[0]?.created_at,
          }),
          currentRevision: curRev.rows[0] ? mapRevision(curRev.rows[0]) : null,
          candidateConflicts: conflicts,
        },
      };
    }

    // 3) 与相邻片段重叠：指出冲突，绝不暗改相邻内容
    if (conflicts.length > 0) {
      return {
        code: 422,
        body: {
          error: `时间调整与 ${conflicts.length} 个相邻片段冲突，未保存任何修改`,
          code: 'OVERLAP_CONFLICT',
          conflicts,
        },
      };
    }

    // 4) 校验通过：写入新修订（只增不改），段状态回到待审核
    const noRes = await client.query(
      'SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_no FROM revisions WHERE segment_id = $1',
      [seg.id],
    );
    const rev = await client.query(
      `INSERT INTO revisions
         (segment_id, project_id, revision_no, text, start_ms, end_ms,
          author_id, based_on_revision_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [seg.id, projectId, noRes.rows[0].next_no, text, startMs, endMs,
       req.user.id, seg.current_revision_id, note ?? null],
    );
    const wasConfirmed = seg.status === 'confirmed';
    await client.query(
      `UPDATE segments
       SET text = $1, start_ms = $2, end_ms = $3,
           status = 'pending', current_revision_id = $4
       WHERE id = $5`,
      [text, startMs, endMs, rev.rows[0].id, seg.id],
    );
    const fresh = await client.query(
      `${SEGMENT_SELECT} WHERE s.id = $1`,
      [seg.id],
    );
    return {
      code: 201,
      body: {
        revision: mapRevision({ ...rev.rows[0], author_name: req.user.name }),
        segment: mapSegment(fresh.rows[0]),
        resetFromConfirmed: wasConfirmed,
      },
    };
  }, { projectLockId: projectId });

  res.status(outcome.code).json(outcome.body);
}));

// ---------- 审核确认 ----------
router.post('/projects/:id/segments/:position/confirm', requireReviewer, wrap(async (req, res) => {
  const projectId = Number(req.params.id);
  const position = Number(req.params.position);
  const rows = await withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE segments SET status = 'confirmed'
       WHERE project_id = $1 AND position = $2
       RETURNING *`,
      [projectId, position],
    );
    return r.rows;
  }, { projectLockId: projectId });
  if (rows.length === 0) return res.status(404).json({ error: '片段不存在' });
  const full = await pool.query(`${SEGMENT_SELECT} WHERE s.id = $1`, [rows[0].id]);
  res.json({ segment: mapSegment(full.rows[0]) });
}));

router.post('/projects/:id/segments/:position/unconfirm', requireReviewer, wrap(async (req, res) => {
  const projectId = Number(req.params.id);
  const position = Number(req.params.position);
  const rows = await withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE segments SET status = 'pending'
       WHERE project_id = $1 AND position = $2
       RETURNING *`,
      [projectId, position],
    );
    return r.rows;
  }, { projectLockId: projectId });
  if (rows.length === 0) return res.status(404).json({ error: '片段不存在' });
  const full = await pool.query(`${SEGMENT_SELECT} WHERE s.id = $1`, [rows[0].id]);
  res.json({ segment: mapSegment(full.rows[0]) });
}));

// ---------- 发布 ----------
router.post('/projects/:id/publish', requireReviewer, wrap(async (req, res) => {
  const projectId = Number(req.params.id);

  const outcome = await withTransaction(async (client) => {
    const proj = await client.query(
      'SELECT * FROM projects WHERE id = $1 FOR UPDATE',
      [projectId],
    );
    if (proj.rows.length === 0) return { code: 404, body: { error: '项目不存在' } };

    const { rows } = await client.query(
      'SELECT * FROM segments WHERE project_id = $1 ORDER BY position',
      [projectId],
    );
    if (rows.length === 0) {
      return { code: 422, body: { error: '项目没有任何片段', problems: [] } };
    }

    // 原子校验整条时间轴：未确认 / 起止非法 / 互相重叠 全部收集后一次性指出
    const problems = validateFullTimeline(rows);
    if (problems.length > 0) {
      const unconfirmed = problems.filter((p) => p.type === 'unconfirmed').map((p) => p.position);
      const overlaps = problems.filter((p) => p.type === 'overlap').map((p) => p.positions);
      return {
        code: 422,
        body: {
          error: '发布被拒绝：时间轴校验未通过',
          code: 'PUBLISH_VALIDATION_FAILED',
          problems,
          unconfirmedPositions: unconfirmed,
          overlapPositions: overlaps,
        },
      };
    }

    const ver = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM releases WHERE project_id = $1',
      [projectId],
    );
    const release = await client.query(
      `INSERT INTO releases (project_id, version, published_by, segment_count)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [projectId, ver.rows[0].next_version, req.user.id, rows.length],
    );
    // 快照复制：此后任何编辑都与该版本无关
    for (const s of rows) {
      await client.query(
        `INSERT INTO release_segments (release_id, position, text, start_ms, end_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [release.rows[0].id, s.position, s.text, s.start_ms, s.end_ms],
      );
    }
    return {
      code: 201,
      body: {
        release: {
          id: release.rows[0].id,
          version: release.rows[0].version,
          segmentCount: release.rows[0].segment_count,
          publishedAt: release.rows[0].published_at,
        },
      },
    };
  }, { projectLockId: projectId });

  res.status(outcome.code).json(outcome.body);
}));

router.get('/releases/:id', wrap(async (req, res) => {
  const releaseId = Number(req.params.id);
  const r = await pool.query(
    `SELECT r.*, p.title AS project_title, u.name AS publisher_name
     FROM releases r
     JOIN projects p ON p.id = r.project_id
     JOIN users u ON u.id = r.published_by
     WHERE r.id = $1`,
    [releaseId],
  );
  if (r.rows.length === 0) return res.status(404).json({ error: '版本不存在' });
  const segs = await pool.query(
    'SELECT * FROM release_segments WHERE release_id = $1 ORDER BY position',
    [releaseId],
  );
  res.json({
    release: {
      id: r.rows[0].id,
      projectId: r.rows[0].project_id,
      projectTitle: r.rows[0].project_title,
      version: r.rows[0].version,
      segmentCount: r.rows[0].segment_count,
      publisher: r.rows[0].publisher_name,
      publishedAt: r.rows[0].published_at,
    },
    segments: segs.rows.map((s) => ({
      position: s.position,
      text: s.text,
      startMs: s.start_ms,
      endMs: s.end_ms,
    })),
  });
}));

// 下载不可变版本对应的 SRT
router.get('/releases/:id/download', wrap(async (req, res) => {
  const releaseId = Number(req.params.id);
  const r = await pool.query(
    `SELECT r.*, p.title AS project_title
     FROM releases r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
    [releaseId],
  );
  if (r.rows.length === 0) return res.status(404).json({ error: '版本不存在' });
  const segs = await pool.query(
    'SELECT * FROM release_segments WHERE release_id = $1 ORDER BY position',
    [releaseId],
  );
  const srt = serializeSrt(
    segs.rows.map((s) => ({
      position: s.position,
      text: s.text,
      startMs: s.start_ms,
      endMs: s.end_ms,
    })),
  );
  const safeTitle = r.rows[0].project_title.replace(/[^\w一-龥-]+/g, '_');
  const filename = `${safeTitle}.v${r.rows[0].version}.srt`;
  res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(srt);
}));

// ---------- 错误处理 ----------
router.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

module.exports = router;
