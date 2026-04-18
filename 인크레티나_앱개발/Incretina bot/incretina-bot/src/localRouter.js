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
  meal: /^(\s*오늘\s*)?(식단|식사|뭐\s*먹|뭘\s*먹|먹은\s*거|먹은거|칼로리|kcal|끼니|밥|식사\s*(기록|현황|요약|리스트|목록|평가|분석)|오늘\s*뭐\s*먹|하루\s*식단)/i,
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
  if (PATTERNS.timezone && PATTERNS.timezone.test(text)) return handleTimezone(ctx, text);
  if (PATTERNS.meal && PATTERNS.meal.test(trimmed)) return handleMealSummary(ctx);

  return null;
}

// ────────────────────
// Template handlers
// ────────────────────

async function handleStatus(ctx) {
  const { uid, profile, week, unlocked } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
  const daily = await getDailyRoutine(uid, date);
  const checks = daily.checks || {};

  // Current time in user's timezone for time-based filtering
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const nowMins = local.getHours() * 60 + local.getMinutes();

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
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
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

  var interp = interpretIMEM(imem, score);

  const lines = [
    '\ud83c\udfaf 오늘의 IMEM 점수',
    '',
    '종합 점수: ' + score + '점  —  ' + interp.score,
    '효율: ' + (eff * 100).toFixed(1) + '%  —  ' + interp.efficiency,
    '',
    '\ud83d\udd39 \u03b1 일주기 리듬: ' + imem.alpha_net.toFixed(2) + '  ' + bar(imem.alpha_net),
    '   ' + interp.alpha,
    '\ud83d\udd39 \u03b2 영양 시퀀스: ' + imem.beta_net.toFixed(2) + '  ' + bar(imem.beta_net),
    '   ' + interp.beta,
    '\ud83d\udd39 \u03b3 신체 활동: ' + imem.gamma_net.toFixed(2) + '  ' + bar(imem.gamma_net),
    '   ' + interp.gamma,
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

// ────────────────────
// Meal summary + coaching
// ────────────────────

async function handleMealSummary(ctx) {
  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
  const daily = await getDailyRoutine(uid, date);
  const meals = daily.meals || [];

  if (meals.length === 0) {
    return '🍽 오늘 기록된 식사가 없어요.\n\n음식 사진을 보내거나 "김치찌개 먹었어" 같이 말씀해 주시면 기록해 드릴게요!';
  }

  // Current time
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const nowH = local.getHours();

  // Calculate targets
  const analysis = analyzeMealDay(meals, profile);
  const totalKcal = meals.reduce(function(s, m) { return s + (Number(m.kcal) || 0); }, 0);

  const lines = ['🍽 오늘의 식단 리포트', ''];

  // ── Meal list with evaluation ──
  meals.forEach(function(m, i) {
    const t = m.time || '?';
    const menu = (m.menu || '식사');
    const kcal = Number(m.kcal) || 0;
    const typeKr = MEAL_TYPE_KR[classifyMealType(m.time)] || '간식';
    const betaTag = (typeof m.betaScore === 'number' && m.betaScore >= 0.7) ? ' ✅β優'
      : (typeof m.betaScore === 'number' && m.betaScore >= 0.4) ? ' ⚠️β中' : '';
    lines.push('  ' + (i + 1) + '. [' + typeKr + '] ' + t + ' ' + menu);
    lines.push('     ' + kcal + ' kcal' + betaTag);
  });

  // ── Total summary ──
  lines.push('');
  lines.push('📊 누적: ' + totalKcal + ' kcal (' + meals.length + '끼)');

  if (analysis) {
    const pct = Math.round((totalKcal / analysis.dailyTarget) * 100);
    const bar = '█'.repeat(Math.min(10, Math.round(pct / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(pct / 10)));
    lines.push('🎯 목표: ' + analysis.dailyTarget + ' kcal  [' + bar + '] ' + pct + '%');
    lines.push('');

    // ── Coaching: So What? ──
    lines.push('💡 코칭');

    // Remaining calorie budget
    if (analysis.remaining > 200) {
      lines.push('  ✅ 여유 약 ' + analysis.remaining + 'kcal — 아직 균형 잡힌 식사 가능해요.');
    } else if (analysis.remaining > 0) {
      lines.push('  ⚠️ 남은 여유 ' + analysis.remaining + 'kcal — 가벼운 식사로 마무리하세요.');
    } else {
      lines.push('  🔴 목표 초과 ' + Math.abs(analysis.remaining) + 'kcal — 오늘은 추가 식사를 자제해 주세요.');
    }

    // Next meal guidance based on time
    if (nowH < 10 && !meals.some(function(m) { return classifyMealType(m.time) === 'lunch'; })) {
      var lunchBudget = Math.round(analysis.dailyTarget * 0.4);
      lines.push('  🍱 점심 예산: ~' + lunchBudget + 'kcal (채소→단백질→탄수 순서 추천)');
    } else if (nowH < 16 && !meals.some(function(m) { return classifyMealType(m.time) === 'dinner'; })) {
      var dinnerBudget = Math.max(0, analysis.remaining);
      lines.push('  🍲 저녁 예산: ~' + Math.min(dinnerBudget, Math.round(analysis.dailyTarget * 0.3)) + 'kcal');
    } else if (nowH >= 19) {
      lines.push('  🌙 19시 이후 — 야식은 β 페널티가 적용돼요. 물이나 허브차 추천!');
    }

    // Protein check
    if (analysis.proteinGap > 20) {
      lines.push('  💪 단백질 ' + analysis.proteinGap + 'g 부족 — 닭가슴살/계란/두부로 채워보세요.');
    } else if (analysis.proteinGap <= 0) {
      lines.push('  💪 단백질 목표 달성! 👏');
    }

    // Macro balance warning
    if (analysis.isHighCarb) {
      lines.push('  🍚 탄수화물 비중 높음 — 다음 끼니는 단백질/채소 위주로!');
    } else if (analysis.isLowProtein) {
      lines.push('  ⚡ 단백질 비중 낮음 — 단백질 반찬 추가 추천');
    }

    // Late night eating
    if (analysis.hasLateNight) {
      lines.push('  🚨 야식 감지 — 내일 아침 단식 1시간 연장으로 회복 가능!');
    }

    // Beta score average
    var betaScores = meals.filter(function(m) { return typeof m.betaScore === 'number'; }).map(function(m) { return m.betaScore; });
    if (betaScores.length > 0) {
      var avgBeta = betaScores.reduce(function(a, b) { return a + b; }, 0) / betaScores.length;
      if (avgBeta >= 0.7) {
        lines.push('  🏆 식사 순서 점수 우수! (평균 β ' + avgBeta.toFixed(2) + ')');
      } else if (avgBeta < 0.4) {
        lines.push('  📋 식사 순서 개선 필요 (평균 β ' + avgBeta.toFixed(2) + ') — 채소 먼저!');
      }
    }

    // Exercise suggestion if over target
    if (analysis.remaining < -200) {
      var walkMins = Math.round(Math.abs(analysis.remaining) / 5);
      lines.push('  🚶 칼로리 초과분 소모: 빠른 걷기 약 ' + walkMins + '분 추천');
    }
  } else {
    // No profile data for target calculation
    lines.push('');
    lines.push('💡 프로필(키/체중/나이)을 앱에 입력하면 맞춤 칼로리 목표와 코칭을 받을 수 있어요.');
  }

  return lines.join('\n');
}

module.exports = { tryLocalRoute };
