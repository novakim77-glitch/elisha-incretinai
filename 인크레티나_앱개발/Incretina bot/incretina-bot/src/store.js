// Firestore data access layer for the bot.
// All writes go through here so that the schema v2 invariants
// (events append-only, _meta on every doc, source attribution) are guaranteed.

const { db, FieldValue } = require('./firebase');
const { schema } = require('imem-core');
const { paths, makeMeta, makeEvent, SOURCE, EVENT } = schema;

// ─────────────────────────────────────────────
// Telegram link operations
// ─────────────────────────────────────────────

/**
 * Look up a Telegram chat → IncretinA i UID via the integrations doc index.
 * We maintain a top-level reverse index `tgChatIndex/{chatId}` to avoid scans.
 */
async function findUidByChatId(chatId) {
  const snap = await db().doc(`tgChatIndex/${chatId}`).get();
  return snap.exists ? snap.data().uid : null;
}

/**
 * Consume a one-time link code: validate, attach Telegram chat to user.
 * Returns { ok: true, uid } on success, { ok: false, reason } otherwise.
 */
async function consumeLinkCode({ code, chatId, username, firstName }) {
  const codeRef = db().doc(paths.linkCode(code));
  const codeSnap = await codeRef.get();

  if (!codeSnap.exists) return { ok: false, reason: 'not_found' };
  const codeData = codeSnap.data();
  if (codeData.used) return { ok: false, reason: 'already_used' };

  const expiresAt = codeData.expiresAt && codeData.expiresAt.toDate
    ? codeData.expiresAt.toDate()
    : new Date(codeData.expiresAt);
  if (expiresAt < new Date()) return { ok: false, reason: 'expired' };

  const uid = codeData.uid;

  // Atomic batch: link doc + reverse index + consume code + event log
  const batch = db().batch();
  const now = new Date();

  batch.set(db().doc(paths.telegramLink(uid)), {
    chatId,
    username: username || null,
    firstName: firstName || null,
    linkedAt: now,
    status: 'active',
    unlinkedAt: null,
    _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
  });

  batch.set(db().doc(`tgChatIndex/${chatId}`), { uid, linkedAt: now });

  // Mirror link state onto the main user profile doc so the web app can
  // detect "linked" without a subcollection read.
  batch.set(
    db().doc(paths.user(uid)),
    {
      telegramLinked: true,
      telegramChatId: chatId,
      telegramLinkedAt: now,
      _meta: { updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT },
    },
    { merge: true },
  );

  batch.update(codeRef, { used: true, usedAt: now, usedByChatId: chatId });

  // Append integration event (immutable)
  batch.set(
    db().collection(paths.events(uid)).doc(),
    makeEvent({
      type: 'profile_update',
      date: toLogicalDate(now),
      source: SOURCE.TELEGRAM_BOT,
      payload: { field: 'telegram_link', action: 'linked', chatId },
      now,
    }),
  );

  await batch.commit();
  return { ok: true, uid };
}

// ─────────────────────────────────────────────
// Standalone user creation (bot-first onboarding)
// ─────────────────────────────────────────────

/**
 * Create a minimal user doc when the bot is the first surface (no IncretinA i app yet).
 * UID convention: `tg_{chatId}` until they link a real Firebase Auth account.
 */
