// Natural-language chat handler — routes non-slash messages to Claude.
// Phase 3: persona + tool calling for routine/weight/score actions.

const {
  calculateIMEM, totalEfficiency, calculateScore, calculateSunTimes, constants,
  analyzeMealDay, classifyMealType, getMealBudget, calculateTargetCalories, MEAL_TYPE_KR,
} = require('imem-core');
const {
  getDailyRoutine, setRoutineChecks, logWeight, getWeightHistory, toLogicalDate,
  getBotSettings, appendMessage, getRecentMessages, appendMeal,
} = require('../store');
const { InlineKeyboard } = require('grammy');
const { resolveUser, checksObjToArray, riskObjToArray } = require('./_shared');
const { schedulePostMealWalk } = require('../proactive');
const {
  getClient, MODEL, FALLBACK_MODEL, BASIC_FALLBACK_MSG,
  MAX_TURNS, systemPrompt, TOOLS, classifyApiError,
} = require('../claude');
const { tryLocalRoute } = require('../localRouter');
const { withRetry, tryWrite } = require('../writeSafety');

const MAX_TOOL_LOOPS = 5;

// ─────────────────────────────────────────────
// 프롬프트 캐시 사용량 로거
// cache_creation_input_tokens: 캐시에 새로 저장된 토큰 (쓰기)
// cache_read_input_tokens    : 캐시에서 읽어온 토큰 (읽기 → 90% 할인)
// ─────────────────────────────────────────────
function logCacheUsage(usage, tag = '') {
  if (!usage) return;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  if (cw || cr) {
    console.log(`[cache${tag ? ':' + tag : ''}] write=${cw} read=${cr} input=${usage.input_tokens} output=${usage.output_tokens}`);
  }
}

// ─────────────────────────────────────────────
// Meal feedback builder (called after each meal save)
// ─────────────────────────────────────────────

function buildMealFeedback(meal, allMeals, profile) {
  const analysis = analyzeMealDay(allMeals, profile);
  if (!analysis) return '';

  const mealType = classifyMealType(meal.time);
  const mealTypeKr = MEAL_TYPE_KR[mealType] || '식사';
  const lines = [];

  // Cumulative calorie status
  if (analysis.remaining > 0) {
    lines.push(mealTypeKr + '까지 누적 ' + analysis.totalKcal + 'kcal — 남은 여유 약 ' + analysis.remaining + 'kcal');
  } else {
    lines.push(mealTypeKr + '까지 누적 ' + analysis.totalKcal + 'kcal — 목표 초과 ' + Math.abs(analysis.remaining) + 'kcal');
  }

  // Next meal suggestion
  if (mealType === 'breakfast' || mealType === 'lunch') {
    const nextType = mealType === 'breakfast' ? 'lunch' : 'dinner';
    const nextKr = MEAL_TYPE_KR[nextType];
    const budget = getMealBudget(analysis.dailyTarget, nextType);
    lines.push(nextKr + '은 ' + budget + 'kcal 이내 추천');
  }

  // Protein check
  if (analysis.proteinGap > 20) {
    lines.push('단백질 ' + analysis.proteinGap + 'g 더 필요 (목표 ' + analysis.proteinTarget + 'g)');
  }

  // Macro imbalance warning
  if (analysis.isHighCarb) {
    lines.push('탄수화물 비중이 높아요. 다음 식사에서 단백질/채소 비중을 높여보세요.');
  } else if (analysis.isLowProtein) {
    lines.push('단백질이 부족해요. 닭가슴살/계란/두부 추가 추천!');
  }

  // Late night warning
  if (mealType === 'lateNight') {
    lines.push('19시 이후 식사 — R-06 페널티 적용. 내일 아침 단식 1시간 연장으로 회복 가능!');
  }

  // Exercise suggestion if over target
  if (analysis.remaining < -200) {
    const walkMins = Math.round(Math.abs(analysis.remaining) / 5);
    lines.push('칼로리 초과분 소모: 빠른 걷기 약 ' + walkMins + '분 추천');
  }

  // Beta score coaching
  if (typeof meal.betaScore === 'number' && meal.betaScore < 0.5) {
    lines.push('식사 순서(채소→단백질→탄수) 개선으로 β 점수를 높일 수 있어요.');
  }

  return lines.join('\n');
}



// ─────────────────────────────────────────────
// Tool dispatcher
// ─────────────────────────────────────────────

