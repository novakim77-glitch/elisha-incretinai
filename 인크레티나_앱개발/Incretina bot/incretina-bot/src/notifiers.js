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
  getRecentDailyRoutines, countHistoryDays, toLogicalDate,
  getBotSettings, getChallengeConfig, getUserChallengeDays,
} = require('./store');
const { paths, makeEvent, SOURCE, EVENT } = schema;

// ─────────────────────────────────────────────
// Persona-aware message formatting
// ─────────────────────────────────────────────

const PERSONA_TONES = {
  empathetic: {
    greeting: (name) => `${name}님, `,
    encourage: '잘하고 있어요! 천천히 하나씩 해봐요 💛',
    warn: (msg) => `조금 주의가 필요해요: ${msg}`,
    close: '오늘도 수고했어요. 편안한 밤 되세요 🌙',
    push: (action) => `가능하면 ${action} 해보는 건 어떨까요?`,
    preCoach: (meal) => `${meal} 전에 준비할 것들이에요. 천천히 따라해 봐요:`,
  },
  clinical: {
    greeting: (name) => `${name}님 — `,
    encourage: '수치가 양호합니다. 현재 프로토콜 유지.',
    warn: (msg) => `⚠️ 임상 소견: ${msg}`,
    close: '22시 이후 블루라이트 차단 권장. 수면 위생 유지.',
    push: (action) => `${action} — 근거: GLP-1 분비 최적화 프로토콜`,
    preCoach: (meal) => `${meal} 프로토콜. 과학적 근거 기반 준비사항:`,
  },
  driver: {
    greeting: (name) => `${name}! `,
    encourage: '좋아, 계속 밀어!',
    warn: (msg) => `⚡ 경고: ${msg}. 지금 바로 교정!`,
    close: '내일도 풀 파워로 간다. 푹 자!',
    push: (action) => `${action} — 지금 당장!`,
    preCoach: (meal) => `${meal} 준비! 지금부터 실행:`,
  },
};

function getTone(persona) {
  return PERSONA_TONES[persona] || PERSONA_TONES.empathetic;
}

async function getUserPersona(uid) {
  const settings = await getBotSettings(uid);
  return settings.persona || 'empathetic';
}

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
    const persona = await getUserPersona(uid);
    const tone = getTone(persona);
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

    const name = profile.name || '';
    const greetings = {
      empathetic: `🌅 *좋은 아침이에요, ${name}님!*`,
      clinical: `🌅 *모닝 브리핑* — ${name}님`,
      driver: `🌅 *${name}! 일어나! 오늘도 시작이다!*`,
    };

    const text = [
      greetings[persona] || greetings.empathetic,
      ``,
      `오늘은 ${week}주차 · 해제된 루틴 ${unlocked.length}개`,
      `🕐 골든타임: *${String(sun.sunrise.h).padStart(2,'0')}:${String(sun.sunrise.m).padStart(2,'0')}* ~ *${String(sun.sunset.h).padStart(2,'0')}:${String(sun.sunset.m).padStart(2,'0')}*`,
      ``,
      firstRoutine
        ? `첫 루틴: ${firstRoutine.icon} *${firstRoutine.title}* (${firstRoutine.t})\n_${firstRoutine.action}_`
        : tone.encourage,
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
    const persona = await getUserPersona(uid);
    const msgs = {
      empathetic: [
        `⏰ *Metabolic Switch 콜*`,
        ``,
        `19시 저녁 마감까지 *30분* 남았어요.`,
        `지금 마지막 식사를 준비하시면 내일 아침 14시간 공복을 지킬 수 있습니다.`,
        ``,
        `_"α 계수는 타이밍에서 나옵니다."_`,
      ],
      clinical: [
        `⏰ *Metabolic Switch — 라스트콜*`,
        ``,
        `19:00 마감 30분 전. 14h 공복 확보 → 아침 인슐린 감수성 최적화.`,
        `α 보전을 위해 지금 식사를 마무리하세요.`,
      ],
      driver: [
        `⏰ *30분 남았다! 지금 먹어!*`,
        ``,
        `19시 넘기면 α 계수 깎인다.`,
        `지금 당장 마지막 식사 완료!`,
      ],
    };

    const text = (msgs[persona] || msgs.empathetic).join('\n');
    const ok = await safeSend(bot, chatId, text);
    if (ok) await logNotification(uid, 'metabolic_switch_lastcall');
  }
}

