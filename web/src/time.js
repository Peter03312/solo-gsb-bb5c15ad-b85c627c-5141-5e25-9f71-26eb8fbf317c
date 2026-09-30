// 时间码工具：HH:MM:SS,mmm <-> 毫秒

const TC_RE = /^(\d{1,2}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;

export function formatTimecode(ms) {
  if (!Number.isFinite(ms)) return '';
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000);
  const m = std00(v % 3600000, 60000);
  const s = std00(v % 60000, 1000);
  const milli = v % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

function std00(v, d) {
  return Math.floor(v / d);
}
function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

/** 解析时间码；非法返回 null。支持逗号或点作毫秒分隔符。 */
export function parseTimecode(str) {
  const m = TC_RE.exec((str || '').trim());
  if (!m) return null;
  const [, hh, mm, ss, msRaw] = m;
  const ms = Number(msRaw.padEnd(3, '0'));
  return Number(hh) * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + ms;
}

export function relativeLabel(ms) {
  const sign = ms < 0 ? '-' : '+';
  const v = Math.abs(ms);
  const s = Math.round(v / 100) / 10;
  return `${sign}${s}s`;
}
