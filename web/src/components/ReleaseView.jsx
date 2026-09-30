import React, { useEffect, useState } from 'react';
import { api, downloadRelease } from '../api.js';
import { formatTimecode } from '../time.js';

// 查看某个已发布的不可变快照内容
export default function ReleaseView({ release, user, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .getRelease(release.id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [release.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {data?.release.projectTitle || '版本'} · v{release.version}（只读快照）
          </h3>
          <button className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {error && <div className="alert error">{error}</div>}
        {!data && !error && <div className="muted">加载中…</div>}
        {data && (
          <>
            <div className="muted small">
              发布者 {data.release.publisher} · {data.release.segmentCount} 段 ·{' '}
              {new Date(data.release.publishedAt).toLocaleString()}
            </div>
            <ol className="rev-list compact">
              {data.segments.map((s) => (
                <li key={s.position} className="rev-item">
                  <div className="rev-meta">
                    <span className="rev-no">#{s.position}</span>
                    <span className="mono">
                      {formatTimecode(s.startMs)} → {formatTimecode(s.endMs)}
                    </span>
                  </div>
                  <pre className="rev-text">{s.text}</pre>
                </li>
              ))}
            </ol>
            <div className="editor-actions">
              <button
                className="btn primary"
                onClick={() =>
                  downloadRelease(release, user).catch((e) => window.alert(e.message))
                }
              >
                下载 SRT
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
