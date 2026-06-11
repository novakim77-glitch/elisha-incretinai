// localRouter.js — Template-based responses for simple queries.
// Bypasses Claude API entirely for status/score/weight lookups.
// Saves API calls, reduces cost, and responds instantly (~0.1s vs ~3s).

const {
  calculateIMEM, totalEfficiency, calculateScore, calculateSunTimes, constants,
} = require('imem-core');
const { getDailyRoutine, getWeightHistory, logWeight, toLogicalDate, appendMeal, saveBodyComp, getLatestBodyComp } = require('./store');
const { preloadCommand } = require('./commands/preload');
const { handleFeelingText, parseFeeling } = require('./commands/feeling');
const { resolveUser, checksObjToArray, riskObjToArray } = require('./commands/_shared');
const { analyzeMealDay, classifyMealType, MEAL_TYPE_KR, calculateTargetCalories } = require('imem-core');
const { withRetry } = require('./writeSafety');

// ────────────────────
// Intent detection patterns (Korean)
// ────────────────────

const PATTERNS = {
  status: /^(\s*오늘\s*)?(현황|상태|현재|남은\s*(루틴|거)|루틴|뷐\s*남|할\s*거|체크\s*(현황|상태)|몇\s*개\s*남|진행\s*상황|투데이|today)/i,
  score: /^(\s*오늘\s*)?(점수|스코어|score|imem|효율|알파|베타|감마|α|β|γ)/i,
  weight: /^(체중|몬무게|kg|킬로)\s*(추이|변화|히스토리|그래프|얼마)/i,  // "기록" 제거 — 저장 패턴과 구분
  weightSimple: /^(체중|몬무게)\s*$/i,
  meal: /^(\s*오늘\s*)?(식단|식사|뭐\s*먹|뭘\s*먹|먹은\s*거|먹은거|칼로리|kcal|끼니|밥|식사\s*(기록|현황|요약|리스트|목록|평가|분석)|오늘\s*뭐\s*먹|하루\s*식단)/i,
  bodyCompSave: /골격근|근육량|SMM|체지방률|체지방|BFP|기초대사|BMR|내장지방|위상각/i,
  bodyCompQuery: /^(?:내\s*)?체성분/i,
  // 프리로드 자연어 감지 — "프리로드", "식전 뭐", "오늘 프리로드" 등
  preload: /프리로드|식\s*전\s*(뭐|추천|레시피|뭐\s*먹|먹을|메뉴)|preload/i,
  // 체중 저장 패턴 — Claude hallucination 방지를 위해 직접 저장
  // 매칭 예: "오늘 체중 72.5", "체중 72.5 기록", "72.5kg 기록", "72kg", "오늘 체중 84.5kg 기록해줘"
  weightLog: /^(?:오늘\s*)?(?:체중|몸무게)?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|킬로|kilo)?(?:\s*(?:기록|저장|입력|적어|넣어)[\s가-힣!?~.]*)?$/i,
  weightLogReverse: /^(?:오늘\s*)?체중\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|킬로)?[\s가-힣!?~.]*$/i,
};

/**
 * Try to handle the message locally (no AI).
 * Returns a reply string if handled, or null if AI is needed.
 */