async function runTool(name, input, sess) {
  const { uid, profile, week, unlocked, chatId } = sess;
  const tz = profile.timezone || 'Asia/Seoul';
  // sess.date는 chatHandler 세션 초기화 시 설정 — 동일 요청 내 날짜 일관성 보장
  const date = sess.date || toLogicalDate(new Date(), tz);

  switch (name) {
    case 'mark_routine':
    case 'unmark_routine': {
      const target = !!(name === 'mark_routine');
      const indices = (input.indices || []).map(Number).filter(Number.isInteger);
      const updates = {};
      const invalid = [];
      for (const human of indices) {
        const idx = human - 1;
        if (!unlocked.includes(idx)) { invalid.push(human); continue; }
        updates[idx] = target;
      }
      if (Object.keys(updates).length === 0) {
        return { ok: false, error: `유효한 루틴 번호가 없습니다. invalid=${invalid.join(',')}` };
      }
      try {
        await withRetry(() => setRoutineChecks(uid, date, updates), `setRoutineChecks(${name})`);
        sess.checks = { ...sess.checks, ...updates };
        return {
          ok: true,
          action: name,
          applied: Object.keys(updates).map((i) => Number(i) + 1),
          invalid,
        };
      } catch (e) {
        console.error(`${name} save failed after retries:`, e.message || e);
        return { ok: false, error: '루틴 저장이 실패했어요. 잠시 후 다시 시도해 주세요.' };
      }
    }

    case 'log_weight': {
      const kg = Number(input.kg);
      if (!Number.isFinite(kg) || kg < 25 || kg > 300) {
        return { ok: false, error: '체중은 25-300 kg 범위만 가능합니다.' };
      }
      try {
        await withRetry(() => logWeight(uid, date, kg), 'logWeight');
        sess.weight = kg;
        return { ok: true, kg, date };
      } catch (e) {
        console.error('log_weight save failed after retries:', e.message || e);
        return { ok: false, error: '체중 저장이 실패했어요. 잠시 후 다시 말씀해 주세요.' };
      }
    }

    case 'get_today_status': {
      const checked = Object.entries(sess.checks || {})
        .filter(([, v]) => v)
        .map(([k]) => Number(k) + 1);
      // 남은 루틴 상세 (잠금 해제된 것 중 미체크)
      const remaining = unlocked
        .filter((i) => !(sess.checks && sess.checks[i]))
        .map((i) => {
          const r = constants.routine[i] || {};
          return {
            index: i + 1,
            time: r.t,
            title: r.title,
            icon: r.icon,
            action: r.action,
            points: r.pts,
            critical: !!r.crit,
            imem: r.imem,
          };
        });
      const completed = unlocked
        .filter((i) => sess.checks && sess.checks[i])
        .map((i) => {
          const r = constants.routine[i] || {};
          return { index: i + 1, title: r.title, time: r.t };
        });
      // Include meal summary in status
      const statusMeals = sess.meals || [];
      const statusKcal = statusMeals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
      return {
        date,
        week,
        unlocked: unlocked.map((i) => i + 1),
        checked,
        completed,
        remaining,
        criticalRemaining: remaining.filter((r) => r.critical).map((r) => r.index),
        // todayWeight: 오늘 daily doc에서 직접 측정한 값 (null = 오늘 미측정)
        // lastRecordedWeight: 표시용 폴백 포함 (이전 날 기록일 수 있음)
        todayWeight: sess.weight ?? null,
        lastRecordedWeight: profile.weight ?? null,
        lastWeightDate: profile.lastWeightDate ?? null,
        mealCount: statusMeals.length,
        totalKcal: statusKcal,
      };
    }

    case 'get_meal_summary': {
      const meals = sess.meals || [];
      if (meals.length === 0) {
        return { ok: true, count: 0, meals: [], note: '오늘 기록된 식사가 없습니다.' };
      }
      const mealList = meals.map((m, i) => ({
        index: i + 1,
        time: m.time || '?',
        menu: m.menu || '식사',
        kcal: Number(m.kcal) || 0,
        mealType: classifyMealType(m.time),
        mealTypeKr: MEAL_TYPE_KR[classifyMealType(m.time)] || '간식',
        betaScore: m.betaScore ?? null,
        macros: m.macros || null,
      }));
      const totalKcal = mealList.reduce((s, m) => s + m.kcal, 0);
      const analysis = analyzeMealDay(meals, profile);
      const result = {
        ok: true,
        date,
        count: mealList.length,
        meals: mealList,
        totalKcal,
      };
      if (analysis) {
        result.dailyTarget = analysis.dailyTarget;
        result.remaining = analysis.remaining;
        result.usedPct = Math.round((totalKcal / analysis.dailyTarget) * 100);
        result.proteinGap = analysis.proteinGap;
        result.proteinTarget = analysis.proteinTarget;
        result.isHighCarb = analysis.isHighCarb;
        result.isLowProtein = analysis.isLowProtein;
        result.hasLateNight = analysis.hasLateNight;
      }
      return result;
    }

    case 'get_weight_history': {
      const days = Math.max(1, Math.min(60, Number(input.days) || 7));
      const series = await getWeightHistory(uid, days);
      if (series.length === 0) {
        return { ok: true, days, count: 0, series: [], note: '기록된 체중이 없습니다.' };
      }
      const first = series[0].weight;
      const last = series[series.length - 1].weight;
      const delta = Number((last - first).toFixed(2));
      const trend = delta < -0.1 ? 'down' : delta > 0.1 ? 'up' : 'flat';
      return { ok: true, days, count: series.length, series, first, last, deltaKg: delta, trend };
    }

    case 'log_meal': {
      const kcal = Number(input.kcal);
      if (!Number.isFinite(kcal) || kcal <= 0 || kcal > 5000) {
        return { ok: false, error: 'kcal은 1-5000 범위' };
      }
      const now = new Date();
      const time = input.time || new Intl.DateTimeFormat('ko-KR', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
      }).format(now);
      const meal = {
        menu: String(input.menu || '식사'),
        kcal,
        kcalLow: Number(input.kcalLow) || null,
        kcalHigh: Number(input.kcalHigh) || null,
        macros: {
          protein: Number(input.protein) || null,
          fat: Number(input.fat) || null,
          carbs: Number(input.carbs) || null,
        },
        hasVeg: !!input.hasVeg,
        hasProtein: !!input.hasProtein,
        betaScore: Number(input.betaScore) || 0,
        ts: now,
        time,
        source: 'chat',
      };
      // ── ① 핵심 경로: 식사 저장 (실패 시 전체 실패) ──
      let r;
      try {
        r = await withRetry(() => appendMeal(uid, date, meal), 'appendMeal');
      } catch (e) {
        console.error('log_meal appendMeal failed after retries:', e.message || e);
        return { ok: false, error: '식사 저장이 실패했어요. 잠시 후 다시 말씀해 주세요.' };
      }

      // ── ② 부가 작업: 식후 걷기 알림 예약 (실패해도 성공 유지) ──
      try { schedulePostMealWalk(uid, chatId, date, r.mealType); }
      catch (e) { console.warn('schedulePostMealWalk failed (non-fatal):', e.message); }

      // ── ③ 부가 작업: 루틴 자동 매핑 (실패해도 성공 유지) ──
      const marked = [];
      const autoUpdates = {};
      if (meal.hasVeg && meal.hasProtein && unlocked.includes(3)) autoUpdates[3] = true;
      if ((meal.betaScore || 0) >= 0.7 && unlocked.includes(4)) autoUpdates[4] = true;
      if (Object.keys(autoUpdates).length > 0) {
        const autoRes = await tryWrite(() => setRoutineChecks(uid, date, autoUpdates), 'log_meal.autoMapping');
        if (autoRes.ok) Object.keys(autoUpdates).forEach((i) => marked.push(Number(i) + 1));
      }

      // ── ④ 피드백 생성 (실패해도 성공 유지) ──
      let _feedback = '';
      try { _feedback = buildMealFeedback(meal, r.meals || [], sess.profile || profile); }
      catch (e) { console.warn('buildMealFeedback failed (non-fatal):', e.message); }

      return { ok: true, dailyKcal: r.dailyKcal, mealCount: r.mealCount, markedRoutines: marked, mealType: r.mealType, feedback: _feedback, date };
    }

    case 'get_score': {
      const checks = checksObjToArray(sess.checks);
      const riskActive = riskObjToArray(sess.riskActive);
      const recoveryDone = riskObjToArray(sess.recoveryDone);
      const lat = profile.lat || 37.5665;
      const sun = calculateSunTimes(lat);
      const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset, meals: sess.meals || [] });
      const score = calculateScore({ checks, riskActive, recoveryDone, week });
      const eff = totalEfficiency(imem);
      return {
        score,
        efficiency: Number(eff.toFixed(2)),
        alpha: Number(imem.alpha_net.toFixed(2)),
        beta: Number(imem.beta_net.toFixed(2)),
        gamma: Number(imem.gamma_net.toFixed(2)),
        betaMeal: Number((imem.beta_meal || 1).toFixed(3)),
      };
    }

    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

