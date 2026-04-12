// IMEM Context Builder — produces the JSON context passed to Claude API
// as part of the Telegram bot's natural-language coaching pipeline.
//
// Design intent (from architecture doc CHAPTER 5.2):
//   - Compact, deterministic snapshot of the user's IMEM state.
//   - No DOM, no Firebase calls — pure transform from raw inputs.
//   - The bot layer is responsible for fetching profile/today/sun and
//     handing them to this builder.

const { calculateIMEM, totalEfficiency } = require('./calculate');
const { calculateScore, getUserWeek } = require('./score');
const {
  calculateSunTimes,
  isWithinGoldenTime,
  getMinutesToSunset,
} = require('./biosync');
const { routine } = require('./constants');

/**
 * @param {Object} input
 * @param {Object} input.profile  - { h, cw, gw, age, gender, isDiabetic, exCount, lat, persona, userStartDate }
 * @param {Object} input.today    - { checks[10], riskActive[8], recoveryDone[8] }
 * @param {number} [input.historyDays=0]
 * @param {Date}   [input.now]
 */
function buildIMEMContext({ profile, today, historyDays = 0, now = new Date() }) {
  const sun = calculateSunTimes(profile.lat ?? 37.5, now);
  const week = getUserWeek({
    userStartDate: profile.userStartDate,
    historyDays,
    now,
  });

  const imem = calculateIMEM({
    checks: today.checks,
    riskActive: today.riskActive,
    recoveryDone: today.recoveryDone,
    profile: { isDiabetic: profile.isDiabetic, exCount: profile.exCount },
    sunset: sun.sunset,
    isNightMode: !isWithinGoldenTime(sun, now),
    meals: today.meals || [],
  });

  const score = calculateScore({
    checks: today.checks,
    riskActive: today.riskActive,
    recoveryDone: today.recoveryDone,
    week,
  });

  const completed = today.checks
    .map((c, i) => (c ? routine[i].title : null))
    .filter(Boolean);
  const pending = today.checks
    .map((c, i) => (!c ? routine[i].title : null))
    .filter(Boolean);

  const pad = (n) => String(n).padStart(2, '0');

  return {
    // Profile
    height: profile.h,
    currentWeight: profile.cw,
    goalWeight: profile.gw,
    age: profile.age,
    gender: profile.gender,
    diabeticType: profile.isDiabetic,   // 'no' | 'pre' | 'yes'
    weeklyExercise: profile.exCount,

    // IMEM state
    alpha: imem.alpha_net,
    beta: imem.beta_net,
    gamma: imem.gamma_net,
    alphaPenalty: imem.alpha_penalty,
    betaPenalty: imem.beta_penalty,
    gammaPenalty: imem.gamma_penalty,
    totalEfficiency: Number(totalEfficiency(imem).toFixed(3)),
    score,
    week,

    // Bio-Sync
    sunrise: `${pad(sun.sunrise.h)}:${pad(sun.sunrise.m)}`,
    sunset:  `${pad(sun.sunset.h)}:${pad(sun.sunset.m)}`,
    isGoldenTime: isWithinGoldenTime(sun, now),
    minutesToSunset: getMinutesToSunset(sun, now),

    // Routine status
    completedRoutines: completed,
    pendingRoutines: pending,

    // Meal data
    betaMeal: imem.beta_meal,
    mealCount: (today.meals || []).length,
    dailyKcal: (today.meals || []).reduce(function(s, m) { return s + (Number(m.kcal) || 0); }, 0),

    // Persona for system prompt selection
    persona: profile.persona || 'clinical',
  };
}

module.exports = { buildIMEMContext };