async function tryLocalRoute(text, ctx) {
  if (!text) return null;
  const trimmed = text.trim();

  // ★ 체성분 query
  if (PATTERNS.bodyCompQuery.test(trimmed)) return handleBodyCompQuery(ctx);
  // ★ 체성분 save
  const bcomp = parseBodyComp(trimmed);
  if (bcomp !== null) return handleBodyCompSave(ctx, bcomp);

  // ★ 체중 저장 — Claude hallucination 방지 위해 최우선 처리
  // (query 패턴보다 먼저 확인해야 "오늘 체중 84.5 기록"이 조회가 아닌 저장으로 처리됨)
  const wlog = parseWeightLog(trimmed);
  if (wlog !== null) return handleWeightLog(ctx, wlog);

  // ★ 식단 저장 — Claude hallucination 방지 (2026-05-22)
  // 칼로리 명시 + 저장 키워드 + 쿼리 아님 조건 모두 만족 시 직접 저장
  const mlog = parseMealLog(trimmed);
  if (mlog !== null) return handleMealLog(ctx, mlog);

  if (PATTERNS.status.test(trimmed)) return handleStatus(ctx);
  if (PATTERNS.score.test(trimmed)) return handleScore(ctx);
  if (PATTERNS.weight.test(trimmed)) return handleWeightHistory(ctx);
  if (PATTERNS.weightSimple.test(trimmed)) return handleWeightHistory(ctx);
  if (PATTERNS.timezone && PATTERNS.timezone.test(text)) return handleTimezone(ctx, text);
  if (PATTERNS.meal && PATTERNS.meal.test(trimmed)) return handleMealSummary(ctx);

  // ★ 프리로드 자연어 감지 → /preload 와 동일한 흐름으로 진입
  if (PATTERNS.preload.test(trimmed)) {
    await preloadCommand(ctx);
    return '__handled__';
  }

  // ★ 느낌 감지 — Feature Flag OFF면 null 반환 → Claude로 폴백
  const feelingType = parseFeeling(trimmed);
  if (feelingType) {
    const reply = await handleFeelingText(ctx, feelingType);
    if (reply) return reply;
  }

  return null;
}

/**
 * 체중 저장 의도인지 판별 후 kg 숫자 추출. 아니면 null.
 * 매칭 예:
 *   "72.5" → 72.5 (순수 숫자: 체중일 확률 높음, 25~300 범위일 때만)
 *   "72.5kg" → 72.5
 *   "72.5kg 기록" → 72.5
 *   "오늘 체중 84.5" → 84.5
 *   "체중 84.5 기록해줘" → 84.5
 *   "오늘 84.5kg" → 84.5
 * 매칭 안 함:
 *   "체중 얼마" → null (query)
 *   "체중 추이" → null (query)
 *   "체중 기록" (숫자 없음) → null
 *   "체중" → null
 */
function parseWeightLog(text) {
  // 체중 query 패턴이면 절대 저장으로 처리하지 않음
  if (PATTERNS.weight.test(text) || PATTERNS.weightSimple.test(text)) return null;

  // 케이스 1: "오늘 체중 NN", "체중 NN", "체중 NN kg 기록" 등
  const m1 = text.match(/^(?:오늘\s*)?(?:체중|몸무게)\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|킬로)?[\s가-힣!?~.]*$/i);
  if (m1) {
    const kg = Number(m1[1]);
    if (kg >= 25 && kg <= 300) return kg;
  }

  // 케이스 2: "NN kg", "NNkg 기록", "오늘 NNkg" — 숫자+kg 단위
  const m2 = text.match(/^(?:오늘\s*)?(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|킬로|kilo)(?:\s*(?:기록|저장|입력|적어|넣어)[\s가-힣!?~.]*)?$/i);
  if (m2) {
    const kg = Number(m2[1]);
    if (kg >= 25 && kg <= 300) return kg;
  }

  // 케이스 3: "NN 기록", "NN.N 기록" — 숫자만 + 기록 키워드
  const m3 = text.match(/^(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|킬로)?\s*(?:기록|저장|입력)[\s가-힣!?~.]*$/i);
  if (m3) {
    const kg = Number(m3[1]);
    if (kg >= 25 && kg <= 300) return kg;
  }

  return null;
}

// ────────────────────
// ★ 식단 저장 직접 처리 (Claude hallucination 차단) — 2026-05-22
// ────────────────────

/**
 * 식단 저장 의도인지 판별 후 { menu, kcal, mealTimeHint } 반환. 아니면 null.
 *
 * 매칭 조건 (모두 만족):
 *   1) 저장 키워드 (기록/저장/입력/넣어/적어/추가) 존재
 *   2) 조회 키워드 (알려/얼마/어때/어떻/알고싶/보여) 미존재
 *   3) kg/킬로 단위 미존재 (체중과 구분)
 *   4) 칼로리 숫자 50~3000 범위
 *   5) 메뉴 또는 끼니 시간 힌트 존재 (둘 다 없으면 모호 → 거부)
 *
 * 매칭 예:
 *   "김치찌개 800kcal 기록"          → { menu: '김치찌개', kcal: 800 }
 *   "오늘 점심 제육볶음 850 기록"     → { menu: '제육볶음', kcal: 850, mealTimeHint: 'lunch' }
 *   "저녁 라면 600 기록해줘"          → { menu: '라면', kcal: 600, mealTimeHint: 'dinner' }
 *   "점심에 비빔밥 700 저장"          → { menu: '비빔밥', kcal: 700, mealTimeHint: 'lunch' }
 *   "점심 700 기록" (메뉴 없음)       → { menu: '점심식사', kcal: 700, mealTimeHint: 'lunch' }
 *
 * 매칭 안 함:
 *   "200 기록" (메뉴·끼니 모두 없음)  → null (모호 → Claude로 넘김)
 *   "김치찌개 칼로리 알려줘"           → null (조회)
 *   "오늘 뭐 먹었지"                  → null (조회)
 *   "체중 84.5 기록" (kg 의도)        → null (kg 단위 검사로 거부, 또는 parseWeightLog가 먼저 처리)
 *   "라면 4000 기록" (이상치)         → null (kcal 범위 초과)
 */