// ─────────────────────────────────────────────
// Main chat handler
// ─────────────────────────────────────────────

async function chatHandler(ctx) {
  const text = ctx.message?.text;
  if (!text || text.startsWith('/')) return;

  let session;
  try {
    const resolved = await resolveUser(ctx);
    // Intercept: 자연어 "페르소나 변경/선택/바꿔"
    if (/페르소나\s*(변경|선택|바꿔|바꾸기|설정)/.test(text)) {
      return showPersonaMenu(ctx);
    }
    // Intercept: pending kcal edit?
    const hit = tryConsumeKcalEdit(resolved.uid, text);
    // ── Local router: handle simple queries without AI ──
    if (!hit) {
      try {
        const localReply = await tryLocalRoute(text, ctx);
        if (localReply) {
          await appendMessage(resolved.uid, 'user', text).catch(() => {});
          await appendMessage(resolved.uid, 'assistant', localReply).catch(() => {});
          return ctx.reply(localReply);
        }
      } catch (e) {
        console.warn('localRouter error (falling through to AI):', e.message);
        // Fall through to AI on any error — never break the user experience
      }
    }
    if (hit) {
      // ① 핵심: 식사 저장
      let r;
      try {
        r = await withRetry(() => appendMeal(hit.entry.uid, hit.entry.date, hit.entry.meal), 'appendMeal(kcalEdit)');
      } catch (e) {
        console.error('kcal edit save failed after retries:', e.message || e);
        return ctx.reply('저장 중 오류가 났어요. 잠시 후 다시 시도해 주세요.');
      }
      // ② 부가 작업 (실패해도 성공 유지)
      try { schedulePostMealWalk(hit.entry.uid, ctx.chat.id, hit.entry.date, r.mealType); } catch (_) {}
      const marked = await applyAutoMapping(hit.entry.uid, hit.entry.date, hit.entry.meal, { uid: hit.entry.uid, unlocked: hit.entry.unlocked });
      pendingMeals.delete(hit.msgId);
      const markedTxt = marked.length > 0 ? `\n자동 체크: 루틴 ${marked.join(', ')}` : '';
      return ctx.reply(`✅ ${hit.entry.meal.kcal} kcal로 기록 — 오늘 누적 ${r.dailyKcal} kcal (${r.mealCount}끼)${markedTxt}`);
    }
    const _tz = (resolved.profile && resolved.profile.timezone) || 'Asia/Seoul';
    const date = toLogicalDate(new Date(), _tz);
    const daily = await getDailyRoutine(resolved.uid, date);
    const settings = await getBotSettings(resolved.uid);

    session = {
      ...resolved,
      chatId: ctx.chat.id,
      date,                          // ★ 세션 초기화 시점 날짜 고정 (runTool과 일관성)
      checks: daily.checks,
      riskActive: daily.riskActive,
      recoveryDone: daily.recoveryDone,
      weight: daily.weight,                            // 오늘 daily doc의 체중 (미측정 시 null)
      profileWeight: resolved.profile.weight,          // 마지막 기록 체중 (이전 날일 수 있음)
      lastWeightDate: resolved.profile.lastWeightDate || null, // 마지막 체중 기록 날짜
      meals: daily.meals || [],
      persona: settings.persona || 'empathetic',
    };
  } catch (e) {
    console.error('chat resolve error:', e);
    return ctx.reply('잠시 문제가 있었어요. 다시 한 번 말씀해 주세요.');
  }

  // Load history (already chronological)
  let history = [];
  try {
    history = await getRecentMessages(session.uid, MAX_TURNS * 2);
  } catch (e) {
    console.warn('history load failed:', e.message);
  }

  // Filter to plain text turns (skip any with non-string content from earlier schemas)
  history = history.filter((m) => typeof m.content === 'string');

  // ── 날짜 경계 마커 주입 ──
  // 어제 대화와 오늘 대화가 섞이면 Claude가 날짜를 오인함.
  // 날짜가 바뀌는 첫 user 메시지 앞에 "[날짜: YYYY-MM-DD]" 접두어를 붙여 구분.
  {
    const todayDate = session.date;
    let prevDate = null;
    history = history.map((m) => {
      const msgDate = m.date || null;
      let content = m.content;
      if (msgDate && msgDate !== prevDate) {
        if (prevDate !== null && m.role === 'user') {
          // 날짜가 바뀐 첫 user 메시지에 날짜 레이블 추가
          const label = msgDate === todayDate ? `오늘(${msgDate})` : msgDate;
          content = `[${label}] ${content}`;
        }
        prevDate = msgDate;
      } else if (!prevDate && msgDate) {
        prevDate = msgDate;
      }
      return { role: m.role, content };
    });
  }

  // Append new user message
  const userTurn = { role: 'user', content: text };
  await appendMessage(session.uid, 'user', text).catch(() => {});

  const messages = [...history, userTurn];
  const sys = systemPrompt(session.persona, session);
  const client = getClient();

  // Show typing
  ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});

  let finalText = '';
  try {
    let loop = 0;
    let resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sys,
      tools: TOOLS,
      messages,
    });
    logCacheUsage(resp.usage, 'chat:first');

    while (resp.stop_reason === 'tool_use' && loop < MAX_TOOL_LOOPS) {
      loop += 1;
      const toolUses = resp.content.filter((b) => b.type === 'tool_use');
      const toolResults = [];
      for (const tu of toolUses) {
        // 외곽 안전망: 도구 내부에서 이미 try/catch 하지만, 예상치 못한 throw도 절대 위로 안 보냄
        let result;
        try {
          result = await runTool(tu.name, tu.input || {}, session);
        } catch (e) {
          console.error(`runTool(${tu.name}) threw unexpectedly:`, e.message || e);
          result = { ok: false, error: '도구 실행 중 오류가 났어요. 다시 시도해 주세요.' };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: toolResults });

      ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
      resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: sys,
        tools: TOOLS,
        messages,
      });
      logCacheUsage(resp.usage, `chat:tool-loop-${loop}`);
    }

    finalText = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (e) {
    const classified = classifyApiError(e);
    console.error(`Claude API [${classified.logTag}]:`, e?.status || '', e?.message || e);
    // ── Phase 2: Fallback to Haiku if retryable ──
    if (classified.retryable && FALLBACK_MODEL !== MODEL) {
      try {
        console.log(`Fallback: retrying with ${FALLBACK_MODEL}...`);
        const fallbackResp = await client.messages.create({
          model: FALLBACK_MODEL,
          max_tokens: 1024,
          system: sys,
          messages: [...history, userTurn],
        });
        logCacheUsage(fallbackResp.usage, 'fallback');
        const fbText = fallbackResp.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (fbText) {
          console.log('Fallback succeeded (Haiku)');
          await appendMessage(session.uid, 'assistant', fbText).catch(() => {});
          return ctx.reply(fbText);
        }
      } catch (e2) {
        console.error('Fallback also failed:', e2?.status || '', e2?.message || e2);
      }
    }
    // ── Phase 2: Last resort — basic response ──
    return ctx.reply(classified.retryable ? BASIC_FALLBACK_MSG : classified.userMsg);
  }

  if (!finalText) finalText = '...';

  await appendMessage(session.uid, 'assistant', finalText).catch(() => {});
  return ctx.reply(finalText);
}

