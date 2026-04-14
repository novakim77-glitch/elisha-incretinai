// normalize.js — Single source of truth for profile & daily data normalization.
// Both the app and bot pass Firestore data through these functions before
// any calculation, eliminating field-name and type mismatches.

/**
 * Normalize a raw Firestore user profile into a consistent typed object.
 * Handles: string→number coercion, field name aliases (cw/weight/sw, h in cm/m).
 *
 * @param {Object} raw - Firestore `users/{uid}` doc data
 * @returns {Object} normalized profile with guaranteed numeric fields
 */
function normalizeProfile(raw) {
  if (!raw) raw = {};

  // Height: app stores as string cm (e.g. "170"), could also be meters (1.7)
  var rawH = Number(raw.h) || Number(raw.height) || 0;
  var heightCm = rawH > 3 ? rawH : rawH * 100;  // auto-detect cm vs m

  // Current weight: bot writes `weight`, app writes `sw` (start weight)
  // `cw` is the canonical name in imem-core but nobody writes it
  var cw = Number(raw.cw) || Number(raw.weight) || Number(raw.sw) || 0;

  return {
    // Numeric, normalized
    heightCm: heightCm,
    h: heightCm > 0 ? heightCm / 100 : 0,  // meters (for prediction.js)
    cw: cw,
    sw: Number(raw.sw) || cw,
    gw: Number(raw.gw) || 0,
    age: Number(raw.age) || 30,
    gender: raw.gender || 'male',
    lat: Number(raw.lat) || 37.5665,

    // Passthrough (no normalization needed)
    isDiabetic: raw.isDiabetic || 'no',
    exercise: raw.exercise || 'none',
    exCount: Number(raw.exercise) || 0,
    timezone: raw.timezone || 'Asia/Seoul',
    wakeup: raw.wakeup || '07:00',
    persona: raw.persona || 'empathetic',
    userStartDate: raw.userStartDate || raw.start || null,

    // Telegram link state
    telegramLinked: !!raw.telegramLinked,
    telegramChatId: raw.telegramChatId || null,

    // Weight alias for backward compatibility (some code reads profile.weight)
    weight: cw,
  };
}

/**
 * Normalize a raw Firestore dailyRoutine doc into consistent field names.
 * Resolves the riskChecks/riskActive and recoveries/recoveryDone mismatch.
 *
 * @param {Object} raw - Firestore `users/{uid}/dailyRoutines/{date}` doc data
 * @returns {Object} normalized daily data
 */
function normalizeDaily(raw) {
  if (!raw) raw = {};
  return {
    checks: raw.checks || {},
    // App writes 'riskChecks', bot historically read 'riskActive' — unify
    riskActive: raw.riskActive || raw.riskChecks || {},
    // App writes 'recoveries', bot historically read 'recoveryDone' — unify
    recoveryDone: raw.recoveryDone || raw.recoveries || {},
    weight: raw.weight ?? null,
    meals: Array.isArray(raw.meals) ? raw.meals : [],
    score: raw.score ?? null,
    imem: raw.imem || null,
    dailyKcal: Number(raw.dailyKcal) || 0,
    focusRoutines: Array.isArray(raw.focusRoutines) ? raw.focusRoutines : [],
  };
}

module.exports = { normalizeProfile, normalizeDaily };