function parseMealLog(text) {
  // 1) 저장 키워드 필수
  if (!/(기록|저장|입력|넣어|적어|추가)/.test(text)) return null;
  // 2) 조회 키워드 제외
  if (/(알려|얼마|어때|어떻|알고\s*싶|보여|보내줘|어땠어)/.test(text)) return null;
  // 3) kg/킬로 단위 제외 (체중 의도)
  if (/\d+(?:\.\d+)?\s*(?:kg|킬로|kilo)/i.test(text)) return null;
  // 4) 체중·몸무게 키워드 제외 (체중 의도 — parseWeightLog가 먼저 잡지만 이중 안전망)
  if (/체중|몸무게/i.test(text)) return null;

  // 4) 칼로리 숫자 추출 (2~4자리)
  const kcalMatch = text.match(/(\d{2,4})(?:\.\d{1,2})?(?:\s*(?:kcal|칼로리|kc|cal))?/i);
  if (!kcalMatch) return null;
  const kcal = Number(kcalMatch[1]);
  if (kcal < 50 || kcal > 3000) return null;

  // 5) 끼니 시간 힌트 (전체 텍스트 기반)
  let mealTimeHint = null;
  if (/(아침|모닝|breakfast)/i.test(text)) mealTimeHint = 'breakfast';
  else if (/(점심|lunch)/i.test(text)) mealTimeHint = 'lunch';
  else if (/(저녁|dinner|디너)/i.test(text)) mealTimeHint = 'dinner';
  else if (/(야식|새벽)/i.test(text)) mealTimeHint = 'lateNight';

  // 6) 메뉴 추출 (kcal 숫자 이전 부분)
  let menuPart = text.substring(0, kcalMatch.index).trim();
  // 시간/날짜 prefix 제거
  menuPart = menuPart.replace(/^(오늘|지금|방금|어제)\s*/i, '');
  // 끼니 prefix 제거
  menuPart = menuPart.replace(/^(아침|점심|저녁|간식|야식|새벽|모닝)\s*[에는을를]?\s*/i, '');
  // 조사 제거
  menuPart = menuPart.replace(/^(에|는|을|를|이|가|로|으로)\s+/i, '');
  // 동사 제거 (뒷부분)
  menuPart = menuPart.replace(/\s*(먹었어|먹음|먹어|먹었|먹은|먹는다|먹어버림)$/i, '').trim();

  // 7) 메뉴 검증
  if (!menuPart || menuPart.length < 1) {
    // 메뉴 없지만 끼니 힌트 있으면 기본 메뉴명 사용
    if (mealTimeHint) {
      const labels = { breakfast: '아침식사', lunch: '점심식사', dinner: '저녁식사', lateNight: '야식' };
      menuPart = labels[mealTimeHint];
    } else {
      // 메뉴·끼니 모두 없음 → 모호 → Claude로 위임
      return null;
    }
  }
  if (menuPart.length > 30) menuPart = menuPart.substring(0, 30);

  return { menu: menuPart, kcal, mealTimeHint };
}