// ─────────────────────────────────────────────
// /persona command
// ─────────────────────────────────────────────

const { setPersona } = require('../store');

const PERSONA_LABELS = {
  empathetic: '🤗 따뜻한 대사 코치',
  clinical:   '🔬 GLP-1 전문 임상의',
  driver:     '🔥 강인한 트레이너',
};
const PERSONA_DESC = {
  empathetic: '감정 공감 + 작은 실천 칭찬, 부드러운 제안',
  clinical:   'IMEM α/β/γ 수치 + GLP-1 기전 근거, 과학적 식단·건기식 추천',
  driver:     '짧고 강한 푸시, 운동·식단 집중, 변명 차단',
};

function personaKeyboard(current) {
  const kb = new InlineKeyboard();
  const mark = (k) => (current === k ? '✅ ' : '');
  kb.text(`${mark('empathetic')}${PERSONA_LABELS.empathetic}`, 'persona:empathetic').row();
  kb.text(`${mark('clinical')}${PERSONA_LABELS.clinical}`, 'persona:clinical').row();
  kb.text(`${mark('driver')}${PERSONA_LABELS.driver}`, 'persona:driver');
  return kb;
}

async function showPersonaMenu(ctx) {
  const { uid } = await resolveUser(ctx);
  const s = await getBotSettings(uid);
  const current = s.persona || 'empathetic';
  const body =
    `*페르소나 선택*\n\n` +
    `현재: ${PERSONA_LABELS[current]}\n\n` +
    `1) ${PERSONA_LABELS.empathetic}\n   ${PERSONA_DESC.empathetic}\n\n` +
    `2) ${PERSONA_LABELS.clinical}\n   ${PERSONA_DESC.clinical}\n\n` +
    `3) ${PERSONA_LABELS.driver}\n   ${PERSONA_DESC.driver}`;
  return ctx.reply(body, { parse_mode: 'Markdown', reply_markup: personaKeyboard(current) });
}

