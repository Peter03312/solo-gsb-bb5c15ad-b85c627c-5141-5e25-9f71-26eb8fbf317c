import React, { useEffect, useState } from 'react';
import { api, getUserId, setUserId } from './api.js';
import UploadForm from './components/UploadForm.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';

const ROLE_LABEL = { editor: '编辑', reviewer: '审核者', admin: '管理员' };

export default function App() {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [openProject, setOpenProject] = useState(null);

  useEffect(() => {
    api.listUsers().then((r) => {
      setUsers(r.users);
      const savedId = getUserId();
      const saved = r.users.find((u) => u.id === savedId) || r.users[0];
      if (saved) {
        setUserId(saved.id);
        setUser(saved);
      }
    });
  }, []);

  useEffect(() => {
    if (user && !openProject) {
      api.listProjects().then((r) => setProjects(r.projects));
    }
  }, [user, openProject]);

  function chooseUser(u) {
    setUser(u);
    setUserId(u.id);
  }

  if (!user) return <div className="muted center">加载中…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <h1 onClick={() => setOpenProject(null)} className="brand">
          字幕协作校对平台
        </h1>
        <div className="user-box">
          <label htmlFor="user-select">当前身份：</label>
          <select
            id="user-select"
            value={user.id}
            onChange={(e) => chooseUser(users.find((u) => u.id === Number(e.target.value)))}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{ROLE_LABEL[u.role]}）
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="container">
        {openProject ? (
          <ProjectDetail
            projectId={openProject}
            user={user}
            onBack={() => setOpenProject(null)}
          />
        ) : (
          <div className="home">
            <UploadForm onCreated={(id) => setOpenProject(id)} />
            <section className="card">
              <h2>项目列表</h2>
              {projects.length === 0 && <div className="muted">还没有项目，先上传一个 SRT 吧。</div>}
              <ul className="project-list">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button className="project-link" onClick={() => setOpenProject(p.id)}>
                      <span className="project-title">{p.title}</span>
                      <span className="muted small">
                        {p.segmentCount} 段 · 已确认 {p.confirmedCount}
                        {p.latestVersion != null && ` · 最新 v${p.latestVersion}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>

      <footer className="footer muted small">
        React + Node.js(Express) + PostgreSQL · 每次修订留痕 · 已确认片段改动需重新审核 ·
        发布为不可变快照
      </footer>
    </div>
  );
}
