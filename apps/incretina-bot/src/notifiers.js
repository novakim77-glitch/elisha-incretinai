// Notifier functions — called by scheduler.js on cron ticks.
// Each function iterates linked users and sends a push via the bot.
// All sends are also logged as `notification_sent` events (schema v2).

const {
  calculateIMEM, calculateScore, calculateSunTimes, interpretIMEM,
  getUserWeek, getUnlockedRoutineIndices, getMinutesToSunset,
  constants,
} = require('imem-core');
const { schema } = require('imem-core');
const { db } = require('./firebase');
const {
  listActiveTelegramUsers, getProfile, getDailyRoutine,
  countHistoryDays, toLogicalDate,
} = require('./store');
const { paths, makeEvent, SOURCE, EVENT } = schema;

function objToArr(obj, len) {
  const arr = new Array(len).fill(false);
  if (!obj) return arr;
  for (const [k, v] of Object.entries(obj)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < len) arr[i] = !!v;
  }
  return arr;
}

/** Log a notification_sent event for audit trail. */
async function logNotification(uid, kind, payload = {}) {
  const now = new Date();
  await db().collection(paths.events(uid)).add(
    makeEvent({
      type: EVENT.NOTIFICATION_SENT,
      date: toLogicalDate(now),
      source: SOURCE.SYSTEM_SCHEDULER,
      payload: { kind, ...payload },
      now,
    }),
  );
}

/** Safe send — swallows errors per user so one failure doesn't break the loop. */
async function safeSend(bot, chatId, text, opts = {}) {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
    return true;
  } catch (err) {
    console.error(`[notify] send failed chatId=${chatId}:`, err.description || err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// 1. Morning briefing (07:00)
// ─────────────────────────────────────────────
async function sendMorningBriefing(bot) {
  const users = await listActiveTelegramUsers();
  console.log(`[notify] morning briefing → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    const lat = profile.lat || 37.5665;
    const sun = calculateSunTimes(lat);
    const historyDays = await countHistoryDays(uid);
    const week = getUserWeek({
      userStartDate: profile.userStartDate || null,
      historyDays,
      now: new Date(),
    });
    const unlocked = getUnlockedRoutineIndices(week);
    const firstRoutine = constants.routine[unlocked[0]];

    const text = [
      `🌅 *좋은 아침이에요, ${profile.name || ''}님!*`,
      ``,
      `오늘은 ${week}주차 · 해제된 루틴 ${unlocked.length}개`,
      `🕐 골든타임: *${String(sun.sunrise.h).padStart(2,'0')}:${String(sun.sunrise.m).padStart(2,'0')}* ~ *${String(sun.sunset.h).padStart(2,'0')}:${String(sun.sunset.m).padStart(2,'0')}*`,
      ``,
      firstRoutine
        ? `첫 루틴: ${firstRoutine.icon} *${firstRoutine.title}* (${firstRoutine.t})\n_${firstRoutine.action}_`
        : `오늘도 화이팅!`,
      ``,
      `오늘의 루틴 보기: /check`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'morning_briefing', { week });
  }
}

// ─────────────────────────────────────────────
// 2. Metabolic Switch last-call (18:30)
// ─────────────────────────────────────────────
async function sendLastCall(bot) {
  const users = await listActiveTelegramUsers();
  console.log(`[notify] last-call → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const text = [
      `⏰ *Metabolic Switch 콜*`,
      ``,
      `19시 저녁 마감까지 *30분* 남았어요.`,
      `지금 마지막 식사를 준비하시면 내일 아침 14시간 공복을 지킬 수 있습니다.`,
      ``,
      `_"α 계수는 타이밍에서 나옵니다."_`,
      ``,
      `식사 후 40분 내 /check 6 으로 글루코스 클리어런스 체크!`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'metabolic_switch_lastcall');
  }
}

// ─────────────────────────────────────────────
// 3. Daily recap (22:00)
// ─────────────────────────────────────────────
async function sendDailyRecap(bot) {
  const users = await listActiveTelegramUsers();
  console.log(`[notify] daily recap → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    const tz = profile.timezone || 'Asia/Seoul';
    const date = toLogicalDate(new Date(), tz);
    const daily = await getDailyRoutine(uid, date);
    const historyDays = await countHistoryDays(uid);
    const week = getUserWeek({
      userStartDate: profile.userStartDate || null,
      historyDays,
      now: new Date(),
    });
    const unlocked = getUnlockedRoutineIndices(week);

    const checks       = objToArr(daily.checks,       constants.routine.length);
    const riskActive   = objToArr(daily.riskActive,   constants.risks.length);
    const recoveryDone = objToArr(daily.recoveryDone, constants.risks.length);

    const lat = profile.lat || 37.5665;
    const sun = calculateSunTimes(lat);
    const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset });
    const score = calculateScore({ checks, riskActive, recoveryDone, week });
    const doneCount = unlocked.filter((i) => checks[i]).length;

    // Pick tomorrow's focus — first unlocked routine not done today
    const missed = unlocked.find((i) => !checks[i]);
    const focus = missed != null ? constants.routine[missed] : null;

    const interp = interpretIMEM(imem, score);

    const text = [
      `🌙 *오늘의 리캡* — ${date}`,
      ``,
      `점수: *${score}* / 100  —  ${interp.score}`,
      `루틴: *${doneCount}/${unlocked.length}* 완료`,
      ``,
      `🔹 α 일주기 리듬 ${imem.alpha_net.toFixed(2)}`,
      `   ${interp.alpha}`,
      `🔹 β 영양 시퀀스 ${imem.beta_net.toFixed(2)}`,
      `   ${interp.beta}`,
      `🔹 γ 신체 활동 ${imem.gamma_net.toFixed(2)}`,
      `   ${interp.gamma}`,
      ``,
      `📊 ${interp.efficiency}`,
      ``,
      focus
        ? `🎯 *내일 집중*: ${focus.icon} ${focus.title}\n_${focus.action}_`
        : `🎯 내일도 오늘처럼 완벽하게!`,
      ``,
      `편안한 밤 되세요. 22시 이후엔 블루라이트를 피해 주세요 🌙`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'daily_recap', { score, doneCount });
  }
}

// ─────────────────────────────────────────────
// Per-user notification preferences (opt-out)
// Defaults: all anchors ON. User can disable individual kinds via app card.
// ─────────────────────────────────────────────
function isEnabled(profile, key) {
  const prefs = profile.notifyPrefs || {};
  return prefs[key] !== false; // default true
}

// ─────────────────────────────────────────────
// 4. Morning light exposure (06:30) — 햇빛 노출
// ─────────────────────────────────────────────
async function sendMorningLight(bot) {
  const users = await listActiveTelegramUsers();
  console.log(`[notify] morning-light → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'morningLight')) continue;

    const text = [
      `☀️ *기상 + 햇빛 노출 타임*`,
      ``,
      `눈을 뜨고 *10분 안에* 자연광을 *10분 이상* 받아주세요.`,
      `→ 코르티솔·세로토닌 리듬 정돈, 멜라토닌 분비 시각 고정`,
      ``,
      `_"γ 감수성은 빛에서 시작됩니다."_`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'morning_light');
  }
}

