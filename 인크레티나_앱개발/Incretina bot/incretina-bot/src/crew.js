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

module.exports = {
  resolveNickname, isCrewActive, isMember, parseSetupArgs, validateNickname,
  rankByCCS, crewAverages,
};
