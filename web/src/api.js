// API 封装。身份通过 x-user-id 头传递（演示环境）。

const TOKEN_KEY = 'subtitle.user.id';

export function getUserId() {
  return Number(localStorage.getItem(TOKEN_KEY)) || null;
}
export function setUserId(id) {
  localStorage.setItem(TOKEN_KEY, String(id));
}

async function request(path, options = {}) {
  const userId = getUserId();
  const headers = { ...(options.headers || {}) };
  if (userId) headers['x-user-id'] = String(userId);

  const res = await fetch(path, { ...options, headers });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error((body && body.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = isJson ? body : { raw: body };
    throw err;
  }
  return body;
}

export const api = {
  listUsers: () => request('/api/users'),
  listProjects: () => request('/api/projects'),
  getProject: (id) => request(`/api/projects/${id}`),
  createProject: (title, srtText) =>
    request(`/api/projects?title=${encodeURIComponent(title)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: srtText,
    }),
  listRevisions: (projectId, position) =>
    request(`/api/projects/${projectId}/segments/${position}/revisions`),
  submitRevision: (projectId, position, payload) =>
    request(`/api/projects/${projectId}/segments/${position}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  confirm: (projectId, position) =>
    request(`/api/projects/${projectId}/segments/${position}/confirm`, { method: 'POST' }),
  unconfirm: (projectId, position) =>
    request(`/api/projects/${projectId}/segments/${position}/unconfirm`, { method: 'POST' }),
  publish: (projectId) =>
    request(`/api/projects/${projectId}/publish`, { method: 'POST' }),
  getRelease: (id) => request(`/api/releases/${id}`),
};

// 下载需要 x-user-id 头，因此取 blob 后再触发浏览器保存
export async function downloadRelease(release, currentUser) {
  const res = await fetch(`/api/releases/${release.id}/download`, {
    headers: currentUser ? { 'x-user-id': String(currentUser.id) } : {},
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || '下载失败');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `release-v${release.version}.srt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
