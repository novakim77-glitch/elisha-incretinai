// recovery-detect.js — 야식(R-06) 패턴 분류
// Phase 1 회복 코칭의 핵심 감지 로직.
// Firestore/bot 의존성 없음 — 순수 함수.

// riskHistory: getDailyRoutine 결과의 배열 (최근 N일)
// 각 항목: { riskActive: map|array, riskChecks: map|array } 등
// R-06 = 야식, 리스크 배열 6번째 항목 (0-based index 5)

const R06_INDEX = 5;

/**
 * 야식(R-06) 패턴을 분석해 분기 타입을 반환한다.
 *
 * @param {Array<Object>} riskHistory - 최근 N일 일별 데이터 (날짜 내림차순 또는 오름차순)
 * @returns {'occasional'|'streak'|'habit'|'none'}
 *   none       — 야식 기록 없음
 *   occasional — 어쩌다 야식 (1~2회, 연속 아님)
 *   streak     — 연속 야식 (최근 2~3일 연속)
 *   habit      — 습관 야식 (7일 중 5일 이상 또는 70%+)
 */
function classifyLateNightPattern(riskHistory) {
  if (!Array.isArray(riskHistory) || riskHistory.length === 0) return 'none';

  // 각 날짜별로 R-06 활성 여부 추출
  const flags = riskHistory.map((day) => {
    const risk = day.riskActive || day.riskChecks || {};
    if (Array.isArray(risk)) {
      return !!risk[R06_INDEX];
    }
    // map 형태: { 0:true, 5:true, ... } 또는 { "5": true, ... }
    return !!(risk[R06_INDEX] || risk[String(R06_INDEX)]);
  });

  const total = flags.length;
  const count = flags.filter(Boolean).length;

  if (count === 0) return 'none';

  // 습관 야식: 70% 이상 (최소 5일 이상 기록이 있는 경우)
  if (total >= 5 && count / total >= 0.7) return 'habit';

  // 연속 야식: 최근 2일 이상 연속 (마지막 날 포함)
  const recent = flags.slice(-3);
  const lastDay = recent[recent.length - 1];
  const recentCount = recent.filter(Boolean).length;
  if (lastDay && recentCount >= 2) return 'streak';

  // 어쩌다 야식
  return 'occasional';
}

module.exports = { classifyLateNightPattern };
