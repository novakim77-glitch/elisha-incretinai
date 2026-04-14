#!/usr/bin/env node
// test-smoke.js — Post-deploy smoke test
// Verifies that all imem-core modules load correctly and produce sane output
// for a realistic user scenario (app-style data from Firestore).
//
// Run: node test-smoke.js
// Exit 0 = all good, Exit 1 = something broke.

const core = require('./packages/imem-core');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL:', msg); }
}
function section(title) { console.log('\n' + title); }

// ── Realistic user scenario ──────────────────────────────
// Simulates a linked app user mid-day with 2 meals logged,
// profile stored in Firestore app format (strings, cm, sw).

const profile = {
  h: '170', sw: '86.5', age: '42', gender: 'male',
  lat: '37.5665', timezone: 'Asia/Seoul',
  isDiabetic: 'no', exCount: 3,
  userStartDate: '2026-03-01', persona: 'clinical',
};

const todayRaw = {
  checks: { 0: true, 1: true, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false },
  riskChecks: { 0: true, 3: true },    // app field name
  recoveries: { 0: true },             // app field name
  weight: 85.2,
  meals: [
    { menu: '김치찌개+밥', kcal: 520, time: '12:30', macros: { protein: 28, carbs: 60, fat: 15 } },
    { menu: '사과+요거트', kcal: 150, time: '15:00', macros: { protein: 8, carbs: 25, fat: 3 } },
  ],
};

// ── 1. Module loading ────────────────────────────────────
section('=== Module loading ===');
assert(typeof core.calculateIMEM === 'function', 'calculateIMEM exists');
assert(typeof core.calculateScore === 'function', 'calculateScore exists');
assert(typeof core.normalizeProfile === 'function', 'normalizeProfile exists');
assert(typeof core.normalizeDaily === 'function', 'normalizeDaily exists');
assert(typeof core.buildIMEMContext === 'function', 'buildIMEMContext exists');
assert(typeof core.getWeightPrediction === 'function', 'getWeightPrediction exists');
assert(typeof core.calculateTargetCalories === 'function', 'calculateTargetCalories exists');
assert(typeof core.analyzeMealDay === 'function', 'analyzeMealDay exists');
assert(typeof core.getMealBudget === 'function', 'getMealBudget exists');
assert(typeof core.interpretIMEM === 'function', 'interpretIMEM exists');
assert(typeof core.classifyMealType === 'function', 'classifyMealType exists');
assert(typeof core.calculateSunTimes === 'function', 'calculateSunTimes exists');
assert(core.constants && core.constants.routine, 'constants.routine exists');
assert(core.schema && core.schema.paths, 'schema.paths exists');

// ── 2. Normalization ─────────────────────────────────────
section('=== Normalize (app→core) ===');
const np = core.normalizeProfile(profile);
assert(np.heightCm === 170, 'heightCm=' + np.heightCm);
assert(np.cw === 86.5, 'cw=' + np.cw);
assert(np.h === 1.7, 'h meters=' + np.h);
assert(np.age === 42, 'age=' + np.age);

const nd = core.normalizeDaily(todayRaw);
assert(nd.riskActive['0'] === true, 'riskActive from riskChecks');
assert(nd.riskActive['3'] === true, 'riskActive key 3');
assert(nd.recoveryDone['0'] === true, 'recoveryDone from recoveries');
assert(nd.meals.length === 2, 'meals count=' + nd.meals.length);

// ── 3. BMR / Calories (the 40568 bug check) ─────────────
section('=== Calorie calculations ===');
const tc = core.calculateTargetCalories(profile);
assert(tc !== null, 'calculateTargetCalories not null');
assert(tc.bmr > 1500 && tc.bmr < 2000, 'BMR sane: ' + tc.bmr);
assert(tc.target > 1200 && tc.target < 2500, 'target sane: ' + tc.target);
assert(tc.tdee > 1800 && tc.tdee < 2500, 'TDEE sane: ' + tc.tdee);

// Verify same result with meters input
const tc2 = core.calculateTargetCalories({ h: 1.7, cw: 86.5, age: 42, gender: 'male' });
assert(tc2.bmr === tc.bmr, 'cm vs m BMR match');

// ── 4. Meal analysis ─────────────────────────────────────
section('=== Meal analysis ===');
const ma = core.analyzeMealDay(todayRaw.meals, profile);
assert(ma !== null, 'analyzeMealDay not null');
assert(ma.totalKcal === 670, 'totalKcal=' + ma.totalKcal);
assert(ma.dailyTarget > 1200, 'dailyTarget=' + ma.dailyTarget);
assert(ma.remaining > 0, 'remaining calories > 0');
assert(ma.proteinTarget > 80, 'proteinTarget=' + ma.proteinTarget);