async function handleMealLog(ctx, parsed) {
  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
  const now = new Date();

  // 현재 시각 (HH:MM, 사용자 timezone 기준)
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  }).format(now);

  const meal = {
    menu: parsed.menu,
    kcal: parsed.kcal,
    kcalLow: null,
    kcalHigh: null,
    macros: { protein: null, fat: null, carbs: null },
    hasVeg: false,
    hasProtein: false,
    betaScore: 0,
    ts: now,
    time,
    source: 'localRouter.mealLog',
  };

  let r;
  try {
    r = await withRetry(() => appendMeal(uid, date, meal), 'localRouter.appendMeal');
  } catch (e) {
    console.error('localRouter meal save failed after retries:', e.message || e);
    return '⚠️ 식사 저장이 실패했어요. 잠시 후 다시 시도해 주세요.';
  }

  // 누적 칼로리 + 목표 대비 진행률
  const totalKcal = r.dailyKcal || 0;
  const mealCount = r.mealCount || 0;
  let progressTxt = `\n📊 누적: ${totalKcal} kcal (${mealCount}끼)`;

  try {
    const dailyTarget = calculateTargetCalories(profile);
    if (dailyTarget) {
      const pct = Math.round((totalKcal / dailyTarget) * 100);
      progressTxt += `\n🎯 목표: ${dailyTarget} kcal (${pct}%)`;
      const remaining = dailyTarget - totalKcal;
      if (remaining > 200) {
        progressTxt += `\n✅ 여유 ${remaining}kcal — 균형 잡힌 식사 가능`;
      } else if (remaining > 0) {
        progressTxt += `\n⚠️ 남은 여유 ${remaining}kcal — 가볍게 마무리하세요`;
      } else {
        progressTxt += `\n🔴 목표 초과 ${Math.abs(remaining)}kcal — 추가 식사 자제 권장`;
      }
    }
  } catch (_) { /* non-fatal */ }

  return `✅ *${parsed.menu}* ${parsed.kcal}kcal 기록 완료\n📅 ${date} ${time} (앱에 즉시 반영)${progressTxt}`;
}

// ─────────────────────────────────────────────
// ★ 체성분 입력 처리 (Galaxy Watch / InBody -> gamma 정밀화)
// ─────────────────────────────────────────────

/**
 * 체성분 저장 의도 판별 + 값 추출. 아니면 null.
 *
 * 지원 입력 예:
 *   "골격근량 33.9 체지방률 25.6 기초대사량 1744"
 *   "SMM 33.9 BFP 25.6 BMR 1744"
 *   "근육량 34 체지방 25.6"
 *   "체성분: 골격근 33.9, 체지방률 25.6, 대사 1750"
 *   "내장지방레벨 4 위상각 5.8" (InBody 프리미엄)
 *   "오늘 체성분 쟀어: 골격근 33.9 체지방 25.6"
 *
 * 반환: { smm?, bfp?, bmr?, visceralFat?, phaseAngle?, source } 또는 null
 * 최소 조건: smm 또는 bfp 중 하나 이상 필수
 */
function parseBodyComp(text) {
  if (!PATTERNS.bodyCompSave.test(text)) return null;
  // 조회 의도면 null — handleBodyCompQuery로 분기
  if (/어때|얼마|어떻|어땠|보여|알려|조회|현황|어떤가/i.test(text)) return null;

  var result = {};

  // SMM (골격근량): 10~60 kg
  var smmM = text.match(/(?:골격근량?|근육량?|SMM)\s*[:=,]?\s*(\d+(?:\.\d{1,2})?)/i);
  if (smmM) { var sv = Number(smmM[1]); if (sv >= 10 && sv <= 60) result.smm = sv; }

  // BFP (체지방률): 3~60 %
  var bfpM = text.match(/(?:체지방률?|지방률?|BFP)\s*[:=,]?\s*(\d+(?:\.\d{1,2})?)/i);
  if (bfpM) { var bv = Number(bfpM[1]); if (bv >= 3 && bv <= 60) result.bfp = bv; }

  // BMR (기초대사량): 800~4000 kcal
  var bmrM = text.match(/(?:기초대사량?|대사량|BMR)\s*[:=,]?\s*(\d{3,4})/i);
  if (bmrM) { var mv = Number(bmrM[1]); if (mv >= 800 && mv <= 4000) result.bmr = mv; }

  // 내장지방레벨 (InBody): 1~20
  var vfM = text.match(/내장지방\s*(?:레벨|수준|등급|level)?\s*[:=,]?\s*(\d+(?:\.\d{1,2})?)/i);
  if (vfM) { var vv = Number(vfM[1]); if (vv >= 1 && vv <= 20) result.visceralFat = vv; }

  // 위상각 (InBody): 2~10 degrees
  var paM = text.match(/위상각\s*[:=,]?\s*(\d+(?:\.\d{1,2})?)/i);
  if (paM) { var pv = Number(paM[1]); if (pv >= 2 && pv <= 10) result.phaseAngle = pv; }

  // 최소 조건: smm 또는 bfp 중 하나 필수
  if (!result.smm && !result.bfp) return null;

  result.source = (result.visceralFat || result.phaseAngle) ? 'inbody' : 'galaxy_watch';
  return result;
}

