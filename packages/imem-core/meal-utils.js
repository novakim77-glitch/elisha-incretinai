// IMEM Core — Meal classification, calorie targeting, and daily meal analysis.
// Used by the Telegram bot for real-time meal feedback and β_meal calculation.

/**
 * Classify meal type from HH:MM time string (KST).
 * @param {string} time - "HH:MM"
 * @returns {'breakfast'|'lunch'|'dinner'|'snack'|'lateNight'}
 */
function classifyMealType(time) {
  if (!time || typeof time !== 'string') return 'snack';
  const [h, m] = time.split(':').map(Number);
  const mins = h * 60 + (m || 0);

  if (mins >= 360 && mins < 600)   return 'breakfast';   // 06:00-09:59
  if (mins >= 660 && mins < 840)   return 'lunch';       // 11:00-13:59
  if (mins >= 1020 && mins < 1140) return 'dinner';      // 17:00-18:59
  if (mins >= 1140)                return 'lateNight';    // 19:00+
  return 'snack';  // 10:00-10:59, 14:00-16:59
}

/**
 * Calculate daily target calories using Mifflin-St Jeor BMR with deficit.
 * @param {Object} profile - { cw, h, age, gender }
 * @param {number} [deficitKcal=500] - daily deficit for ~0.5kg/week loss
 * @returns {{ bmr: number, tdee: number, target: number }|null}
 */
function calculateTargetCalories(profile, deficitKcal) {
  if (deficitKcal === undefined) deficitKcal = 500;
  var cw = profile.cw, h = profile.h, age = profile.age, gender = profile.gender;
  if (!cw || !h || h <= 0) return null;

  var bmr = gender === 'male'
    ? 10 * cw + 6.25 * (h * 100) - 5 * age + 5
    : 10 * cw + 6.25 * (h * 100) - 5 * age - 161;

  var tdee = Math.round(bmr * 1.2);
  var target = Math.max(1200, tdee - deficitKcal);

  return { bmr: Math.round(bmr), tdee: tdee, target: target };
}

/**
 * Get per-meal calorie budget based on meal type.
 * Distribution: breakfast 25%, lunch 40%, dinner 30%, snack 5%
 */
function getMealBudget(dailyTarget, mealType) {
  var ratios = {
    breakfast: 0.25,
    lunch: 0.40,
    dinner: 0.30,
    snack: 0.05,
    lateNight: 0,
  };
  return Math.round(dailyTarget * (ratios[mealType] || 0.05));
}

/**
 * Analyze today's cumulative meal state and produce feedback data.
 * @param {Array} meals - all meals so far today
 * @param {Object} profile - user profile for target calculation
 * @returns {Object|null} analysis result
 */
function analyzeMealDay(meals, profile) {
  if (!meals || meals.length === 0) return null;

  var target = calculateTargetCalories(profile);
  if (!target) return null;

  var totalKcal = meals.reduce(function(s, m) { return s + (Number(m.kcal) || 0); }, 0);
  var remaining = target.target - totalKcal;
  var totalProtein = meals.reduce(function(s, m) { return s + (Number(m.macros && m.macros.protein) || 0); }, 0);
  var totalCarbs = meals.reduce(function(s, m) { return s + (Number(m.macros && m.macros.carbs) || 0); }, 0);
  var totalFat = meals.reduce(function(s, m) { return s + (Number(m.macros && m.macros.fat) || 0); }, 0);

  // Protein target: 1.4 g/kg body weight
  var proteinTarget = Math.round(profile.cw * 1.4);
  var proteinGap = proteinTarget - totalProtein;

  // Classify each meal
  var classified = meals.map(function(m) {
    return Object.assign({}, m, { mealType: classifyMealType(m.time) });
  });

  // Detect late night eating (for R-06 auto-flag)
  var hasLateNight = classified.some(function(m) { return m.mealType === 'lateNight'; });

  // Macro imbalance detection
  var macroTotal = totalProtein + totalCarbs + totalFat;
  var carbRatio = macroTotal > 0 ? totalCarbs / macroTotal : 0;
  var proteinRatio = macroTotal > 0 ? totalProtein / macroTotal : 0;

  return {
    totalKcal: totalKcal,
    remaining: remaining,
    dailyTarget: target.target,
    mealCount: meals.length,
    totalProtein: totalProtein,
    totalCarbs: totalCarbs,
    totalFat: totalFat,
    proteinTarget: proteinTarget,
    proteinGap: proteinGap,
    hasLateNight: hasLateNight,
    isHighCarb: carbRatio > 0.65,
    isLowProtein: proteinRatio < 0.15,
    classified: classified,
  };
}

var MEAL_TYPE_KR = {
  breakfast: '\uc544\uce68',
  lunch: '\uc810\uc2ec',
  dinner: '\uc800\ub141',
  snack: '\uac04\uc2dd',
  lateNight: '\uc57c\uc2dd',
};

module.exports = {
  classifyMealType: classifyMealType,
  calculateTargetCalories: calculateTargetCalories,
  getMealBudget: getMealBudget,
  analyzeMealDay: analyzeMealDay,
  MEAL_TYPE_KR: MEAL_TYPE_KR,
};