// getMealBudget(target, mealType) returns a single number for one meal type
const brkBudget = core.getMealBudget(tc.target, 'breakfast');
const lnchBudget = core.getMealBudget(tc.target, 'lunch');
const dinBudget = core.getMealBudget(tc.target, 'dinner');
const snkBudget = core.getMealBudget(tc.target, 'snack');
assert(brkBudget > 0, 'breakfast budget=' + brkBudget);
assert(lnchBudget > 0, 'lunch budget=' + lnchBudget);
assert(dinBudget > 0, 'dinner budget=' + dinBudget);
assert(Math.abs(brkBudget + lnchBudget + dinBudget + snkBudget - tc.target) < 2,
  'budgets sum to target');

// ── 5. Meal classification ───────────────────────────────
section('=== Meal classification ===');
assert(core.classifyMealType('07:30') === 'breakfast', '07:30=breakfast');
assert(core.classifyMealType('12:30') === 'lunch', '12:30=lunch');
assert(core.classifyMealType('18:00') === 'dinner', '18:00=dinner');
assert(core.classifyMealType('21:30') === 'lateNight', '21:30=lateNight');

// ── 6. IMEM calculation ──────────────────────────────────
section('=== IMEM calculation ===');
const sun = core.calculateSunTimes(37.5665, new Date());
const imem = core.calculateIMEM({
  checks: todayRaw.checks,
  riskActive: nd.riskActive,     // normalized!
  recoveryDone: nd.recoveryDone, // normalized!
  profile: { isDiabetic: 'no', exCount: 3 },
  sunset: sun.sunset,
  isNightMode: false,
  meals: todayRaw.meals,
});
assert(imem.alpha_net >= 0 && imem.alpha_net <= 1.2, 'alpha_net sane: ' + imem.alpha_net);
assert(imem.beta_net >= 0 && imem.beta_net <= 1.2, 'beta_net sane: ' + imem.beta_net);
assert(imem.gamma_net >= 0 && imem.gamma_net <= 1.2, 'gamma_net sane: ' + imem.gamma_net);
assert(typeof imem.beta_meal === 'number', 'beta_meal exists: ' + imem.beta_meal);

// ── 7. Score ─────────────────────────────────────────────
section('=== Score ===');
const score = core.calculateScore({
  checks: todayRaw.checks,
  riskActive: nd.riskActive,
  recoveryDone: nd.recoveryDone,
  week: 7,
});
assert(score >= 0 && score <= 100, 'score in range: ' + score);

// ── 8. Weight prediction ─────────────────────────────────
section('=== Weight prediction ===');
const wp = core.getWeightPrediction({ imem, score, profile });
assert(wp !== null, 'prediction not null');
assert(wp.bmr > 1500 && wp.bmr < 2000, 'prediction BMR sane: ' + wp.bmr);
assert(wp.predicted > 50 && wp.predicted < 150, 'predicted weight sane: ' + wp.predicted);
assert(typeof wp.weeklyDelta === 'number', 'weeklyDelta exists');

// ── 9. Context builder ───────────────────────────────────
section('=== Context builder ===');
const ctx = core.buildIMEMContext({
  profile, today: todayRaw, historyDays: 10,
});
assert(ctx.currentWeight === 86.5, 'ctx weight=' + ctx.currentWeight);
assert(ctx.height === 170, 'ctx height=' + ctx.height);
assert(ctx.age === 42, 'ctx age=' + ctx.age);
assert(ctx.mealCount === 2, 'ctx mealCount=' + ctx.mealCount);
assert(ctx.dailyKcal === 670, 'ctx dailyKcal=' + ctx.dailyKcal);
assert(typeof ctx.alpha === 'number', 'ctx alpha');
assert(typeof ctx.score === 'number', 'ctx score');
assert(ctx.persona === 'clinical', 'ctx persona');

// ── 10. Interpretation ───────────────────────────────────
section('=== Interpretation ===');
const interp = core.interpretIMEM(imem, score);
assert(typeof interp === 'object' && interp !== null, 'interpretIMEM returns object');
assert(typeof interp.alpha === 'string' && interp.alpha.length > 5, 'alpha interpretation: ' + (interp.alpha || '').substring(0, 30));
assert(typeof interp.beta === 'string', 'beta interpretation exists');
assert(typeof interp.gamma === 'string', 'gamma interpretation exists');
assert(typeof interp.score === 'string', 'score interpretation exists');
assert(typeof interp.efficiency === 'string', 'efficiency interpretation exists');

// ── 11. Schema paths ─────────────────────────────────────
section('=== Schema paths ===');
const p = core.schema.paths;
assert(p.user('abc') === 'users/abc', 'user path');
assert(p.dailyRoutine('abc', '2026-04-14') === 'users/abc/dailyRoutines/2026-04-14', 'daily path');
assert(p.events('abc') === 'users/abc/events', 'events path');
assert(p.telegramLink('abc') === 'users/abc/integrations/telegram', 'telegram path');

// ── Report ───────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log('Smoke test: ' + pass + ' passed, ' + fail + ' failed out of ' + (pass + fail));
if (fail > 0) {
  console.log('❌ SMOKE TEST FAILED — DO NOT DEPLOY');
  process.exit(1);
} else {
  console.log('✅ SMOKE TEST PASSED — safe to deploy');
}