async function personaCommand(ctx) {
  const arg = (ctx.match || '').trim().toLowerCase();
  const valid = ['empathetic', 'clinical', 'driver'];
  if (!arg) return showPersonaMenu(ctx);
  if (!valid.includes(arg)) {
    return ctx.reply(`사용 가능: ${valid.join(' | ')}`);
  }
  const { uid } = await resolveUser(ctx);
  await setPersona(uid, arg);
  return ctx.reply(`페르소나가 *${PERSONA_LABELS[arg]}* 로 바뀌었어요.`, { parse_mode: 'Markdown' });
}

async function personaCallbackHandler(ctx) {
  const data = ctx.callbackQuery?.data || '';
  if (!data.startsWith('persona:')) return;
  const key = data.split(':')[1];
  if (!['empathetic', 'clinical', 'driver'].includes(key)) {
    return ctx.answerCallbackQuery({ text: '알 수 없는 페르소나' });
  }
  try {
    const { uid } = await resolveUser(ctx);
    await setPersona(uid, key);
    await ctx.answerCallbackQuery({ text: `${PERSONA_LABELS[key]} 선택됨` });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: personaKeyboard(key) });
    } catch (_) {}
    await ctx.api.sendMessage(ctx.chat.id, `페르소나가 *${PERSONA_LABELS[key]}* 로 바뀌었어요.`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('persona callback:', e);
    await ctx.answerCallbackQuery({ text: '변경 실패' });
  }
}