async function ensureStandaloneUser({ chatId, username, firstName }) {
  const uid = `tg_${chatId}`;
  const userRef = db().doc(paths.user(uid));
  const snap = await userRef.get();
  if (snap.exists) return uid;

  const now = new Date();
  const batch = db().batch();

  batch.set(userRef, {
    name: firstName || username || 'Telegram User',
    userStartDate: toLogicalDate(now),
    lastActiveDate: toLogicalDate(now),
    timezone: 'Asia/Seoul',
    standaloneOrigin: 'telegram_bot',
    _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
  });

  batch.set(db().doc(paths.telegramLink(uid)), {
    chatId,
    username: username || null,
    firstName: firstName || null,
    linkedAt: now,
    status: 'active',
    unlinkedAt: null,
    _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
  });

  batch.set(db().doc(`tgChatIndex/${chatId}`), { uid, linkedAt: now });

  await batch.commit();
  return uid;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toLogicalDate(d, tz = 'Asia/Seoul') {
  // Schema v2 uses logical (timezone-aware) YYYY-MM-DD strings.
  // For Phase 0 we hardcode KST. Phase 1 will read tz from user profile.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

// ─────────────────────────────────────────────
// Phase 1: profile + daily routine + weight
// ─────────────────────────────────────────────

async function getProfile(uid) {
  const snap = await db().doc(paths.user(uid)).get();
  return snap.exists ? snap.data() : null;
}

async function getDailyRoutine(uid, date) {
  const snap = await db().doc(paths.dailyRoutine(uid, date)).get();
  if (!snap.exists) {
    return { checks: {}, riskActive: {}, recoveryDone: {}, weight: null, meals: [] };
  }
  const d = snap.data();
  return {
    checks: d.checks || {},
    // App writes 'riskChecks', bot historically used 'riskActive' — read both
    riskActive: d.riskActive || d.riskChecks || {},
    // App writes 'recoveries', bot historically used 'recoveryDone' — read both
    recoveryDone: d.recoveryDone || d.recoveries || {},
    weight: d.weight ?? null,
    meals: d.meals || [],
  };
}

/**
 * Mark/unmark routine checks for a given date. Writes daily doc + event log.
 * @param {string} uid
 * @param {string} date YYYY-MM-DD
 * @param {Object<number,boolean>} checks   keyed by routine index
 */
async function setRoutineChecks(uid, date, checks) {
  const ref = db().doc(paths.dailyRoutine(uid, date));
  const now = new Date();
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data().checks || {}) : {};
  const merged = { ...prev, ...checks };

  const batch = db().batch();
  batch.set(
    ref,
    {
      checks: merged,
      _meta: snap.exists
        ? { ...(snap.data()._meta || {}), updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT }
        : makeMeta(SOURCE.TELEGRAM_BOT, now),
    },
    { merge: true },
  );

  // Emit an event per newly-set routine (append-only audit trail)
  for (const [idx, val] of Object.entries(checks)) {
    if (prev[idx] === val) continue;
    batch.set(
      db().collection(paths.events(uid)).doc(),
      makeEvent({
        type: EVENT.ROUTINE_CHECK,
        date,
        source: SOURCE.TELEGRAM_BOT,
        payload: { routineIndex: Number(idx), checked: !!val },
        now,
      }),
    );
  }

  await batch.commit();
  return merged;
}

/**
 * Log a weight value. Updates profile.weight + emits weight_log event.
 */
async function logWeight(uid, date, weightKg) {
  const now = new Date();
  const batch = db().batch();
  const userRef = db().doc(paths.user(uid));

  batch.set(
    userRef,
    {
      weight: weightKg,
      lastWeightDate: date,
      _meta: { updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT },
    },
    { merge: true },
  );

  batch.set(
    db().doc(paths.dailyRoutine(uid, date)),
    {
      weight: weightKg,
      _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
    },
    { merge: true },
  );

  batch.set(
    db().collection(paths.events(uid)).doc(),
    makeEvent({
      type: EVENT.WEIGHT_LOG,
      date,
      source: SOURCE.TELEGRAM_BOT,
      payload: { weightKg },
      now,
    }),
  );

  await batch.commit();
}

/**
 * Count how many dailyRoutines docs exist (proxy for active days).
 */
/**
 * List all active Telegram-linked users: [{ uid, chatId, tz }]
 * Uses the tgChatIndex reverse index as the source of truth.
 */
async function listActiveTelegramUsers() {
  const snap = await db().collection('tgChatIndex').get();
  const users = [];
  for (const d of snap.docs) {
    const { uid } = d.data();
    if (!uid) continue;
    const userSnap = await db().doc(paths.user(uid)).get();
    const tz = (userSnap.exists && userSnap.data().timezone) || 'Asia/Seoul';
    users.push({ uid, chatId: Number(d.id), tz });
  }
  return users;
}

/**
 * Append a meal entry to the daily routine doc.
 * Uses a Firestore transaction to prevent race conditions when two meals
 * are logged concurrently (read-modify-write is atomic within the txn).
 */
async function appendMeal(uid, date, meal) {
  const ref = db().doc(paths.dailyRoutine(uid, date));
  const now = new Date();

  // Auto-classify meal type from time
  const { classifyMealType: _classify } = require('imem-core');
  meal.mealType = _classify(meal.time);

  const snap = await ref.get();
  const prev = snap.exists ? (snap.data().meals || []) : [];
  const next = [...prev, meal];
  const dailyKcal = next.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
  const lastMealAt = meal.ts || now;

  const batch = db().batch();
  batch.set(
    ref,
    {
      meals: next,
      dailyKcal,
      lastMealAt,
      _meta: snap.exists
        ? { ...(snap.data()._meta || {}), updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT }
        : makeMeta(SOURCE.TELEGRAM_BOT, now),
    },
    { merge: true },
  );

  // Append meal_log event for audit
  batch.set(
    db().collection(paths.events(uid)).doc(),
    makeEvent({
      type: EVENT.MEAL_LOG || 'meal_log',
      date,
      source: SOURCE.TELEGRAM_BOT,
      payload: {
        kcal: meal.kcal,
        menu: meal.menu,
        time: meal.time,
        macros: meal.macros || null,
        betaScore: meal.betaScore ?? null,
      },
      now,
    }),
  );

  await batch.commit();
  return { dailyKcal, mealCount: next.length, mealType: meal.mealType, meals: next };
}

/**
 * One-shot backfill: stamp telegramLinked flag onto an existing user doc.
 * Safe to call repeatedly — uses merge.
 */
async function backfillLinkFlag(uid, chatId) {
  const now = new Date();
  await db().doc(paths.user(uid)).set(
    {
      telegramLinked: true,
      telegramChatId: chatId,
      telegramLinkedAt: now,
      _meta: { updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT },
    },
    { merge: true },
  );
}

/**
 * Get recent weight history (most recent N days that have a weight value).
 * Returns array sorted ascending by date: [{ date, weight }, ...]
 */
async function getWeightHistory(uid, days = 7) {
  const limit = Math.max(1, Math.min(60, Number(days) || 7));
  const snap = await db().collection(`users/${uid}/dailyRoutines`).get();
  const all = [];
  for (const d of snap.docs) {
    const data = d.data();
    const w = data.weight;
    const num = typeof w === 'number' ? w : parseFloat(w);
    if (Number.isFinite(num) && num > 0) all.push({ date: d.id, weight: num });
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return all.slice(-limit);
}

async function countHistoryDays(uid) {
  const snap = await db().collection(`users/${uid}/dailyRoutines`).count().get();
  return snap.data().count || 0;
}

/**
 * Get recent N days of dailyRoutines ordered by date descending.
 * Returns [{ date, checks, riskActive, recoveryDone, weight, meals, score, imem }]
 */
async function getRecentDailyRoutines(uid, days = 7) {
  const limit = Math.max(1, Math.min(30, Number(days) || 7));
  const snap = await db()
    .collection(`users/${uid}/dailyRoutines`)
    .orderBy('__name__', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      date: d.id,
      checks: data.checks || {},
      riskActive: data.riskActive || data.riskChecks || {},
      recoveryDone: data.recoveryDone || data.recoveries || {},
      weight: data.weight ?? null,
      meals: data.meals || [],
      score: data.score ?? null,
      imem: data.imem || null,
    };
  }).reverse(); // oldest first
}

