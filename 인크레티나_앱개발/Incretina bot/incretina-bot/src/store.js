// Firestore data access layer for the bot.
// All writes go through here so that the schema v2 invariants
// (events append-only, _meta on every doc, source attribution) are guaranteed.

const { db, FieldValue } = require('./firebase');
const { schema } = require('imem-core');
const { withRetry } = require('./writeSafety');
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

  // 이벤트 로그 날짜를 사용자 timezone 기준으로 기록 (기본 Asia/Seoul)
  let linkTz = 'Asia/Seoul';
  try {
    const uSnap = await db().doc(paths.user(uid)).get();
    if (uSnap.exists && uSnap.data().timezone) linkTz = uSnap.data().timezone;
  } catch (_) { /* non-fatal — 기본 tz 사용 */ }

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
      date: toLogicalDate(now, linkTz),
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

// ─────────────────────────────────────────────
// 라이브러리 티저 노출 이력 — users/{uid}.teaserHistory [{k,d}] 최근 14개
// (리캡 "오늘의 한 장" 중복 방지. prevHistory는 getProfile 결과 재사용 — 추가 읽기 없음)
// ─────────────────────────────────────────────
async function saveTeaserShown(uid, key, date, prevHistory = []) {
  const entry = { k: key, d: date };
  const hist = [entry, ...(Array.isArray(prevHistory) ? prevHistory : []).filter((h) => h && h.k !== key)].slice(0, 14);
  await withRetry(() => db().doc(paths.user(uid)).set({ teaserHistory: hist }, { merge: true }), 'saveTeaserShown');
}