// ─────────────────────────────────────────────
// Trend analysis helpers (Phase 2)
// ─────────────────────────────────────────────

/**
 * Detect 3+ consecutive days of weight increase.
 * Returns { alert: bool, days: number, delta: number } or null.
 */
function analyzeWeightTrend(history) {
  // history: [{ date, weight }, ...] oldest first
  const withWeight = history.filter((d) => d.weight != null && d.weight > 0);
  if (withWeight.length < 3) return null;

  let streak = 0;
  for (let i = withWeight.length - 1; i > 0; i--) {
    if (withWeight[i].weight > withWeight[i - 1].weight) {
      streak++;
    } else {
      break;
    }
  }
  if (streak < 2) return null; // need 3 data points = 2 increases
  const first = withWeight[withWeight.length - streak - 1].weight;
  const last = withWeight[withWeight.length - 1].weight;
  return { alert: true, days: streak + 1, delta: +(last - first).toFixed(1) };
}

/**
 * Detect IMEM coefficient drop > 0.1 compared to previous day.
 * Returns { alert: bool, coeff: string, drop: number } or null.
 */
function analyzeIMEMDrop(todayIMEM, history) {
  // Find most recent day with IMEM data (not today)
  const prev = [...history].reverse().find((d) => d.imem && d.imem.alpha_net != null);
  if (!prev || !prev.imem || !todayIMEM) return null;

  const drops = [];
  const coeffs = [
    { key: 'alpha_net', label: 'α' },
    { key: 'beta_net', label: 'β' },
    { key: 'gamma_net', label: 'γ' },
  ];
  for (const c of coeffs) {
    const prevVal = prev.imem[c.key];
    const todayVal = todayIMEM[c.key];
    if (prevVal != null && todayVal != null) {
      const drop = prevVal - todayVal;
      if (drop > 0.1) drops.push({ coeff: c.label, drop: +drop.toFixed(2) });
    }
  }
  return drops.length > 0 ? drops : null;
}

/**
 * Detect same routine missed 3+ consecutive days.
 * Returns [{ routineIdx, title, days }] or empty array.
 */
function analyzeRoutineMissStreak(history, unlocked) {
  if (history.length < 3) return [];

  const streaks = [];
  for (const idx of unlocked) {
    let consecutive = 0;
    // Check from most recent backward
    for (let i = history.length - 1; i >= 0; i--) {
      const checks = history[i].checks || {};
      if (!checks[idx]) {
        consecutive++;
      } else {
        break;
      }
    }
    if (consecutive >= 3) {
      const r = constants.routine[idx];
      if (r) streaks.push({ routineIdx: idx, title: `${r.icon} ${r.title}`, days: consecutive });
    }
  }
  return streaks;
}

