// localRouter.js — Template-based responses for simple queries.
// Bypasses Claude API entirely for status/score/weight lookups.
// Saves API calls, reduces cost, and responds instantly (~0.1s vs ~3s).

const {
  calculateIMEM, totalEfficiency, calculateScore, calculateSunTimes, constants,
} = require('imem-core');
const { getDailyRoutine, getWeightHistory, toLogicalDate } = require('./store');
const { resolveUser, checksObjToArray, riskObjToArray } = require('./commands/_shared');
const { analyzeMealDay, classifyMealType, MEAL_TYPE_KR } = require('imem-core');

// ────────────────────
// Intent detection patterns (Korean)
// ────────────────────

const PATTERNS = {
  status: /^(\s*오늘\s*)?(현황|상태|현재|남은\s*(루틴|거)|루틴|뷐\s*남|할\s*거|체크\s*(현황|상태)|몇\s*개\s*남|진행\s*상황|투데이|today)/i,
  score: /^(\s*오늘\s*)?(점수|스코어|score|imem|효율|알파|베타|감마|α|β|γ)/i,
  weight: /^(체중|몬무게|kg|킬로)\s*(추이|변화|기록|히스토리|그래프|얼마)/i,
  weightSimple: /^(체중|몬무게)\s*$/i,
};

/**
 * Try to handle the message locally (no AI).
 * Returns a reply string if handled, or null if AI is needed.
 */
async function tryLocalRoute(text, ctx) {
  if (!text) return null;
  const trimmed = text.trim();

  if (PATTERNS.status.test(trimmed)) return handleStatus(ctx);
  if (PATTERNS.score.test(trimmed)) return handleScore(ctx);
  if (PATTERNS.weight.test(trimmed)) return handleWeightHistory(ctx);
  if (PATTERNS.weightSimple.test(trimmed)) return handleWeightHistory(ctx);
  if (PATTERNS.meal && PATTERNS.meal.test(trimmed)) return handleMealSummary(ctx);

  return null;
}

// ────────────────────
// Template handlers
// ────────────────────

async function handleStatus(ctx) {
  const { uid, profile, week, unlocked } = await resolveUser(ctx);
  const date = toLogicalDate(new Date());
  const daily = await getDailyRoutine(uid, date);
  const checks = daily.checks || {};

  // Current time in KST (HH:MM) for time-based filtering
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const nowMins = kst.getHours() * 60 + kst.getMinutes();

  const completed = [];
  const upcoming = [];  // unchecked + time still ahead (can still do)
  const missed = [];    // unchecked + time already passed

  for (const i of unlocked) {
    const r = constants.routine[i] || {};
    if (checks[i]) {
      completed.push('  ' + r.icon + ' ' + r.title);
    } else {
      // Parse routine time "HH:MM" to minutes
      const parts = (r.t || '00:00').split(':');
      const rMins = Number(parts[0]) * 60 + Number(parts[1]);
      const critMark = r.crit ? '\u26a0\ufe0f ' : '';
      const line = '  ' + critMark + r.t + ' ' + r.icon + ' ' + r.title + '\n     \u2192 ' + r.action;
      if (nowMins < rMins + 60) {
        upcoming.push(line);  // still within 1hr window
      } else {
        missed.push(line);
      }
    }
  }

  const lines = ['\ud83d\udcca 오늘의 루틴 현황 (Week ' + week + ')', ''];

  if (completed.length > 0) {
    lines.push('\u2705 완료 (' + completed.length + '개)');
    completed.forEach(function(c) { lines.push(c); });
    lines.push('');
  }

  if (upcoming.length > 0) {
    lines.push('\ud83d\udcdd 남은 루틴 (' + upcoming.length + '개)');
    upcoming.forEach(function(r) { lines.push(r); });
    lines.push('');
  }

  if (missed.length > 0) {
    lines.push('\u23f0 놓친 루틴 (' + missed.length + '개)');
    missed.forEach(function(r) { lines.push(r); });
  }

  if (upcoming.length === 0 && missed.length === 0) {
    lines.push('\ud83c\udf89 오늘 루틴을 모두 완료했어요!');
  }

  if (daily.weight) {
    lines.push('');
    lines.push('\u2696\ufe0f 오늘 체중: ' + daily.weight + 'kg');
  }

  return lines.join('\n');
}

