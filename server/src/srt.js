'use strict';

/**
 * SRT 解析与校验。
 *
 * 设计原则：
 *  - 任何错误都必须指出行号，绝不导入半成品（调用方据此整体回滚）。
 *  - 解析阶段做语法校验；语义校验（起点 < 终点、片段间不重叠）在解析结果上完成，
 *    错误同样带行号。
 */

class SrtError extends Error {
  constructor(message, line) {
    super(line != null ? `第 ${line} 行：${message}` : message);
    this.name = 'SrtError';
    this.line = line;
  }
}

const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2}),(\d{3})(?:\s+(.*))?$/;

/** "HH:MM:SS,mmm" -> 毫秒。返回 null 表示无法解析。 */
function parseTimecode(str) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2}),(\d{3})$/.exec((str || '').trim());
  if (!m) return null;
  const [, hh, mm, ss, ms] = m;
  if (Number(mm) > 59 || Number(ss) > 59) return null;
  return (
    Number(hh) * 3600000 +
    Number(mm) * 60000 +
    Number(ss) * 1000 +
    Number(ms)
  );
}

/** 毫秒 -> "HH:MM:SS,mmm" */
function formatTimecode(ms) {
  const v = Math.max(0, Math.round(Number(ms)));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const milli = v % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/**
 * 解析 SRT 文本。
 * @returns {{ entries: Array<{indexLine:number,index:number,startMs:number,endMs:number,
 *           timingLine:number,textLines:number[],text:string}> }}
 * @throws {SrtError}
 */
function parseSrt(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new SrtError('文件为空');
  }

  // 去掉 BOM（U+FEFF）；统一 CRLF -> LF
  const text = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const rawLines = text.split('\n');

  // 去掉文件末尾的空行，保留行号（下标 +1）
  let end = rawLines.length;
  while (end > 0 && rawLines[end - 1].trim() === '') end -= 1;
  const lines = rawLines.slice(0, end);

  const entries = [];
  let i = 0;
  while (i < lines.length) {
    // 跳过块之间的空行
    while (i < lines.length && lines[i].trim() === '') i += 1;
    if (i >= lines.length) break;

    const indexLine = i + 1;
    const indexToken = lines[i].trim();
    if (!/^\d+$/.test(indexToken)) {
      throw new SrtError('应为数字序号', indexLine);
    }
    const index = Number(indexToken);
    if (index < 1) {
      throw new SrtError('序号必须为正整数', indexLine);
    }
    i += 1;

    if (i >= lines.length) {
      throw new SrtError(`序号 ${index} 后缺少时间轴行`, indexLine);
    }
    const timingLine = i + 1;
    const tm = TIME_RE.exec(lines[i].trim());
    if (!tm) {
      throw new SrtError(
        '时间轴格式错误，应为 "HH:MM:SS,mmm --> HH:MM:SS,mmm"',
        timingLine,
      );
    }
    const startMs = parseTimecode(`${tm[1]}:${tm[2]}:${tm[3]},${tm[4]}`);
    const endMs = parseTimecode(`${tm[5]}:${tm[6]}:${tm[7]},${tm[8]}`);
    if (startMs == null) throw new SrtError('起始时间无效', timingLine);
    if (endMs == null) throw new SrtError('结束时间无效', timingLine);
    if (!(startMs < endMs)) {
      throw new SrtError('起始时间必须早于结束时间', timingLine);
    }
    i += 1;

    // 正文行，直到遇到空行或文件结束
    const content = [];
    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      content.push(lines[i]);
      textLines.push(i + 1);
      i += 1;
    }
    if (content.length === 0) {
      throw new SrtError('该片段缺少字幕文本', timingLine);
    }

    entries.push({
      indexLine,
      index,
      timingLine,
      startMs,
      endMs,
      textLines,
      text: content.join('\n'),
    });
  }

  if (entries.length === 0) {
    throw new SrtError('文件中没有可导入的字幕片段');
  }

  // 序号必须从 1 开始、连续且递增（这是 SRT 的标准形式）
  entries.forEach((e, pos) => {
    const expected = pos + 1;
    if (e.index !== expected) {
      throw new SrtError(
        `序号应为 ${expected}，实际为 ${e.index}（序号需从 1 开始连续编号）`,
        e.indexLine,
      );
    }
  });

  // 片段间不得重叠（端点相接允许：前一段终点 == 后一段起点）
  for (let k = 1; k < entries.length; k += 1) {
    const prev = entries[k - 1];
    const cur = entries[k];
    if (cur.startMs < prev.endMs) {
      throw new SrtError(
        `与第 ${prev.index} 段（第 ${prev.indexLine} 行）时间重叠`,
        cur.timingLine,
      );
    }
  }

  return { entries };
}

/**
 * 序列化。segments: [{ position, startMs, endMs, text }]（应已按 position 排序）
 */
function serializeSrt(segments) {
  return (
    segments
      .map((s, idx) => {
        const position = s.position != null ? s.position : idx + 1;
        return [
          String(position),
          `${formatTimecode(s.startMs)} --> ${formatTimecode(s.endMs)}`,
          s.text,
        ].join('\n');
      })
      .join('\n\n') + '\n'
  );
}

module.exports = { SrtError, parseSrt, serializeSrt, parseTimecode, formatTimecode };
