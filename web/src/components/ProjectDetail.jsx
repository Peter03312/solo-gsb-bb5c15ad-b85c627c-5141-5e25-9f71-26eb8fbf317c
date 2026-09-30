import React, { useCallback, useEffect, useState } from 'react';
import { api, downloadRelease } from '../api.js';
import SegmentRow from './SegmentRow.jsx';
import RevisionHistory from './RevisionHistory.jsx';
import ReleaseView from './ReleaseView.jsx';

export default function ProjectDetail({ projectId, user, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [historyPos, setHistoryPos] = useState(null);
  const [viewRelease, setViewRelease] = useState(null);
  const [publishMsg, setPublishMsg] = useState(null);
  const [publishing, setPublishing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = await api.getProject(projectId);
      setData(d);
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handlePublish() {
    setError('');
    setPublishMsg(null);
    setPublishing(true);
    try {
      const r = await api.publish(projectId);
      setPublishMsg({
        ok: true,
        text: `已发布不可变版本 v${r.release.version}（${r.release.segmentCount} 段），可在下方下载 SRT。`,
      });
      await reload();
    } catch (e) {
      if (e.status === 422 && e.data?.code === 'PUBLISH_VALIDATION_FAILED') {
        setPublishMsg({ ok: false, data: e.data });
      } else {
        setError(e.message);
      }
    } finally {
      setPublishing(false);
    }
  }

  if (error && !data) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">加载中…</div>;

  const { project, segments, releases } = data;
  const isReviewer = ['reviewer', 'admin'].includes(user?.role);
  const pending = segments.filter((s) => s.status === 'pending');

  return (
    <div>
      <div className="detail-head">
        <button className="btn-ghost" onClick={onBack}>
          ← 返回项目列表
        </button>
        <h2>{project.title}</h2>
        <span className="muted">
          共 {project.segmentCount} 段，已确认 {project.confirmedCount} 段
        </span>
      </div>

      <div className="card publish-card">
        <div className="publish-bar">
          <div>
            <strong>发布不可变版本</strong>
            <p className="muted small">
              发布在单个数据库事务中完成：原子校验整条时间轴，全部片段须已确认且互不重叠；
              发布期间对片段的编辑会被锁阻塞，不会混入本版本。
            </p>
          </div>
          <button
            className="btn primary"
            disabled={!isReviewer || publishing}
            onClick={handlePublish}
            title={!isReviewer ? '需要审核者权限' : ''}
          >
            {publishing ? '发布中…' : '发布新版本'}
          </button>
        </div>
        {!isReviewer && (
          <div className="muted small">当前身份无审核权限，仅可编辑片段。</div>
        )}

        {publishMsg?.ok && <div className="alert ok">{publishMsg.text}</div>}
        {publishMsg && !publishMsg.ok && (
          <div className="alert error">
            <strong>{publishMsg.data.error}</strong>
            <ul>
              {publishMsg.data.problems.map((p, i) => (
                <li key={i}>
                  {p.message}
                  {p.type === 'overlap' && `（位置：第 ${p.positions[0]} 段 / 第 ${p.positions[1]} 段）`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {releases.length > 0 && (
          <div className="releases">
            <h4>已发布版本（不可变快照）</h4>
            <ul className="release-list">
              {releases.map((r) => (
                <li key={r.id}>
                  <span className="release-ver">v{r.version}</span>
                  <span className="muted">
                    {r.segmentCount} 段 · {r.publisher} ·{' '}
                    {new Date(r.publishedAt).toLocaleString()}
                  </span>
                  <span className="release-actions">
                    <button className="btn-link" onClick={() => setViewRelease(r)}>
                      查看
                    </button>
                    <button
                      className="btn-link ok"
                      onClick={() => downloadRelease(r, user).catch((e) => window.alert(e.message))}
                    >
                      下载 SRT
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="muted small pending-hint">
          待审核片段：
          {pending.map((s) => s.position).join(', ')}
        </div>
      )}

      <ol className="segments">
        {segments.map((s) => (
          <SegmentRow
            key={s.id}
            projectId={projectId}
            segment={s}
            user={user}
            onChanged={reload}
            onShowHistory={(pos) => setHistoryPos(pos)}
          />
        ))}
      </ol>

      {historyPos != null && (
        <RevisionHistory
          projectId={projectId}
          position={historyPos}
          onClose={() => setHistoryPos(null)}
        />
      )}
      {viewRelease && (
        <ReleaseView
          release={viewRelease}
          user={user}
          onClose={() => setViewRelease(null)}
        />
      )}
    </div>
  );
}