async function handleBodyCompSave(ctx, parsed) {
  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);

  // gamma 변화 계산 (저장 전 미리)
  var computeGammaBodyAdj;
  try {
    computeGammaBodyAdj = require('imem-core').computeGammaBodyAdj;
  } catch(_) { computeGammaBodyAdj = function() { return 0; }; }

  var adjAfter = computeGammaBodyAdj ? computeGammaBodyAdj(Object.assign({}, parsed, { gender: profile.gender })) : 0;

  // 저장 (withRetry: 일시적 네트워크 오류 3회 재시도 — 다른 쓰기 경로와 동일 보호)
  try {
    await withRetry(() => saveBodyComp(uid, date, Object.assign({}, parsed, { gender: profile.gender || null })), 'localRouter.saveBodyComp');
  } catch (e) {
    console.error('[bodyComp] save failed after retries:', e.message);
    return '⚠️ 체성분 저장에 실패했어요. 잠시 후 다시 시도해 주세요.';
  }

  // 응답 메시지
  var lines = ['✅ *체성분 기록 완료*  ' + date, ''];

  lines.push('📊 *측정값*');
  if (parsed.smm)         lines.push('  💪 골격근량: ' + parsed.smm + ' kg');
  if (parsed.bfp)         lines.push('  🔸 체지방률: ' + parsed.bfp + '%');
  if (parsed.bmr)         lines.push('  ⚡ 기초대사량: ' + String(parsed.bmr) + ' kcal');
  if (parsed.visceralFat) lines.push('  🔴 내장지방레벨: ' + parsed.visceralFat);
  if (parsed.phaseAngle)  lines.push('  🔬 위상각: ' + parsed.phaseAngle + '°');
  lines.push('');

  // gamma 해석
  lines.push('🔬 *γ (인크레틴 민감도) 분석*');
  var smmRef = (profile.gender === 'F') ? 21 : 27;
  var bfpRef = (profile.gender === 'F') ? 25 : 18;

  if (parsed.smm) {
    if (parsed.smm > smmRef + 4) {
      lines.push('  ✅ 골격근량 우수 → GLP-1 수용 능력 높음 (γ ↑)');
    } else if (parsed.smm > smmRef) {
      lines.push('  ✅ 골격근량 양호 → 인크레틴 반응성 기본 이상');
    } else if (parsed.smm < smmRef - 3) {
      lines.push('  ⚠️ 골격근량 부족 → 근력운동 강화 권장 (γ ↑ 경로)');
    }
  }

  if (parsed.bfp) {
    var bfpDiff = parsed.bfp - bfpRef;
    if (bfpDiff > 8)      lines.push('  🔴 체지방률 높음 → 인크레틴 수용체 억제 가능 (γ ↓)');
    else if (bfpDiff > 3) lines.push('  ⚠️ 체지방률 경계 초과 → 내장지방 확인 권장');
    else if (bfpDiff < 0) lines.push('  ✅ 체지방률 양호');
  }

  if (parsed.visceralFat) {
    if (parsed.visceralFat > 10)     lines.push('  🔴 내장지방 높음 → 식후 산책을 오늘의 최우선 루틴으로');
    else if (parsed.visceralFat > 5) lines.push('  ⚠️ 내장지방 경계 → 저녁 마감(19시) 준수가 핵심');
    else                             lines.push('  ✅ 내장지방 양호');
  }

  if (adjAfter > 0.015) {
    lines.push('  📈 체성분 기반 γ: 기본 설문보다 유리한 조건으로 코칭 조정됨');
  } else if (adjAfter < -0.015) {
    lines.push('  📉 체성분 기반 γ: 개선 여지 반영 — 코칭 강도 조정됨');
  }
  lines.push('');

  // InBody 업그레이드 힌트
  if (parsed.source === 'galaxy_watch') {
    lines.push('💡 *InBody 측정 시 추가 입력*');
    lines.push('  내장지방레벨 + 위상각 → γ 정밀도 한 단계 더 향상');
    lines.push('  예: "내장지방레벨 4 위상각 5.8"');
    lines.push('');
  }

  lines.push('/score 로 업데이트된 IMEM 점수 확인');
  return lines.join('\n');
}