// ─────────────────────────────────────────────
// 5. Lunch golden window (11:30) — 점심 골든타임 임박
// ─────────────────────────────────────────────
async function sendLunchGolden(bot) {
  const users = await listActiveTelegramUsers();
  console.log(`[notify] lunch-golden → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'lunchGolden')) continue;

    const text = [
      `🍽 *점심 골든타임 임박*`,
      ``,
      `12:00–13:30 사이에 점심을 드시면 인크레틴 반응이 가장 큽니다.`,
      `오늘의 식사 순서: *🥬 채소 → 🥩 단백질 → 🍚 탄수화물*`,
      ``,
      `식사 직후 *10분 산책* 한 번이면 β 시퀀스 +0.3`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'lunch_golden');
  }
}

// ─────────────────────────────────────────────
// 6. Dinner golden window (17:00) — 저녁 골든타임 임박
// ─────────────────────────────────────────────
async function sendDinnerGolden(bot) {
  const users = await listActiveTelegramUsers();
  console.log(`[notify] dinner-golden → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'dinnerGolden')) continue;

    const text = [
      `🌇 *저녁 골든타임 임박*`,
      ``,
      `18:00–19:00 사이에 저녁을 마치는 것이 이상적입니다.`,
      `늦은 저녁은 인슐린 저항성 ↑, 멜라토닌 ↓.`,
      ``,
      `_지금 식사 준비 → 18시 식사 → 19시 마감 = 14시간 공복 확보_`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'dinner_golden');
  }
}

// ─────────────────────────────────────────────
// 7. Missed critical routine alerts
// ─────────────────────────────────────────────

async function _sendMissedRoutine(bot, routineIdx, message) {
  const users = await listActiveTelegramUsers();
  let sent = 0;
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'missedRoutine')) continue;

    const tz = profile.timezone || 'Asia/Seoul';
    const date = toLogicalDate(new Date(), tz);
    const daily = await getDailyRoutine(uid, date);

    // Skip if already done
    if (daily.checks && daily.checks[routineIdx]) continue;

    // Skip if routine not unlocked for this user's week
    const historyDays = await countHistoryDays(uid);
    const week = getUserWeek({
      userStartDate: profile.userStartDate || null,
      historyDays,
      now: new Date(),
    });
    const unlocked = getUnlockedRoutineIndices(week);
    if (!unlocked.includes(routineIdx)) continue;

    const ok = await safeSend(bot, chatId, message);
    if (ok) { await logNotification(uid, 'missed_routine', { routineIdx }); sent++; }
  }
  return sent;
}