// ─────────────────────────────────────────────
// 3. Daily recap (22:00) — with trend analysis
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

    // Persona-aware tone
    const persona = await getUserPersona(uid);
    const tone = getTone(persona);

    // ── Trend analysis (Phase 2) ──
    const recentHistory = await getRecentDailyRoutines(uid, 7);
    const trendLines = [];

    // E: Weight trend
    const weightTrend = analyzeWeightTrend(recentHistory);
    if (weightTrend) {
      trendLines.push(tone.warn(`체중 ${weightTrend.days}일 연속 증가 (+${weightTrend.delta}kg)`));
    }

    // F: IMEM coefficient drop
    const imemDrops = analyzeIMEMDrop(imem, recentHistory);
    if (imemDrops) {
      for (const d of imemDrops) {
        trendLines.push(tone.warn(`${d.coeff} 계수 -${d.drop} 하락 (전일 대비)`));
      }
    }

    // G: Routine miss streak
    const missStreaks = analyzeRoutineMissStreak(recentHistory, unlocked);
    for (const ms of missStreaks.slice(0, 2)) { // max 2 alerts
      trendLines.push(tone.warn(`${ms.title} ${ms.days}일 연속 미완료`));
    }

    const text = [
      `🌙 <b>오늘의 리캡</b> — ${date}`,
      ``,
      `점수: <b>${score}</b> / 100  —  ${interp.score}`,
      `루틴: <b>${doneCount}/${unlocked.length}</b> 완료`,
      ``,
      `🔹 α 일주기 리듬 ${imem.alpha_net.toFixed(2)}`,
      `   ${interp.alpha}`,
      `🔹 β 영양 시퀀스 ${imem.beta_net.toFixed(2)}`,
      `   ${interp.beta}`,
      `🔹 γ 신체 활동 ${imem.gamma_net.toFixed(2)}`,
      `   ${interp.gamma}`,
      ``,
      `📊 ${interp.efficiency}`,
      // Trend alerts
      ...(trendLines.length > 0
        ? ['', `📈 <b>트렌드 분석</b>`, ...trendLines]
        : []),
      ``,
      focus
        ? `🎯 <b>내일 집중</b>: ${focus.icon} ${focus.title}\n<i>${focus.action}</i>`
        : `🎯 내일도 오늘처럼 완벽하게!`,
      ``,
      tone.close,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text, { parse_mode: 'HTML' });
    if (ok) await logNotification(uid, 'daily_recap', {
      score, doneCount,
      trends: {
        weightAlert: !!weightTrend,
        imemDrop: imemDrops ? imemDrops.map((d) => d.coeff) : [],
        missStreaks: missStreaks.map((m) => m.routineIdx),
      },
    });
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

    const persona = await getUserPersona(uid);
    const msgs = {
      empathetic: [
        `☀️ *기상 + 햇빛 노출 타임*`,
        ``,
        `눈을 뜨고 *10분 안에* 자연광을 *10분 이상* 받아주세요.`,
        `→ 코르티솔·세로토닌 리듬 정돈, 멜라토닌 분비 시각 고정`,
        ``,
        `_"γ 감수성은 빛에서 시작됩니다."_`,
      ],
      clinical: [
        `☀️ *광노출 프로토콜*`,
        ``,
        `기상 10분 이내 자연광 10분+. SCN(시교차상핵) 동조화.`,
        `코르티솔 peak → 세로토닌 전환 → 14h 후 멜라토닌 onset.`,
      ],
      driver: [
        `☀️ *일어나서 바로 밖으로!*`,
        ``,
        `10분 햇빛. 이게 하루의 시작이다.`,
        `빛 안 받으면 리듬 무너진다. 지금 나가!`,
      ],
    };

    const text = (msgs[persona] || msgs.empathetic).join('\n');
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

    const persona = await getUserPersona(uid);
    const msgs = {
      empathetic: [
        `🍽 *점심 골든타임 임박*`,
        ``,
        `12:00–13:30 사이에 점심을 드시면 인크레틴 반응이 가장 큽니다.`,
        `오늘의 식사 순서: *🥬 채소 → 🥩 단백질 → 🍚 탄수화물*`,
        ``,
        `식사 직후 *10분 산책* 한 번이면 β 시퀀스 +0.3`,
      ],
      clinical: [
        `🍽 *점심 골든타임 — 11:30~13:30*`,
        ``,
        `GLP-1 분비 피크: 12:00–13:00. 인크레틴 반응 최대화 시간대.`,
        `프로토콜: 식이섬유 → 단백질(20g+) → 탄수화물`,
        `식후 10분 보행 → GLUT4 전위 + 혈당 곡선 완화.`,
      ],
      driver: [
        `🍽 *골든타임이다! 점심 준비!*`,
        ``,
        `채소 먼저, 단백질 다음, 밥은 마지막.`,
        `식사 후 바로 10분 걸어! β +0.3 올린다!`,
      ],
    };

    const text = (msgs[persona] || msgs.empathetic).join('\n');
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

    const persona = await getUserPersona(uid);
    const msgs = {
      empathetic: [
        `🌇 *저녁 골든타임 임박*`,
        ``,
        `18:00–19:00 사이에 저녁을 마치는 것이 이상적입니다.`,
        `늦은 저녁은 인슐린 저항성 ↑, 멜라토닌 ↓.`,
        ``,
        `_지금 식사 준비 → 18시 식사 → 19시 마감 = 14시간 공복 확보_`,
      ],
      clinical: [
        `🌇 *저녁 타임윈도우 — 17:00~19:00*`,
        ``,
        `19시 이전 마감 → 14h 공복 → AMPK 활성화 + 인슐린 감수성 회복.`,
        `19시 이후 식사: α -0.10 페널티 + R-06 리스크 활성화.`,
      ],
      driver: [
        `🌇 *저녁 타임! 지금 준비해!*`,
        ``,
        `19시까지 식사 끝내라. 넘기면 α 깎인다.`,
        `단백질 확보하고 탄수 줄여!`,
      ],
    };

    const text = (msgs[persona] || msgs.empathetic).join('\n');
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
      `식사 기록 → β 보정 → 더 정확한 IMEM 계수!`,
    ].join('\n');

    const ok = await safeSend(bot, chatId, text);
    if (ok) { await logNotification(uid, 'no_meal_nudge'); sent++; }
  }
  console.log(`[notify] no-meal-nudge → ${sent} users`);
}

