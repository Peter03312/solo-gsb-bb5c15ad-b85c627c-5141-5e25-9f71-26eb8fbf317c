import React, { useState } from 'react';
import { api } from '../api.js';

export default function UploadForm({ onCreated }) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!title.trim()) {
      setError('请填写项目标题');
      return;
    }
    if (!file) {
      setError('请选择 .srt 文件');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const r = await api.createProject(title.trim(), text);
      setTitle('');
      setFile(null);
      onCreated(r.id);
    } catch (err) {
      if (err.status === 422 && err.data?.line != null) {
        setError(`${err.message}；未导入任何片段，请修正后重新上传整个文件。`);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="upload card" onSubmit={submit}>
      <h2>新建字幕项目</h2>
      <div className="form-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="项目标题，如：EP01 字幕校对"
        />
      </div>
      <div className="form-row">
        <input
          type="file"
          accept=".srt,text/plain,application/x-subrip"
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
      </div>
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary" disabled={busy}>
        {busy ? '导入中…' : '上传并导入 SRT'}
      </button>
      <p className="muted small">
        导入会先完整校验：时间非负、起点早于终点、片段互不重叠。任何一条不满足都会指出行号，且不会导入半成品。
      </p>
    </form>
  );
}
