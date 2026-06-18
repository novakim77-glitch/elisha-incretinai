// crew.js — 크루 시스템 순수 로직 (Firestore·side-effect 없음, 단위 테스트 가능)
// Phase 1A: 멤버십·닉네임·활성 판정. 순위/어워드/마일스톤은 후속 단계(1B+).

// 그룹 공개용 표시 이름: 닉네임 > 실명 > 폴백
function resolveNickname(profile) {
  if (!profile) return '익명';
  return profile.nickname || profile.name || '익명';
}

// 크루가 지금 활성인가 (flag + 기간). today: 'YYYY-MM-DD'
function isCrewActive(crew, today) {
  if (!crew || crew.active !== true) return false;
  if (crew.startDate && today && today < crew.startDate) return false;
  if (crew.endDate && today && today > crew.endDate) return false;
  return true;
}

// uid가 크루 멤버인가
function isMember(crew, uid) {
  return !!(crew && Array.isArray(crew.memberUids) && crew.memberUids.includes(uid));
}

// /crew_setup 인자 파싱: "YYYY-MM-DD YYYY-MM-DD [크루명...]"
// 반환: { ok, startDate, endDate, name } | { ok:false, error }
function parseSetupArgs(raw) {
  const args = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const [startDate, endDate, ...nameParts] = args;
  if (!DATE.test(startDate || '') || !DATE.test(endDate || '')) {
    return { ok: false, error: '날짜 형식 오류' };
  }
  if (endDate < startDate) {
    return { ok: false, error: '종료일이 시작일보다 빠름' };
  }
  return { ok: true, startDate, endDate, name: nameParts.join(' ') || '미라클 크루' };
}

// 닉네임 유효성: 1~20자, 제어문자·꺾쇠 금지(HTML 안전)
function validateNickname(s) {
  const n = String(s || '').trim();
  if (n.length < 1 || n.length > 20) return { ok: false, error: '1~20자로 입력해 주세요' };
  if (/[<>&\n\r\t]/.test(n)) return { ok: false, error: '사용할 수 없는 문자가 있어요' };
  return { ok: true, nickname: n };
}

// CCS 순위 계산 (순수) — ranking.js와 동일 공식.
//   participants: [{ uid, nickname, weightChangePct, imemAvg, completionDays }]
//   → 각자 ccs + 지표별 순위 부여, ccs 내림차순 정렬 반환 (입력 배열 변형하지 않음)
function rankByCCS(participants) {
  const n = Array.isArray(participants) ? participants.length : 0;
  if (!n) return [];
  const ps = participants.map((p) => ({ ...p }));
  const rankBy = (key) => {
    const sorted = [...ps].sort((a, b) => (b[key] || 0) - (a[key] || 0));
    sorted.forEach((p, i) => { p[`${key}Rank`] = n - i; });
  };
  rankBy('weightChangePct');
  rankBy('imemAvg');
  rankBy('completionDays');
  ps.forEach((p) => {
    p.ccs = p.weightChangePctRank * 0.40
          + p.imemAvgRank * 0.35
          + p.completionDaysRank * 0.25;
  });
  return [...ps].sort((a, b) => b.ccs - a.ccs);
}

// 크루 평균 지표 (순수)
function crewAverages(participants) {
  const n = Array.isArray(participants) ? participants.length : 0;
  if (!n) return { avgImem: 0, avgWeightPct: 0, avgCompletion: 0, count: 0 };
  const sum = (k) => participants.reduce((s, p) => s + (p[k] || 0), 0);
  return {
    avgImem: sum('imemAvg') / n,
    avgWeightPct: sum('weightChangePct') / n,
    avgCompletion: sum('completionDays') / n,
    count: n,
  };
}

// ── 날짜 헬퍼 (YYYY-MM-DD, UTC 기준 — 날짜만 다루므로 안전) ──
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// 오늘(또는 어제)부터 역순으로 연속된 기록일 수. dates: 기록 있는 날짜 배열.
function computeStreak(dates, today) {
  if (!Array.isArray(dates) || !dates.length || !today) return 0;
  const set = new Set(dates);
  // 오늘 아직 기록 전일 수 있으니, 오늘 없으면 어제부터 카운트
  let cursor = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}

// 마지막 기록일로부터 며칠 지났나. 기록 없으면 Infinity.
function daysSinceLastRecord(dates, today) {
  if (!Array.isArray(dates) || !dates.length || !today) return Infinity;
  const last = dates.slice().sort().pop();
  return daysBetween(last, today);
}

// ── 마일스톤 (그룹 축하) ──
// stats: { maxScore, streak, weightLost }  done: 이미 축하한 key 배열
// → 새로 달성한 마일스톤 key 배열
function detectMilestones(stats, done) {
  const d = Array.isArray(done) ? done : [];
  const s = stats || {};
  const earned = [];
  const add = (k, cond) => { if (cond && !d.includes(k)) earned.push(k); };
  add('score90', (s.maxScore || 0) >= 90);
  add('streak7', (s.streak || 0) >= 7);
  add('streak14', (s.streak || 0) >= 14);
  add('lost1kg', (s.weightLost || 0) >= 1);
  add('lost3kg', (s.weightLost || 0) >= 3);
  return earned;
}
function milestoneMessage(key, nickname) {
  const nick = nickname || '멤버';
  const M = {
    score90:  `🎉 ${nick}님, IMEM 90점 돌파! 오늘 완벽했어요 ✨`,
    streak7:  `🔥 ${nick}님, 7일 연속 기록 달성! 꾸준함이 최고예요`,
    streak14: `🏅 ${nick}님, 14일 연속! 이제 완전히 습관이 됐네요`,
    lost1kg:  `🎯 ${nick}님, 첫 1kg 감량 달성! 시작이 반이에요`,
    lost3kg:  `💪 ${nick}님, 3kg 감량! 변화가 눈에 보이기 시작해요`,
  };
  return M[key] || null;
}

// ── 부드러운 복귀 (개인 DM) ──
// 3일 이상 비활성 + 5일 backoff. 한 번도 기록 없는 사람(Infinity)은 제외.
function shouldNudgeReturn(state, inactiveDays, today) {
  if (!Number.isFinite(inactiveDays) || inactiveDays < 3) return false;
  const last = state && state.lastNudge;
  if (last && daysBetween(last, today) < 5) return false;
  return true;
}
function returnNudgeMessage(nickname) {
  const nick = nickname ? `${nickname}님, ` : '';
  return `${nick}요즘 좀 뜸하셨죠? 🌿\n무너진 날이 있어도 괜찮아요 — 오늘 딱 하나, 가볍게 다시 시작해봐요. 크루가 기다리고 있어요.`;
}

module.exports = {
  resolveNickname, isCrewActive, isMember, parseSetupArgs, validateNickname,
  rankByCCS, crewAverages,
  addDays, daysBetween, computeStreak, daysSinceLastRecord,
  detectMilestones, milestoneMessage, shouldNudgeReturn, returnNudgeMessage,
};