// ─────────────────────────────────────────────
// Loop 1 — 콘텐츠 행동 의향 기록 — users/{uid}.contentIntents [{k,s,d}] 최근 20개
// s: 'click'(버튼 진입) | 'yes'(해볼게요) | 'no'(패스)
// ─────────────────────────────────────────────
async function saveContentIntent(uid, key, status) {
  const ref = db().doc(paths.user(uid));
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  const prev = Array.isArray(data.contentIntents) ? data.contentIntents : [];
  // 이미 fetch한 user doc에서 timezone을 읽어 모닝 메아리(Loop2) 날짜 비교와 정합 유지
  const tz = data.timezone || 'Asia/Seoul';
  const entry = { k: key, s: status, d: toLogicalDate(new Date(), tz) };
  await withRetry(() => ref.set({ contentIntents: [entry, ...prev].slice(0, 20) }, { merge: true }), 'saveContentIntent');
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
async function getRecentDailyRoutines(uid, days = 7, tz = 'Asia/Seoul') {
  // orderBy('__name__', 'desc') requires a Firestore collection-group index.
  // Instead, compute date strings explicitly and fetch each doc in parallel.
  const limit = Math.max(1, Math.min(30, Number(days) || 7));
  const dateStrs = [];
  for (let i = 0; i < limit; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateStrs.push(toLogicalDate(d, tz));
  }
  const snaps = await Promise.all(
    dateStrs.map((date) => db().doc(`users/${uid}/dailyRoutines/${date}`).get()),
  );
  // dateStrs is newest-first; filter missing docs then map
  return snaps
    .filter((s) => s.exists)
    .map((s) => {
      const data = s.data();
      return {
        date: s.id,
        checks: data.checks || {},
        riskActive: data.riskActive || data.riskChecks || {},
        recoveryDone: data.recoveryDone || data.recoveries || {},
        weight: data.weight ?? null,
        meals: data.meals || [],
        score: data.score ?? null,
        imem: data.imem || null,
      };
    }); // newest-first (matches original reversed output)
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

async function getRecentMessages(uid, limit = 20, tz = 'Asia/Seoul') {
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
      // 날짜 경계 감지용 — chatHandler에서 date marker 주입에 사용 (사용자 tz 기준)
      date: m.createdAt
        ? toLogicalDate(m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt), tz)
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

// ─────────────────────────────────────────────
// 크루 시스템 (Phase 1) — crews/{crewId} + users/{uid}.crewId·nickname
// 단일 크루 단계: crewId = 'miracle-crew' 고정. 다중 확장 시 인자만 동적.
// ─────────────────────────────────────────────
const CREW_ID = 'miracle-crew';

/** 크루 설정 읽기. 없으면 null. */
async function getCrew(crewId = CREW_ID) {
  const snap = await db().doc(`crews/${crewId}`).get();
  return snap.exists ? { id: crewId, ...snap.data() } : null;
}

/** 크루 설정 저장(merge) — 관리자 셋업용. */
async function saveCrewConfig(crewId, patch) {
  await withRetry(
    () => db().doc(`crews/${crewId}`).set({ ...patch, updatedAt: new Date() }, { merge: true }),
    'saveCrewConfig',
  );
}

/** 크루 멤버 목록 교체. */
async function setCrewMembers(crewId, memberUids) {
  await withRetry(
    () => db().doc(`crews/${crewId}`).set({ memberUids: memberUids || [] }, { merge: true }),
    'setCrewMembers',
  );
}

/** 멤버 개별 가입 (opt-in, arrayUnion). */
async function addCrewMember(crewId, uid) {
  await withRetry(
    () => db().doc(`crews/${crewId}`).set({ memberUids: FieldValue.arrayUnion(uid) }, { merge: true }),
    'addCrewMember',
  );
}

/** 멤버 개별 탈퇴 (arrayRemove). */
async function removeCrewMember(crewId, uid) {
  await withRetry(
    () => db().doc(`crews/${crewId}`).set({ memberUids: FieldValue.arrayRemove(uid) }, { merge: true }),
    'removeCrewMember',
  );
}

/** 사용자 프로필에 소속 크루 미러 (다중 크루 대비). */
async function setUserCrew(uid, crewId) {
  await withRetry(
    () => db().doc(paths.user(uid)).set({ crewId: crewId || null }, { merge: true }),
    'setUserCrew',
  );
}

/** 사용자 닉네임(그룹 공개용) 설정. */
async function setNickname(uid, nickname) {
  await withRetry(
    () => db().doc(paths.user(uid)).set({ nickname: nickname || null }, { merge: true }),
    'setNickname',
  );
}

/** 달성한 마일스톤 key 기록 (중복 방지 — arrayUnion). users/{uid}.milestones[] */
async function addMilestone(uid, key) {
  await withRetry(
    () => db().doc(paths.user(uid)).set({ milestones: FieldValue.arrayUnion(key) }, { merge: true }),
    'addMilestone',
  );
}

/** 부드러운 복귀 넛지 상태(backoff) 저장. users/{uid}.crewReturnState */
async function saveCrewReturnState(uid, state) {
  await withRetry(
    () => db().doc(paths.user(uid)).set({ crewReturnState: state || {} }, { merge: true }),
    'saveCrewReturnState',
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

/**
 * IMEM 점수 + α/β/γ 계수를 dailyRoutines에 저장.
 * 22시 리캡, /score 명령어, get_score 도구 호출 후 실행.
 * CCS 집계(imemAvg)에 반드시 필요 — 봇 사용자도 score가 기록되도록.
 * @param {string} uid
 * @param {string} date YYYY-MM-DD
 * @param {{ score, alpha, beta, gamma, betaMeal, efficiency }} data
 */
async function saveScore(uid, date, { score, alpha, beta, gamma, betaMeal, efficiency }) {
  const now = new Date();
  await db().doc(paths.dailyRoutine(uid, date)).set(
    {
      score,
      imem: {
        alpha_net: alpha,
        beta_net: beta,
        gamma_net: gamma,
        beta_meal: betaMeal ?? 1,
        efficiency: efficiency ?? null,
      },
      _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
    },
    { merge: true },
  );
}


// ─────────────────────────────────────────────
// Body Composition (Galaxy Watch / InBody)
// ─────────────────────────────────────────────

/**
 * Save body composition measurement.
 * Stores to users/{uid}/bodyComp/{YYYY-MM-DD} AND mirrors latest to profile
 * (same pattern as weight/lastWeightDate) for quick access without subcollection query.
 *
 * @param {string} uid
 * @param {string} date  YYYY-MM-DD
 * @param {{ smm?, bfp?, bmr?, visceralFat?, phaseAngle?, gender?, source? }} data
 */
async function saveBodyComp(uid, date, data) {
  const now = new Date();
  const batch = db().batch();

  // Per-date record (history) — paths.bodyComp 사용
  batch.set(
    db().doc(paths.bodyComp(uid, date)),
    {
      ...data,
      measuredAt: now,
      _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
    },
    { merge: true },
  );

  // Mirror latest onto profile for O(1) access (no subcollection query needed)
  batch.set(
    db().doc(paths.user(uid)),
    {
      bodyComp: { ...data, date, measuredAt: now },
      lastBodyCompDate: date,
      _meta: { updatedAt: now, schemaVersion: 2, source: SOURCE.TELEGRAM_BOT },
    },
    { merge: true },
  );

  // Append-only event log (분석용 타임스탬프 이력)
  batch.set(
    db().doc(paths.event(uid, `${date}_bodycomp_${now.getTime()}`)),
    makeEvent({
      type: EVENT.BODY_COMP_LOG,
      date,
      source: SOURCE.TELEGRAM_BOT,
      payload: { ...data },
      now,
    }),
  );

  await batch.commit();
}

/**
 * Get the latest body composition measurement from the user profile cache.
 * Returns null if never measured.
 * @returns {{ smm?, bfp?, bmr?, visceralFat?, phaseAngle?, date, source? } | null}
 */
async function getLatestBodyComp(uid) {
  const profile = await getProfile(uid);
  if (profile && profile.bodyComp && profile.lastBodyCompDate) {
    return { ...profile.bodyComp, date: profile.lastBodyCompDate };
  }
  return null;
}

/**
 * Get the most recent N body composition measurements (descending by date).
 * Uses subcollection orderBy on doc id (YYYY-MM-DD strings sort correctly).
 * @param {string} uid
 * @param {number} n  — max records to return (default 5)
 * @returns {Array<{ smm?, bfp?, bmr?, visceralFat?, phaseAngle?, date, source? }>}
 */
async function getBodyCompHistory(uid, n = 5) {
  try {
    const snap = await db()
      .collection(paths.bodyComps(uid))
      .orderBy('__name__', 'desc')
      .limit(n)
      .get();
    if (snap.empty) return [];
    return snap.docs.map((d) => ({ ...d.data(), date: d.id }));
  } catch (e) {
    console.warn('[store] getBodyCompHistory failed:', e.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 프리로드 기록 (/preload 명령어)
// ─────────────────────────────────────────────

/**
 * 프리로드 완료 기록 저장.
 * @param {string} uid
 * @param {string} date  YYYY-MM-DD
 * @param {{ mealType:string, recipeId:string, recipeName:string, situation:string, source:string }} data
 */
async function savePreloadLog(uid, date, data) {
  const now = new Date();
  const ref = db().doc(`users/${uid}/preloadLogs/${date}`);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : {};

  // mealType별로 저장 (점심/저녁 각각 기록 가능)
  const key = data.mealType || 'lunch';
  const batch = db().batch();

  batch.set(ref, {
    ...existing,
    [key]: {
      completed: true,
      recipeId: data.recipeId || null,
      recipeName: data.recipeName || null,
      situation: data.situation || null,
      source: data.source || SOURCE.TELEGRAM_BOT,
      recordedAt: now,
    },
    date,
    updatedAt: now,
    _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
  }, { merge: true });

  // 이벤트 로그
  batch.set(
    db().doc(paths.event(uid, `${date}_preload_${key}_${now.getTime()}`)),
    makeEvent({
      type: EVENT.ROUTINE_CHECK,  // 프리로드 전용 이벤트가 없으므로 ROUTINE_CHECK 재사용
      date,
      source: SOURCE.TELEGRAM_BOT,
      payload: { action: 'preload_complete', mealType: key, recipeId: data.recipeId, recipeName: data.recipeName },
      now,
    })
  );

  await batch.commit();
}

/**
 * 최근 N일 프리로드 기록 조회.
 * 날짜 내림차순으로 반환.
 * @param {string} uid
 * @param {number} days
 * @returns {Promise<Array<{date:string, completed:boolean, recipeId:string|null}>>}
 */
async function getRecentPreloadLogs(uid, days = 7, tz = 'Asia/Seoul') {
  const now = new Date();
  const results = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = toLogicalDate(d, tz);
    const snap = await db().doc(`users/${uid}/preloadLogs/${dateStr}`).get().catch(() => null);
    if (snap && snap.exists) {
      const data = snap.data();
      // lunch 또는 dinner 중 완료된 게 있으면 completed:true
      const completed = !!(data.lunch?.completed || data.dinner?.completed);
      const recipeId = data.lunch?.recipeId || data.dinner?.recipeId || null;
      results.push({ date: dateStr, completed, recipeId, raw: data });
    } else {
      results.push({ date: dateStr, completed: false, recipeId: null });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// Phase 1: 느낌 기록 (회복 코칭)
// ─────────────────────────────────────────────

/**
 * Feature Flag — Firestore `features/recovery` 문서로 느낌/회복 코칭 기능 제어.
 * active:true → 전체 활성화
 * active:false + whitelistChatIds:[...] → 화이트리스트만 활성화
 * 문서 없음 → 비활성화 (fail-safe)
 * @param {number|string} chatId
 * @returns {Promise<boolean>}
 */
async function isFeelingsEnabled(chatId) {
  try {
    const snap = await db().doc('features/recovery').get();
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.active === true) return true;
    const whitelist = data.whitelistChatIds;
    if (Array.isArray(whitelist) && whitelist.includes(Number(chatId))) return true;
    if (Array.isArray(whitelist) && whitelist.includes(String(chatId))) return true;
    return false;
  } catch (e) {
    console.warn('[isFeelingsEnabled] error:', e.message);
    return false; // fail-safe: OFF
  }
}

// ─────────────────────────────────────────────
// Phase 0 — 아침 체중 안부 (low-friction check-in)
// Feature flag `features/checkin { active, whitelistChatIds[] }` — mirrors recovery.
// State persisted on users/{uid}.checkinState { lastNudge, skips, snoozeUntil, awaitingWeight }.
// ─────────────────────────────────────────────
async function isCheckinEnabled(chatId) {
  try {
    const snap = await db().doc('features/checkin').get();
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.active === true) return true;
    const whitelist = data.whitelistChatIds;
    if (Array.isArray(whitelist) && whitelist.includes(Number(chatId))) return true;
    if (Array.isArray(whitelist) && whitelist.includes(String(chatId))) return true;
    return false;
  } catch (e) {
    console.warn('[isCheckinEnabled] error:', e.message);
    return false; // fail-safe: OFF
  }
}

async function saveCheckinState(uid, state) {
  await withRetry(() => db().doc(paths.user(uid)).set({ checkinState: state || {} }, { merge: true }), 'saveCheckinState');
}

// ─────────────────────────────────────────────
// 제안 1+2 — 예측→검증 느낌 루프
// Feature flag `features/prediction { active, whitelistChatIds[] }`.
// State: users/{uid}.predictionState { date, kind, asked }
// Log:   users/{uid}.predictionLog [{ d, o, pre }] 최근 20 (향후 calibrate 느낌 축)
// 오후 느낌 자체는 기존 saveFeeling(feelings/{date})로 저장 → calibrate 단일 소스.
// ─────────────────────────────────────────────
async function isPredictionEnabled(chatId) {
  try {
    const snap = await db().doc('features/prediction').get();
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.active === true) return true;
    const whitelist = data.whitelistChatIds;
    if (Array.isArray(whitelist) && whitelist.includes(Number(chatId))) return true;
    if (Array.isArray(whitelist) && whitelist.includes(String(chatId))) return true;
    return false;
  } catch (e) {
    console.warn('[isPredictionEnabled] error:', e.message);
    return false; // fail-safe: OFF
  }
}

async function savePredictionState(uid, state) {
  await withRetry(() => db().doc(paths.user(uid)).set({ predictionState: state || {} }, { merge: true }), 'savePredictionState');
}

async function savePredictionOutcome(uid, entry) {
  const ref = db().doc(paths.user(uid));
  const snap = await ref.get();
  const prev = (snap.exists && Array.isArray(snap.data().predictionLog)) ? snap.data().predictionLog : [];
  await withRetry(() => ref.set({ predictionLog: [entry, ...prev].slice(0, 20) }, { merge: true }), 'savePredictionOutcome');
}

// ─────────────────────────────────────────────
// 제안 3 — 포커스 루틴 / 제안 4 — 시간축 언멧니즈 (둘 다 flag 격리)
// ─────────────────────────────────────────────
async function _flagEnabled(docPath, chatId) {
  try {
    const snap = await db().doc(docPath).get();
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.active === true) return true;
    const wl = data.whitelistChatIds;
    if (Array.isArray(wl) && (wl.includes(Number(chatId)) || wl.includes(String(chatId)))) return true;
    return false;
  } catch (e) {
    console.warn(`[flag ${docPath}] error:`, e.message);
    return false; // fail-safe OFF
  }
}
function isFocusEnabled(chatId) { return _flagEnabled('features/focus', chatId); }
function isUnmetEnabled(chatId) { return _flagEnabled('features/unmet', chatId); }

async function saveFocusRoutines(uid, record) {
  await withRetry(() => db().doc(paths.user(uid)).set({ focusRoutines: record || null }, { merge: true }), 'saveFocusRoutines');
}

async function saveUnmetSent(uid, key) {
  const ref = db().doc(paths.user(uid));
  const snap = await ref.get();
  const prev = (snap.exists && Array.isArray(snap.data().unmetSent)) ? snap.data().unmetSent : [];
  if (prev.includes(key)) return;
  await withRetry(() => ref.set({ unmetSent: [...prev, key].slice(-12) }, { merge: true }), 'saveUnmetSent');
}

/**
 * 오늘의 느낌을 Firestore에 기록한다.
 * @param {string} uid
 * @param {'good'|'normal'|'bad'} feelingType
 * @param {number|string} chatId - 출처 식별용
 */
async function saveFeeling(uid, feelingType, chatId, tz = 'Asia/Seoul') {
  const now = new Date();
  const date = toLogicalDate(now, tz);
  const batch = db().batch();

  // 날짜별 느낌 문서 (feelings/{date}) — merge로 당일 최신 값 갱신
  batch.set(
    db().doc(paths.feelings(uid, date)),
    {
      type:  feelingType,
      chatId: String(chatId),
      recordedAt: now,
      _meta: makeMeta(SOURCE.TELEGRAM_BOT, now),
    },
    { merge: true },
  );

  // append-only 이벤트 로그
  batch.set(
    db().doc(paths.event(uid, `${date}_feeling_${now.getTime()}`)),
    makeEvent({
      type:    EVENT.FEELING_LOG,
      date,
      source:  SOURCE.TELEGRAM_BOT,
      payload: { feelingType, chatId: String(chatId) },
      now,
    }),
  );

  await batch.commit();
}

/**
 * 가장 최근의 느낌 기록을 가져온다.
 * @param {string} uid
 * @returns {Promise<{ type: string, date: string, recordedAt: Date }|null>}
 */
async function getLatestFeeling(uid) {
  try {
    const snap = await db()
      .collection(paths.feelingsCol(uid))
      .orderBy('recordedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { type: d.data().type, date: d.id, recordedAt: d.data().recordedAt?.toDate?.() ?? null };
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────
// Track D: 인크레틴 코드 테스트 ↔ 봇 통합
// ─────────────────────────────────────────────

/**
 * 텔레그램 deep link로 도착한 테스트 결과를 임시 저장.
 * /link 성공 시 importTestResult()로 사용자 프로필에 이식.
 * TTL: 7일 (Firestore TTL 정책으로 자동 삭제 — Firebase console에서 설정 필요)
 * @param {number|string} chatId
 * @param {{ type: string, scores: object, takenAt: Date }} decoded
 */
async function saveTestResultPending(chatId, decoded) {
  await db().collection('pendingTestResults').doc(String(chatId)).set({
    type:      decoded.type,
    scores:    decoded.scores,
    takenAt:   decoded.takenAt,
    source:    'telegram_deeplink',
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * /link 성공 시 호출: pendingTestResults/{chatId} → users/{uid}.testProfile 이식.
 * @param {string} uid
 * @param {number|string} chatId
 * @returns {Promise<{ type: string, weakest: string }|null>} - null이면 pending 없음
 */
async function importTestResult(uid, chatId) {
  const ref = db().collection('pendingTestResults').doc(String(chatId));
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();

  // 약점(weakest) 자동 계산 — 가장 낮은 점수 계수
  const scores = data.scores || { alpha: 50, beta: 50, gamma: 50 };
  const weakest = Object.entries(scores).reduce(
    (min, [k, v]) => (v < min.v ? { k, v } : min),
    { k: 'alpha', v: Infinity },
  ).k;

  // 사용자 프로필에 병합
  await db().doc(`users/${uid}`).set(
    {
      testProfile: {
        type:       data.type,
        scores,
        weakest,
        takenAt:    data.takenAt ?? null,
        importedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  // 원본 즉시 삭제 (개인정보 최소화)
  await ref.delete();

  return { type: data.type, weakest };
}

/**
 * 사용자의 테스트 프로필 조회 (claude.js systemPrompt 컨텍스트용).
 * @param {string} uid
 * @returns {Promise<{ type, scores, weakest, takenAt, importedAt }|null>}
 */
async function getTestProfile(uid) {
  try {
    const snap = await db().doc(`users/${uid}`).get();
    return snap.exists ? (snap.data().testProfile || null) : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  findUidByChatId,
  consumeLinkCode,
  ensureStandaloneUser,
  toLogicalDate,
  updateUserLocation,
  getProfile,
  saveTeaserShown,
  saveContentIntent,
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
  saveScore,
  saveBodyComp,
  getLatestBodyComp,
  getBodyCompHistory,
  // 프리로드 기록
  savePreloadLog,
  getRecentPreloadLogs,
  // Phase 1 — 회복 코칭
  isFeelingsEnabled,
  isCheckinEnabled,
  saveCheckinState,
  isPredictionEnabled,
  savePredictionState,
  savePredictionOutcome,
  isFocusEnabled,
  isUnmetEnabled,
  saveFocusRoutines,
  saveUnmetSent,
  saveFeeling,
  getLatestFeeling,
  // Track D — 테스트↔봇 통합
  saveTestResultPending,
  importTestResult,
  getTestProfile,
  // 크루 시스템 (Phase 1)
  CREW_ID,
  getCrew,
  saveCrewConfig,
  setCrewMembers,
  addCrewMember,
  removeCrewMember,
  setUserCrew,
  setNickname,
  addMilestone,
  saveCrewReturnState,
};