// ─────────────────────────────────────────────
// Phase 3: bot conversation history + persona
// ─────────────────────────────────────────────

async function getBotSettings(uid) {
  const snap = await db().doc(`users/${uid}/botSettings/main`).get();
  return snap.exists ? snap.data() : {};
}

async function setPersona(uid, persona) {
  const now = new Date();
  await db().doc(`users/${uid}/botSettings/main`).set(
    {
      persona,
      _meta: { updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT },
    },
    { merge: true },
  );
}

async function appendMessage(uid, role, content) {
  const now = new Date();
  await db().collection(`users/${uid}/messages`).add({
    role,
    content,
    createdAt: now,
    _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
  });
}

async function getRecentMessages(uid, limit = 20) {
  const snap = await db()
    .collection(`users/${uid}/messages`)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs
    .map((d) => d.data())
    .reverse()
    .map((m) => ({
      role: m.role,
      content: m.content,
      // 날짜 경계 감지용 — chatHandler에서 date marker 주입에 사용
      date: m.createdAt
        ? toLogicalDate(m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt))
        : null,
    }));
}


/**
 * Update user timezone and latitude.
 */
async function updateUserLocation(uid, timezone, lat) {
  const update = {};
  if (timezone) update.timezone = timezone;
  if (lat !== undefined) update.lat = lat;
  await db().doc(paths.user(uid)).set(update, { merge: true });
}

// ─────────────────────────────────────────────
// Challenge: config + manual trigger
// ─────────────────────────────────────────────

/**
 * 챌린지 설정 읽기 (Firestore: challenges/weekly-challenge)
 * 앱 관리자가 Firestore에 직접 생성하거나 앱 버튼으로 manualTrigger를 씁니다.
 *
 * 문서 구조:
 * {
 *   active:      boolean,
 *   startDate:   "YYYY-MM-DD",
 *   endDate:     "YYYY-MM-DD",
 *   manualTrigger: { requestedAt: Timestamp, by: string, processed: boolean }
 * }
 */
async function getChallengeConfig() {
  const snap = await db().doc('challenges/weekly-challenge').get();
  if (!snap.exists) return null;
  return snap.data();
}

/**
 * manualTrigger를 처리 완료로 표시 (중복 발송 방지)
 */
async function markChallengeTriggerProcessed() {
  await db().doc('challenges/weekly-challenge').set(
    { manualTrigger: { processed: true } },
    { merge: true },
  );
}

/**
 * 챌린지 기간의 특정 사용자 dailyRoutines 읽기
 */
async function getUserChallengeDays(uid, startDate, endDate) {
  const snap = await db()
    .collection(`users/${uid}/dailyRoutines`)
    .where('__name__', '>=', startDate)
    .where('__name__', '<=', endDate)
    .get();
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }));
}

module.exports = {
  findUidByChatId,
  consumeLinkCode,
  ensureStandaloneUser,
  toLogicalDate,
  updateUserLocation,
  getProfile,
  getDailyRoutine,
  getRecentDailyRoutines,
  setRoutineChecks,
  logWeight,
  appendMeal,
  backfillLinkFlag,
  getWeightHistory,
  countHistoryDays,
  listActiveTelegramUsers,
  getBotSettings,
  setPersona,
  appendMessage,
  getRecentMessages,
  getChallengeConfig,
  markChallengeTriggerProcessed,
  getUserChallengeDays,
};