// ─────────────────────────────────────────────
// 10. Pre-lunch coaching (11:00) — Phase 3
// ─────────────────────────────────────────────

async function sendPreLunchCoaching(bot) {
  const users = await listActiveTelegramUsers();
  let sent = 0;
  console.log(`[notify] pre-lunch coaching → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'preCoaching')) continue;

    const persona = await getUserPersona(uid);
    const tone = getTone(persona);
    const msgs = {
      empathetic: [
        `🍽 *${tone.preCoach('점심')}*`,
        ``,
        `1️⃣ 물 한 잔 (200ml) 마시기`,
        `2️⃣ 단백질 간식 준비 (삶은 달걀, 견과류 등)`,
        `3️⃣ 채소를 먼저 먹을 수 있도록 준비`,
        ``,
        `_30분 뒤 호르몬 프리로드 시간이에요!_`,
      ],
      clinical: [
        `🍽 *프리프란디얼 프로토콜 (Pre-lunch)*`,
        ``,
        `T-60min: 수분 200ml (위 확장 → GLP-1 선제 분비)`,
        `T-30min: 단백질 15g + 식이섬유 5g (프리로드)`,
        `T-0: 식이섬유 → 단백질 → 탄수화물 순서 준수`,
        ``,
        `근거: 프리로드 → 혈당 AUC 30-40% 감소 (Ma et al.)`,
      ],
      driver: [
        `🍽 *점심 준비! 지금부터 시작!*`,
        ``,
        `물 한 잔 마셔. 단백질 간식 준비해.`,
        `30분 뒤에 프리로드 먹어야 한다.`,
        `채소 → 단백질 → 밥. 순서 바꾸지 마!`,
      ],
    };

    const text = (msgs[persona] || msgs.empathetic).join('\n');
    const ok = await safeSend(bot, chatId, text);
    if (ok) { await logNotification(uid, 'pre_lunch_coaching'); sent++; }
  }
  console.log(`[notify] pre-lunch coaching → ${sent} users`);
}

// ─────────────────────────────────────────────
// 11. Pre-dinner coaching (16:30) — Phase 3
// ─────────────────────────────────────────────

async function sendPreDinnerCoaching(bot) {
  const users = await listActiveTelegramUsers();
  let sent = 0;
  console.log(`[notify] pre-dinner coaching → ${users.length} users`);
  for (const { uid, chatId } of users) {
    const profile = (await getProfile(uid)) || {};
    if (!isEnabled(profile, 'preCoaching')) continue;

    const persona = await getUserPersona(uid);
    const tone = getTone(persona);

    // Check today's meal status for personalized advice
    const tz = profile.timezone || 'Asia/Seoul';
    const date = toLogicalDate(new Date(), tz);
    const daily = await getDailyRoutine(uid, date);
    const meals = daily.meals || [];
    const dailyKcal = meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    const remainingHint = dailyKcal > 0
      ? `오늘 누적 ${dailyKcal}kcal. 저녁은 가볍게!`
      : `아직 식사 기록이 없어요. 저녁에 균형 잡힌 식단으로!`;

    const msgs = {
      empathetic: [
        `🌇 *${tone.preCoach('저녁')}*`,
        ``,
        `${remainingHint}`,
        ``,
        `1️⃣ 18시 전에 식사 시작 목표`,
        `2️⃣ 단백질 확보 (손바닥 1개분)`,
        `3️⃣ 19시 이전 마감 → 14시간 공복 확보`,
        ``,
        `_차분하게 준비하면 돼요!_`,
      ],
      clinical: [
        `🌇 *프리프란디얼 프로토콜 (Pre-dinner)*`,
        ``,
        `${remainingHint}`,
        ``,
        `타겟: 18:00 식사 시작 → 19:00 마감`,
        `단백질 20g+ 확보. 정제탄수 최소화.`,
        `19시 이후 식사 → α 페널티 -0.10.`,
      ],
      driver: [
        `🌇 *저녁 준비 시작! 지금!*`,
        ``,
        `${remainingHint}`,
        ``,
        `18시에 먹고 19시에 끝내. 단백질 빼먹지 마.`,
        `야식? 생각도 하지 마!`,
      ],
    };

    const text = (msgs[persona] || msgs.empathetic).join('\n');
    const ok = await safeSend(bot, chatId, text);
    if (ok) { await logNotification(uid, 'pre_dinner_coaching'); sent++; }
  }
  console.log(`[notify] pre-dinner coaching → ${sent} users`);
}

// ─────────────────────────────────────────────
// 챌린지 주간 독려 메시지
// ─────────────────────────────────────────────

/**
 * 각 지표별 꼴찌에 가까울수록 약점 → 개인화 응원 팁 반환
 */
function getEncouragementTip(p) {
  const metrics = [
    {
      rank: p.weightRank,
      tips: [
        '식사 순서를 채소→단백질→탄수 순서로 바꿔보세요. 작은 변화가 큰 차이를 만들어요 🥗',
        '야간 공복 시간을 조금만 더 지켜보세요. 내일 아침이 가벼워질 거예요 🌙',
      ],
    },
    {
      rank: p.imemRank,
      tips: [
        '오늘 식사 후 10분만 걸어보세요. γ(인슐린 감수성)이 쑥 올라간답니다 🚶',
        '텔레그램 봇에 오늘 식사를 짧게라도 남겨보세요! 기록이 IMEM 점수를 만들어요 📝',
      ],
    },
    {
      rank: p.completionRank,
      tips: [
        '완벽하지 않아도 괜찮아요! 하루 루틴 하나씩만 더 체크해보는 건 어떨까요? 🌱',
        '매일 조금씩이 포인트예요. 이번 주 하루만 더 50점을 넘겨봐요 💪',
      ],
    },
  ];
  // 가장 낮은 순위(약점) 기준으로 팁 선택
  const weakest = metrics.sort((a, b) => a.rank - b.rank)[0];
  return weakest.tips[Math.floor(Math.random() * weakest.tips.length)];
}

/**
 * 챌린지 참가자 전원에게 주간 독려 DM 발송
 * @param {Bot} bot   grammY Bot 인스턴스
 * @param {boolean} isManual  관리자 수동 발송 여부 (로그용)
 */
async function sendChallengeEncouragement(bot, isManual = false) {
  const config = await getChallengeConfig();
  if (!config || !config.active) {
    console.log('[challenge] 활성 챌린지 없음 — 발송 건너뜀');
    return;
  }

  const { startDate, endDate } = config;
  const now = new Date();
  const today = toLogicalDate(now, 'Asia/Seoul');

  if (today < startDate || today > endDate) {
    console.log(`[challenge] 챌린지 기간 외 (${startDate}~${endDate})`);
    return;
  }

  // ── 1. 모든 텔레그램 연결 사용자 조회
  const users = await listActiveTelegramUsers();
  if (!users.length) return;

  // ── 2. 각 사용자별 챌린지 기간 통계 계산
  const participants = [];
  for (const { uid, chatId } of users) {
    try {
      const profile = await getProfile(uid);
      if (!profile) continue;
      const startWeight = parseFloat(profile.sw) || 0;
      if (!startWeight) continue; // 시작 체중 없으면 집계 불가

      const days = await getUserChallengeDays(uid, startDate, today);
      let latestWeight = startWeight;
      let totalScore = 0;
      let scoreDays = 0;
      let completionDays = 0;

      days.forEach((day) => {
        const w = parseFloat(day.weight);
        if (w > 0) latestWeight = w;
        if (typeof day.score === 'number') {
          totalScore += day.score;
          scoreDays++;
          if (day.score >= 50) completionDays++;
        }
      });

      participants.push({
        uid,
        chatId,
        name: profile.name || '참가자',
        startWeight,
        latestWeight,
        weightChangePct: ((startWeight - latestWeight) / startWeight) * 100,
        imemAvg: scoreDays > 0 ? totalScore / scoreDays : 0,
        completionDays,
        recordedDays: days.length,
      });
    } catch (e) {
      console.error(`[challenge] 사용자 ${uid} 데이터 로드 실패:`, e);
    }
  }

  if (!participants.length) {
    console.log('[challenge] 집계 가능한 참가자 없음');
    return;
  }

  // ── 3. 3개 지표 순위 점수화 (1위 = N점, 꼴찌 = 1점)
  const n = participants.length;
  const rankBy = (key) => {
    const sorted = [...participants].sort((a, b) => b[key] - a[key]);
    sorted.forEach((p, i) => { p[`${key}Rank`] = n - i; });
  };
  rankBy('weightChangePct');
  rankBy('imemAvg');
  rankBy('completionDays');

  // CCS = 체중변화율×0.4 + IMEM평균×0.35 + 완수일×0.25
  participants.forEach((p) => {
    p.weightRank      = p.weightChangePctRank;
    p.imemRank        = p.imemAvgRank;
    p.completionRank  = p.completionDaysRank;
    p.ccs = p.weightRank * 0.40 + p.imemRank * 0.35 + p.completionRank * 0.25;
  });

  const ranked = [...participants].sort((a, b) => b.ccs - a.ccs);
  ranked.forEach((p, i) => { p.overallRank = i + 1; });

  // 챌린지 몇 주차인지 계산
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.min(Math.floor((now - new Date(startDate)) / msPerWeek) + 1, 8);
  const rankLabel = (r) => r === 1 ? '🥇 1위' : r === 2 ? '🥈 2위' : r === 3 ? '🥉 3위' : `${r}위`;

  // ── 4. 개인 DM 발송
  let sent = 0;
  for (const p of participants) {
    try {
      const tip = getEncouragementTip(p);
      const pctSign = p.weightChangePct >= 0 ? '-' : '+';
      const pctAbs = Math.abs(p.weightChangePct).toFixed(1);

      const text = [
        `🌟 ${p.name}님, 챌린지 ${weekNum}주차 현황이에요!\n`,
        `현재 <b>${rankLabel(p.overallRank)}</b> / 총 ${n}명 중\n`,
        `📊 나의 누적 성과`,
        `├ 체중 변화율: ${pctSign}${pctAbs}% (${p.weightRank}위)`,
        `├ IMEM 평균: ${p.imemAvg.toFixed(0)}점 (${p.imemRank}위)`,
        `└ 루틴 완수일: ${p.completionDays}일 (${p.completionRank}위)\n`,
        `💡 <i>${tip}</i>\n`,
        `이번 주도 함께해줘서 고마워요!`,
        `작은 실천이 쌓여 큰 변화가 됩니다 ✨`,
      ].join('\n');

      const ok = await safeSend(bot, p.chatId, text, { parse_mode: 'HTML' });
      if (ok) {
        await logNotification(p.uid, 'challenge_encouragement', {
          weekNum, rank: p.overallRank, total: n, isManual,
        });
        sent++;
      }
      // 텔레그램 rate limit 방지
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      console.error(`[challenge] DM 실패 (uid=${p.uid}):`, e);
    }
  }

  console.log(`[challenge] 독려 메시지 발송 완료 → ${sent}/${n}명 (${weekNum}주차, manual=${isManual})`);
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
  sendPreLunchCoaching,
  sendPreDinnerCoaching,
  sendChallengeEncouragement,
};