async function handleScore(ctx) {
  const { uid, profile, week } = await resolveUser(ctx);
  const date = toLogicalDate(new Date());
  const daily = await getDailyRoutine(uid, date);

  const checks = checksObjToArray(daily.checks);
  const riskActive = riskObjToArray(daily.riskActive);
  const recoveryDone = riskObjToArray(daily.recoveryDone);
  const lat = profile.lat || 37.5665;
  const sun = calculateSunTimes(lat);
  const meals = daily.meals || [];
  const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset, meals });
  const score = calculateScore({ checks, riskActive, recoveryDone, week });
  const eff = totalEfficiency(imem);

  const bar = function(v) {
    const filled = Math.round(v * 10);
    return '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  };

  const lines = [
    '\ud83c\udfaf 오늘의 IMEM 점수',
    '',
    '종합 점수: ' + score + '점  |  효율: ' + (eff * 100).toFixed(1) + '%',
    '',
    '\u03b1 일주기 리듬: ' + imem.alpha_net.toFixed(2) + '  ' + bar(imem.alpha_net),
    '\u03b2 영양 시퀀스: ' + imem.beta_net.toFixed(2) + '  ' + bar(imem.beta_net),
    '\u03b3 신체 활동: ' + imem.gamma_net.toFixed(2) + '  ' + bar(imem.gamma_net),
  ];

  const coeffs = [
    { key: '\u03b1', val: imem.alpha_net, tip: '일주기 리듬이 낮아요. 햇빛 노출과 저녁 마감에 신경 써 보세요.' },
    { key: '\u03b2', val: imem.beta_net, tip: '영양 시퀀스를 높여보세요. 채소 \u2192 단백질 \u2192 탄수 순서를 지켜보세요.' },
    { key: '\u03b3', val: imem.gamma_net, tip: '식후 걷기나 근력 운동을 추가해 보세요.' },
  ].sort(function(a, b) { return a.val - b.val; })[0];

  if (coeffs.val < 0.9) {
    lines.push('');
    lines.push('\ud83d\udca1 ' + coeffs.tip);
  }

  if (imem.beta_meal !== undefined && imem.beta_meal !== 1.0) {
    lines.push('');
    lines.push('\ud83c\udf7d\ufe0f \u03b2_meal \ubcf4\uc815: ' + imem.beta_meal.toFixed(3) + ' (\uc2dd\uc0ac ' + meals.length + '\ub07c \uae30\ubc18)');
  }

  return lines.join('\n');
}

async function handleWeightHistory(ctx) {
  const { uid } = await resolveUser(ctx);
  const series = await getWeightHistory(uid, 7);

  if (series.length === 0) {
    return '\u2696\ufe0f 최근 7일간 기록된 체중이 없어요.\n체중을 말씀해 주시면 기록해 드릴게요! (예: "72.5kg")';
  }

  const first = series[0];
  const last = series[series.length - 1];
  const delta = (last.weight - first.weight).toFixed(1);
  const trend = delta < -0.1 ? '\ud83d\udfe2 감소' : delta > 0.1 ? '\ud83d\udd34 증가' : '\u2796 유지';
  const sign = delta > 0 ? '+' : '';

  const lines = [
    '\u2696\ufe0f 최근 ' + series.length + '일 체중 추이',
    '',
  ];

  for (const s of series) {
    lines.push('  ' + s.date + ': ' + s.weight + 'kg');
  }

  lines.push('');
  lines.push(trend + ' ' + sign + delta + 'kg (' + first.weight + ' \u2192 ' + last.weight + ')');

  return lines.join('\n');
}

module.exports = { tryLocalRoute };
