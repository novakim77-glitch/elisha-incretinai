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
const { normalizeDaily } = require('./normalize');

/**
 * @param {Object} input
 * @param {Object} input.profile  - { h, cw, gw, age, gender, isDiabetic, exCount, lat, persona, userStartDate }
 * @param {Object} input.today    - { checks[10], riskActive[8], recoveryDone[8] }
 * @param {number} [input.historyDays=0]
 * @param {Date}   [input.now]
 */
function buildIMEMContext({ profile, today, historyDays = 0, now = new Date() }) {
  // Normalize daily data: resolves app field names (riskChecks→riskActive, recoveries→recoveryDone)
  const nd = normalizeDaily(today);

  const sun = calculateSunTimes(profile.lat ?? 37.5, now);
  const week = getUserWeek({
    userStartDate: profile.userStartDate,
    historyDays,
    now,
  });

  const imem = calculateIMEM({
    checks: nd.checks,
    riskActive: nd.riskActive,
    recoveryDone: nd.recoveryDone,
    profile: { isDiabetic: profile.isDiabetic, exCount: profile.exCount },
    sunset: sun.sunset,
    isNightMode: !isWithinGoldenTime(sun, now),
    meals: nd.meals,
  });

  const score = calculateScore({
    checks: nd.checks,
    riskActive: nd.riskActive,
    recoveryDone: nd.recoveryDone,
    week,
  });

  // Handle both array and map forms of checks
  const checksArr = Array.isArray(nd.checks)
    ? nd.checks
    : routine.map((_, i) => !!nd.checks[i]);
  const completed = checksArr
    .map((c, i) => (c ? routine[i].title : null))
    .filter(Boolean);
  const pending = checksArr
    .map((c, i) => (!c ? routine[i].title : null))
    .filter(Boolean);

  const pad = (n) => String(n).padStart(2, '0');

  // Normalize profile fields (app stores strings, keys differ)
  var cw = Number(profile.cw) || Number(profile.weight) || Number(profile.sw) || 0;
  var rawH = Number(profile.h) || 0;
  var heightCm = rawH > 3 ? rawH : rawH * 100;

  return {
    // Profile (normalized)
    height: heightCm,
    currentWeight: cw,
    goalWeight: Number(profile.gw) || 0,
    age: Number(profile.age) || 30,
    gender: profile.gender || 'male',
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
    mealCount: nd.meals.length,
    dailyKcal: nd.meals.reduce(function(s, m) { return s + (Number(m.kcal) || 0); }, 0),

    // Persona for system prompt selection
    persona: profile.persona || 'clinical',
  };
}

module.exports = { buildIMEMContext };
