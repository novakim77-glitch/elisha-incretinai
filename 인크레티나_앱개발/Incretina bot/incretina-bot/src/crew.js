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

module.exports = { resolveNickname, isCrewActive, isMember, parseSetupArgs, validateNickname };