async function handleBodyCompQuery(ctx) {
  const { uid, profile } = await resolveUser(ctx);
  const bc = await getLatestBodyComp(uid).catch(function() { return null; });

  if (!bc) {
    return (
      '📊 아직 체성분 데이터가 없어요.\n\n' +
      '갤럭시 워치 또는 인바디 측정 후 이렇게 입력하세요:\n' +
      '  "골격근량 33.9 체지방률 25.6 기초대사량 1744"\n\n' +
      '입력하면 γ(인크레틴 민감도)가 설문 기반에서\n체성분 기반으로 정밀해져요.'
    );
  }

  var computeGammaBodyAdj;
  try { computeGammaBodyAdj = require('imem-core').computeGammaBodyAdj; } catch(_) {}

  var adj = computeGammaBodyAdj ? computeGammaBodyAdj(Object.assign({}, bc, { gender: profile.gender })) : 0;
  var adjSign = adj >= 0 ? '+' : '';

  var lines = ['📊 *최근 체성분*  ' + bc.date + '  (' + (bc.source === 'inbody' ? 'InBody' : '갤럭시 워치') + ')', ''];
  if (bc.smm)         lines.push('  💪 골격근량: ' + bc.smm + ' kg');
  if (bc.bfp)         lines.push('  🔸 체지방률: ' + bc.bfp + '%');
  if (bc.bmr)         lines.push('  ⚡ 기초대사량: ' + String(bc.bmr) + ' kcal');
  if (bc.visceralFat) lines.push('  🔴 내장지방레벨: ' + bc.visceralFat);
  if (bc.phaseAngle)  lines.push('  🔬 위상각: ' + bc.phaseAngle + '°');
  lines.push('');
  lines.push('🔬 γ 보정값: ' + adjSign + adj.toFixed(3) + '  (체성분 기반 오버레이)');
  lines.push('재측정 후 새 값 입력 시 즉시 업데이트됩니다.');
  return lines.join('\n');
}

async function handleWeightLog(ctx, kg) {
  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);

  try {
    await withRetry(() => logWeight(uid, date, kg), 'localRouter.logWeight');
  } catch (e) {
    console.error('localRouter weight save failed after retries:', e.message || e);
    return '⚠️ 체중 저장이 실패했어요. 잠시 후 다시 시도해 주세요.';
  }

  // 이전 기록과 변화량 계산
  let deltaTxt = '';
  try {
    const series = await getWeightHistory(uid, 7);
    const prior = series.filter((s) => s.date < date).slice(-1)[0];
    if (prior) {
      const delta = Number((kg - prior.weight).toFixed(1));
      const sign = delta > 0 ? '+' : '';
      const icon = delta < -0.1 ? '🟢' : delta > 0.1 ? '🔴' : '➖';
      deltaTxt = `\n${icon} 이전(${prior.date}) ${prior.weight}kg 대비 ${sign}${delta}kg`;
    }
  } catch (_) { /* non-fatal */ }

  return `✅ 체중 *${kg} kg* 기록 완료\n📅 ${date} (앱에 즉시 반영)${deltaTxt}\n\n예측을 보시려면 /predict`;
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
  const _timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const [_hh, _mm] = _timeFmt.format(now).split(':').map(Number);
  const nowMins = _hh * 60 + _mm;

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

  const lines = ['\ud83d\udcca 오늘의 루틴 현황', date + ' · Week ' + week, ''];

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
  const bodyComp = await getLatestBodyComp(uid).catch(function() { return null; });
  const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset, meals, bodyComp });
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
  const _mealTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
  const nowH = Number(_mealTimeFmt.format(now));

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
