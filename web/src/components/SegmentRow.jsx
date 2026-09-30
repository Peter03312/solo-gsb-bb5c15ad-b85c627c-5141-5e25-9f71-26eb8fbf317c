import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatTimecode, parseTimecode } from '../time.js';

export default function SegmentRow({ projectId, segment, user, onChanged, onShowHistory }) {
  const [editing, setEditing] = useState(false);
  const isReviewer = ['reviewer', 'admin'].includes(user?.role);

  return (
    <li className={`seg ${segment.status === 'confirmed' ? 'confirmed' : ''}`}>
      <div className="seg-head">
        <span className="seg-pos">#{segment.position}</span>
        <span className={`badge ${segment.status}`}>
          {segment.status === 'confirmed' ? '已确认' : '待审核'}
        </span>
        <span className="seg-meta muted">
          {segment.currentRevisionNo != null && `当前修订 #${segment.currentRevisionNo}`}
          {segment.currentAuthor && ` · ${segment.currentAuthor}`}
        </span>
        <span className="seg-actions">
          <button className="btn-link" onClick={() => onShowHistory(segment.position)}>
            修订记录
          </button>
          {!editing && (
            <button className="btn-link" onClick={() => setEditing(true)}>
              编辑
            </button>
          )}
          {!editing && isReviewer && segment.status === 'pending' && (
            <button
              className="btn-link ok"
              onClick={() =>
                api.confirm(projectId, segment.position).then(onChanged).catch(alertErr)
              }
            >
              确认片段
            </button>
          )}
          {!editing && isReviewer && segment.status === 'confirmed' && (
            <button
              className="btn-link warn"
              onClick={() =>
                api.unconfirm(projectId, segment.position).then(onChanged).catch(alertErr)
              }
            >
              撤销确认
            </button>
          )}
        </span>
      </div>

      {editing ? (
        <SegmentEditor
          projectId={projectId}
          segment={segment}
          onDone={(edited) => {
            setEditing(false);
            return onChanged(edited);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="seg-time">
            {formatTimecode(segment.startMs)} → {formatTimecode(segment.endMs)}
            <span className="seg-dur muted">
              （{((segment.endMs - segment.startMs) / 1000).toFixed(2)}s）
            </span>
          </div>
          <pre className="seg-text">{segment.text}</pre>
        </>
      )}
    </li>
  );
}

function alertErr(e) {
  window.alert(e.message);
}

function SegmentEditor({ projectId, segment, onDone, onCancel }) {
  const [text, setText] = useState(segment.text);
  const [startStr, setStartStr] = useState(formatTimecode(segment.startMs));
  const [endStr, setEndStr] = useState(formatTimecode(segment.endMs));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  // 服务端返回的冲突：422 重叠 / 409 旧修订
  const [overlapConflicts, setOverlapConflicts] = useState(null);
  const [stale, setStale] = useState(null);

  function validateLocal() {
    const startMs = parseTimecode(startStr);
    const endMs = parseTimecode(endStr);
    if (startMs == null) return '起始时间格式无效，应为 HH:MM:SS,mmm';
    if (endMs == null) return '结束时间格式无效，应为 HH:MM:SS,mmm';
    if (startMs < 0) return '起始时间不能为负';
    if (!(startMs < endMs)) return '起始时间必须早于结束时间';
    if (!text.trim()) return '字幕文本不能为空';
    return null;
  }

  async function submit() {
    setLocalError('');
    setOverlapConflicts(null);
    setStale(null);
    const err = validateLocal();
    if (err) {
      setLocalError(err);
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.submitRevision(projectId, segment.position, {
        text,
        startMs: parseTimecode(startStr),
        endMs: parseTimecode(endStr),
        basedOnRevisionId: segment.currentRevisionId,
        note: note.trim() || null,
      });
      if (r.resetFromConfirmed) {
        window.alert('该片段此前已确认，修改后已退回“待审核”，需审核者重新确认。');
      }
      await onDone(r.segment);
    } catch (e) {
      if (e.status === 422 && e.data?.code === 'OVERLAP_CONFLICT') {
        setOverlapConflicts(e.data.conflicts);
      } else if (e.status === 409 && e.data?.code === 'STALE_REVISION') {
        setStale(e.data);
      } else {
        setLocalError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="editor">
      {localError && <div className="alert error">{localError}</div>}

      {overlapConflicts && (
        <div className="alert error">
          <strong>时间冲突，本次修改未保存。</strong>
          <p>新时间区间挤占了以下相邻片段（系统不会自动改动相邻内容）：</p>
          <ul>
            {overlapConflicts.map((c) => (
              <li key={c.position}>
                <div>
                  <strong>第 {c.position} 段</strong>：{c.reason}
                </div>
                <div className="mono">
                  {formatTimecode(c.startMs)} → {formatTimecode(c.endMs)}
                </div>
                <pre className="conflict-text">{c.text}</pre>
              </li>
            ))}
          </ul>
          <p className="muted">请调整时间避免重叠后重新提交。</p>
        </div>
      )}

      {stale && (
        <div className="alert warn">
          <strong>该片段已被他人更新，你的编辑基于旧修订。</strong>
          {stale.currentRevision && (
            <div className="stale-current">
              <div className="mono">
                当前 #{stale.currentRevision.revisionNo}（{stale.currentRevision.author}）：
                {formatTimecode(stale.currentSegment.startMs)} →{' '}
                {formatTimecode(stale.currentSegment.endMs)}
              </div>
              <pre className="conflict-text">{stale.currentSegment.text}</pre>
            </div>
          )}
          {stale.candidateConflicts?.length > 0 && (
            <div>
              <p>若按你的新时间提交，仍会与以下片段冲突：</p>
              <ul>
                {stale.candidateConflicts.map((c) => (
                  <li key={c.position}>
                    第 {c.position} 段：{c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row-gap">
            <button
              className="btn"
              onClick={async () => {
                await onDone(stale.currentSegment);
                onCancel();
              }}
            >
              放弃编辑，加载当前版本
            </button>
            <span className="muted">或在下方继续修改后重新提交。</span>
          </div>
        </div>
      )}

      <div className="time-inputs">
        <label>
          起始
          <input
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            spellCheck={false}
            placeholder="00:00:00,000"
          />
        </label>
        <label>
          结束
          <input
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            spellCheck={false}
            placeholder="00:00:00,000"
          />
        </label>
      </div>
      <textarea
        className="text-edit"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        className="note-edit"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="修订备注（可选，会写入修订记录）"
      />
      <div className="editor-actions">
        <button className="btn primary" disabled={submitting} onClick={submit}>
          {submitting ? '提交中…' : '提交修订'}
        </button>
        <button className="btn-ghost" onClick={onCancel} disabled={submitting}>
          取消
        </button>
      </div>
    </div>
  );
}