async function sendMissedPreload(bot) {
  const sent = await _sendMissedRoutine(bot, 3, [
    `🔔 *호르몬 프리로드 아직 안 했어요!*`,
    ``,
    `점심 30분 전에 *단백질 15g + 식이섬유 5g* 먼저 드세요.`,
    `GLP-1이 선제 분비되어 혈당 급등을 막아줍니다.`,
    ``,
    `완료하면: /check 4`,
  ].join('\n'));
  console.log(`[notify] missed-preload → ${sent} users`);
}

async function sendMissedSequence(bot) {
  const sent = await _sendMissedRoutine(bot, 4, [
    `🔔 *인크레틴 시퀀스 놓치지 마세요!*`,
    ``,
    `오늘 점심에 *채소 → 단백질 → 탄수화물* 순서 지키셨나요?`,
    `식사 순서만으로 β 계수가 +0.025 올라갑니다.`,
    ``,
    `완료하면: /check 5`,
  ].join('\n'));
  console.log(`[notify] missed-sequence → ${sent} users`);
}

async function sendMissedDinnerClose(bot) {
  const sent = await _sendMissedRoutine(bot, 6, [
    `⚠️ *저녁 마감(19시) 시간이 지났어요*`,
    ``,
    `이미 지났다면 지금이라도 식사를 마무리하세요.`,
    `19시 이후 식사는 α 계수에 *-0.10 페널티*가 적용됩니다.`,
    ``,
    `이미 마감했다면: /check 7`,
  ].join('\n'));
  console.log(`[notify] missed-dinner-close → ${sent} users`);
}

// ─────────────────────────────────────────────
// 8. Late-night meal next-morning follow-up (06:35)
// ─────────────────────────────────────────────

function getYesterdayDate(tz) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return toLogicalDate(yesterday, tz);
}

async function sendLateNightRecovery(bot) {
  const users = await listActiveTelegramUsers();
  let sent = 0;
  console.log(`[notify] late-night-recovery check → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'lateNightRecovery')) continue;

    const tz = profile.timezone || 'Asia/Seoul';
    const yesterday = getYesterdayDate(tz);
    const daily = await getDailyRoutine(uid, yesterday);
    const meals = daily.meals || [];
    const hadLateNight = meals.some(m => m.mealType === 'lateNight');
    if (!hadLateNight) continue;

    const text = [
      `🌅 *어제 야식 회복 코칭*`,
      ``,
      `어제 19시 이후 식사가 있었어요.`,
      `오늘 아침 단식을 *1시간 연장*해서 회복해보세요.`,
      `(예: 보통 07시 → 오늘은 08시에 첫 식사)`,
      ``,
      `물·블랙커피는 자유. 고체 음식만 늦추면 됩니다.`,
      `_"14시간 공복 → AMPK 활성화 → 대사 유연성 회복"_`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) { await logNotification(uid, 'late_night_recovery'); sent++; }
  }
  console.log(`[notify] late-night-recovery → ${sent} users`);
}

// ─────────────────────────────────────────────
// 9. No meal recorded nudge (18:00)
// ─────────────────────────────────────────────

async function sendNoMealNudge(bot) {
  const users = await listActiveTelegramUsers();
  let sent = 0;
  console.log(`[notify] no-meal-nudge check → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'noMealNudge')) continue;

    const tz = profile.timezone || 'Asia/Seoul';
    const date = toLogicalDate(new Date(), tz);
    const daily = await getDailyRoutine(uid, date);
    if ((daily.meals || []).length > 0) continue; // has meals, skip

    const text = [
      `📸 *오늘 식사 기록이 없네요*`,
      ``,
      `음식 사진 한 장 보내주시면 자동으로 칼로리·매크로를 분석해드려요.`,
      `또는 "점심에 비빔밥 먹었어" 처럼 텍스트로도 기록 가능해요.`,
      ``,
      `식사 기록 → β\_meal 보정 → 더 정확한 IMEM 계수!`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) { await logNotification(uid, 'no_meal_nudge'); sent++; }
  }
  console.log(`[notify] no-meal-nudge → ${sent} users`);
}

module.exports = {
  sendMorningBriefing,
  sendLastCall,
  sendDailyRecap,
  sendMorningLight,
  sendLunchGolden,
  sendDinnerGolden,
  sendMissedPreload,
  sendMissedSequence,
  sendMissedDinnerClose,
  sendLateNightRecovery,
  sendNoMealNudge,
};
