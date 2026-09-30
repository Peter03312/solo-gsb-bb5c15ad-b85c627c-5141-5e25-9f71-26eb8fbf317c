'use strict';

/**
 * 时间轴校验。
 * 规则：时间非负、起点严格早于终点、片段两两不重叠（端点相接允许）。
 * 任何情况下都只报告冲突，绝不去“顺手”挪动相邻片段。
 */

function isIntMs(v) {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

/**
 * 校验一次片段编辑。
 * @param {Array} neighbors 项目内其余片段（当前值）
 * @param {{startMs:number,endMs:number}} candidate 待提交值
 * @returns {{ fieldErrors: string[], conflicts: Array }}
 *   conflicts: [{ position, startMs, endMs, text, reason }]
 */
function validateCandidate(neighbors, candidate) {
  const fieldErrors = [];
  if (!isIntMs(candidate.startMs) || candidate.startMs < 0) {
    fieldErrors.push('起始时间必须为不小于 0 的整数毫秒值');
  }
  if (!isIntMs(candidate.endMs) || candidate.endMs < 0) {
    fieldErrors.push('结束时间必须为不小于 0 的整数毫秒值');
  }
  if (
    fieldErrors.length === 0 &&
    !(candidate.startMs < candidate.endMs)
  ) {
    fieldErrors.push('起始时间必须早于结束时间');
  }

  const conflicts = [];
  if (fieldErrors.length === 0) {
    for (const s of neighbors) {
      // 区间相交：a.start < b.end && b.start < a.end
      if (candidate.startMs < s.end_ms && s.start_ms < candidate.endMs) {
        const overlapStart = Math.max(candidate.startMs, s.start_ms);
        const overlapEnd = Math.min(candidate.endMs, s.end_ms);
        conflicts.push({
          position: s.position,
          segmentId: s.id,
          startMs: s.start_ms,
          endMs: s.end_ms,
          text: s.text,
          reason: `与第 ${s.position} 段时间重叠（重叠区间 ${overlapStart}–${overlapEnd} ms）`,
        });
      }
    }
    conflicts.sort((a, b) => a.position - b.position);
  }

  return { fieldErrors, conflicts };
}

/**
 * 发布前对整条时间轴做原子校验。
 * @param {Array} segments 已按 position 排序的全部片段
 * @returns {Array<{position?:number,positions?:number[],type:string,message:string}>}
 */
function validateFullTimeline(segments) {
  const problems = [];

  segments.forEach((s) => {
    if (!(isIntMs(s.start_ms) && s.start_ms >= 0)) {
      problems.push({
        type: 'invalid_time',
        position: s.position,
        message: `第 ${s.position} 段起始时间非法`,
      });
    }
    if (!(isIntMs(s.end_ms) && s.end_ms >= 0)) {
      problems.push({
        type: 'invalid_time',
        position: s.position,
        message: `第 ${s.position} 段结束时间非法`,
      });
    }
    if (
      isIntMs(s.start_ms) &&
      isIntMs(s.end_ms) &&
      !(s.start_ms < s.end_ms)
    ) {
      problems.push({
        type: 'inverted_range',
        position: s.position,
        message: `第 ${s.position} 段起始时间不早于结束时间`,
      });
    }
    if (s.status !== 'confirmed') {
      problems.push({
        type: 'unconfirmed',
        position: s.position,
        message: `第 ${s.position} 段尚未经审核者确认`,
      });
    }
  });

  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1];
    const cur = segments[i];
    if (
      isIntMs(prev.start_ms) &&
      isIntMs(prev.end_ms) &&
      isIntMs(cur.start_ms) &&
      isIntMs(cur.end_ms) &&
      prev.start_ms < prev.end_ms &&
      cur.start_ms < cur.end_ms &&
      cur.start_ms < prev.end_ms
    ) {
      problems.push({
        type: 'overlap',
        positions: [prev.position, cur.position],
        message: `第 ${prev.position} 段与第 ${cur.position} 段时间重叠`,
      });
    }
  }

  return problems;
}

module.exports = { isIntMs, validateCandidate, validateFullTimeline };
