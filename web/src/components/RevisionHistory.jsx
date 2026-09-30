import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatTimecode } from '../time.js';

// 片段修订记录（只增不改的审计链）
export default function RevisionHistory({ projectId, position, onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .listRevisions(projectId, position)
      .then((r) => alive && setItems(r.revisions))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId, position]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>第 {position} 段 · 修订记录</h3>
          <button className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {error && <div className="alert error">{error}</div>}
        {!items && !error && <div className="muted">加载中…</div>}
        {items && (
          <ol className="rev-list">
            {items.map((r) => (
              <li key={r.id} className="rev-item">
                <div className="rev-meta">
                  <span className="rev-no">#{r.revisionNo}</span>
                  <span>{r.author}</span>
                  <span className="muted">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                  {r.basedOnRevisionNo != null && (
                    <span className="muted">
                      （基于 #{r.basedOnRevisionNo}）
                    </span>
                  )}
                </div>
                <div className="rev-time">
                  {formatTimecode(r.startMs)} → {formatTimecode(r.endMs)}
                </div>
                <pre className="rev-text">{r.text}</pre>
                {r.note && <div className="rev-note">备注：{r.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