// ─────────────────────────────────────────────
// Photo handler — vision MVP (food → kcal + IMEM β one-liner)
// ─────────────────────────────────────────────

const MEAL_SYSTEM = `당신은 IncretinA i의 식사 코치입니다. 사용자가 음식 사진을 보냅니다.
먼저 사람이 읽을 분석을 5줄 이내로 작성하세요(이모지 절제):

1) 메뉴: 보이는 음식 한 줄 요약
2) 추정 칼로리: 약 NNN~NNN kcal (오차 ±20% 명시)
3) 매크로 비율: 단백질/지방/탄수 — 한 줄
4) IMEM β 한 줄 평가: 시퀀스(채소→단백질→탄수)·식이섬유·정제 탄수 관점
5) 코칭 한 마디: 지금 시각/골든타임 맥락에서 다음 행동 한 가지

그 다음 반드시 아래 형식의 JSON 코드블록을 마지막에 추가하세요(추가 설명 없이):
\`\`\`json
{"menu":"string","kcal":int,"kcalLow":int,"kcalHigh":int,"protein":int,"fat":int,"carbs":int,"hasVeg":bool,"hasProtein":bool,"betaScore":0.0}
\`\`\`
betaScore는 0-1 범위로 IMEM β 시퀀스/섬유 품질(채소·단백질 우선, 정제탄수 적음=높음).
추정 불가하면 사람이 읽을 본문에 "사진만으로는 어려워요"라고 답하고, JSON은 생략하세요.`;

// In-memory pending meals: replyMsgId → { uid, chatId, date, meal, ts, awaitingKcal? }
const pendingMeals = new Map();
const PENDING_TTL_MS = 60 * 1000;
function gcPending() {
  const now = Date.now();
  for (const [k, v] of pendingMeals) if (now - v.ts > PENDING_TTL_MS) pendingMeals.delete(k);
}

function parseMealJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch (_) { return null; }
}
function stripMealJson(text) {
  return text.replace(/```json[\s\S]*?```/i, '').trim();
}

// 자동 루틴 매핑 — never throws. 실패 시 빈 배열 반환.
async function applyAutoMapping(uid, date, meal, sess) {
  const updates = {};
  // routine 4 (idx 3): 채소+단백질 우선 시퀀스 (β 좋음)
  if (meal.hasVeg && meal.hasProtein && (sess.unlocked || []).includes(3)) updates[3] = true;
  // routine 5 (idx 4): β 시퀀스 우수 식사
  if ((meal.betaScore || 0) >= 0.7 && (sess.unlocked || []).includes(4)) updates[4] = true;
  if (Object.keys(updates).length === 0) return [];
  const res = await tryWrite(() => setRoutineChecks(uid, date, updates), 'applyAutoMapping');
  if (!res.ok) return [];
  return Object.keys(updates).map((i) => Number(i) + 1);
}

async function photoHandler(ctx) {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  // Use the largest size variant (last in the array)
  const largest = photos[photos.length - 1];
  const caption = (ctx.message.caption || '').trim();

  ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});

  let imageB64, mediaType;
  try {
    const file = await ctx.api.getFile(largest.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`telegram file fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    imageB64 = buf.toString('base64');
    // Telegram photos are JPEG; fall back to extension sniff if needed
    const ext = (file.file_path.split('.').pop() || 'jpg').toLowerCase();
    mediaType = ext === 'png' ? 'image/png'
              : ext === 'webp' ? 'image/webp'
              : ext === 'gif'  ? 'image/gif'
              : 'image/jpeg';
  } catch (e) {
    console.error('photo download failed:', e);
    return ctx.reply('사진을 불러오지 못했어요. 잠시 후 다시 보내주세요.');
  }

  // Resolve session for context (current week, golden time hint via clock)
  let contextLine = '';
  try {
    const { profile } = await resolveUser(ctx);
    const now = new Date();
    const userTz = profile.timezone || 'Asia/Seoul';
    const hh = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }).format(now);
    contextLine = `현재 시각: ${hh}. 사용자 이름: ${profile.name || '회원'}님.`;
  } catch (_) { /* non-fatal */ }

  const userPrompt = caption
    ? `${contextLine}\n사용자 코멘트: "${caption}"\n이 사진의 음식을 분석해주세요.`
    : `${contextLine}\n이 사진의 음식 칼로리와 IMEM β 시퀀스 평가를 해주세요.`;

  let finalText = '';
  try {
    const client = getClient();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: MEAL_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
          { type: 'text', text: userPrompt },
        ],
      }],
    });
    finalText = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  } catch (e) {
    const classified = classifyApiError(e);
    console.error(`Claude Vision [${classified.logTag}]:`, e?.status || '', e?.message || e);
    return ctx.reply(classified.retryable ? BASIC_FALLBACK_MSG : classified.userMsg);
  }

  if (!finalText) finalText = '사진을 분석하지 못했어요. 다시 한 번 보내주실래요?';

  // Parse structured JSON for Option B confirmation flow
  const parsed = parseMealJson(finalText);
  const visibleText = stripMealJson(finalText);

  if (!parsed || !Number.isFinite(Number(parsed.kcal))) {
    return ctx.reply(visibleText || finalText);
  }

  // Resolve session for routine context
  let sess;
  try {
    const resolved = await resolveUser(ctx);
    const tz = resolved.profile.timezone || 'Asia/Seoul';
    const date = toLogicalDate(new Date(), tz);
    const daily = await getDailyRoutine(resolved.uid, date);
    sess = { ...resolved, checks: daily.checks, date, tz };
  } catch (e) {
    return ctx.reply(visibleText);
  }

  const meal = {
    menu: parsed.menu || '식사',
    kcal: Number(parsed.kcal),
    kcalLow: Number(parsed.kcalLow) || null,
    kcalHigh: Number(parsed.kcalHigh) || null,
    macros: { protein: parsed.protein, fat: parsed.fat, carbs: parsed.carbs },
    hasVeg: !!parsed.hasVeg,
    hasProtein: !!parsed.hasProtein,
    betaScore: Number(parsed.betaScore) || 0,
    ts: new Date(),
    time: new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: (sess && sess.tz) || 'Asia/Seoul' }).format(new Date()),
  };

  const kb = new InlineKeyboard()
    .text('✅ 기록', 'meal:save')
    .text('✏️ 수정', 'meal:edit')
    .text('❌ 취소', 'meal:cancel');

  const sent = await ctx.reply(
    `${visibleText}\n\n— 약 ${meal.kcal} kcal로 기록할까요?`,
    { reply_markup: kb },
  );

  gcPending();
  pendingMeals.set(sent.message_id, {
    uid: sess.uid,
    chatId: ctx.chat.id,
    date: sess.date,
    unlocked: sess.unlocked,
    profile: sess.profile || {},
    meal,
    ts: Date.now(),
  });
}

// ─────────────────────────────────────────────
// Callback handler for meal confirm/edit/cancel
// ─────────────────────────────────────────────

async function mealCallbackHandler(ctx) {
  const data = ctx.callbackQuery?.data || '';
  if (!data.startsWith('meal:')) return;
  const action = data.split(':')[1];
  const msgId = ctx.callbackQuery.message?.message_id;
  gcPending();
  const entry = pendingMeals.get(msgId);
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '만료되었어요. 다시 사진을 보내주세요.', show_alert: false });
    try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch (_) {}
    return;
  }

  if (action === 'cancel') {
    pendingMeals.delete(msgId);
    await ctx.answerCallbackQuery({ text: '취소했어요' });
    try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch (_) {}
    try { await ctx.api.sendMessage(entry.chatId, '식사 기록을 취소했어요.'); } catch (_) {}
    return;
  }

  if (action === 'edit') {
    entry.awaitingKcal = true;
    entry.ts = Date.now();
    pendingMeals.set(msgId, entry);
    await ctx.answerCallbackQuery({ text: '칼로리 숫자를 보내주세요' });
    try { await ctx.api.sendMessage(entry.chatId, `현재 ${entry.meal.kcal} kcal. 수정할 숫자(kcal)만 보내주세요. 예: 520`); } catch (_) {}
    return;
  }

  if (action === 'save') {
    // ① 핵심: 식사 저장 (실패 시 전체 실패)
    let r;
    try {
      r = await withRetry(() => appendMeal(entry.uid, entry.date, entry.meal), 'appendMeal(photo)');
    } catch (e) {
      console.error('photo meal save failed after retries:', e.message || e);
      await ctx.answerCallbackQuery({ text: '저장 실패' });
      try { await ctx.api.sendMessage(entry.chatId, '저장이 실패했어요. 잠시 후 다시 사진을 보내주세요.'); } catch (_) {}
      return;
    }
    // ② 부가 작업 (실패해도 성공 유지)
    try { schedulePostMealWalk(entry.uid, entry.chatId, entry.date, r.mealType); } catch (_) {}
    const marked = await applyAutoMapping(entry.uid, entry.date, entry.meal, { uid: entry.uid, unlocked: entry.unlocked });
    pendingMeals.delete(msgId);
    await ctx.answerCallbackQuery({ text: '기록 완료' });
    try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch (_) {}
    const markedTxt = marked.length > 0 ? `\n자동 체크: 루틴 ${marked.join(', ')}` : '';
    let _photoFeedback = '';
    try { _photoFeedback = buildMealFeedback(entry.meal, r.meals || [], entry.profile || {}); } catch (_) {}
    const photoFeedbackTxt = _photoFeedback ? '\n\n' + _photoFeedback : '';
    try {
      await ctx.api.sendMessage(
        entry.chatId,
        `✅ 기록 완료 — 오늘 누적 ${r.dailyKcal} kcal (${r.mealCount}끼)${markedTxt}${photoFeedbackTxt}`,
      );
    } catch (e) {
      console.warn('confirm message send failed (saved ok):', e.message);
    }
  }
}

// Hook to allow chatHandler to handle "kcal edit reply" intercept
function tryConsumeKcalEdit(uid, text) {
  const num = parseInt((text || '').replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(num) || num <= 0 || num > 5000) return null;
  for (const [msgId, entry] of pendingMeals) {
    if (entry.uid === uid && entry.awaitingKcal) {
      entry.meal.kcal = num;
      return { msgId, entry };
    }
  }
  return null;
}

module.exports = { chatHandler, personaCommand, photoHandler, mealCallbackHandler, personaCallbackHandler, showPersonaMenu, tryConsumeKcalEdit, _pendingMeals: pendingMeals };
