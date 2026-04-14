#!/usr/bin/env node
// test-boundary.js — Boundary tests for app↔bot data contract
// Verifies that shared functions handle all field-name and type variations
// that actually exist in Firestore.

const {
  normalizeProfile, normalizeDaily,
  calculateTargetCalories, analyzeMealDay, getMealBudget,
  getWeightPrediction, calculateIMEM, calculateScore,
  buildIMEMContext,
} = require('./packages/imem-core');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL:', msg); }
}
function section(title) { console.log('\n' + title); }

// ============================================================
section('=== normalizeProfile ===');
// ============================================================

// App-style profile (all strings, cm height, sw instead of cw)
const appProfile = { h: '170', sw: '86.5', age: '42', gender: 'male', lat: '37.5665' };
const np1 = normalizeProfile(appProfile);
assert(np1.heightCm === 170, 'heightCm from string cm');
assert(np1.h === 1.7, 'h in meters from cm string');
assert(np1.cw === 86.5, 'cw from sw fallback');
assert(np1.age === 42, 'age string→number');
assert(np1.lat === 37.5665, 'lat string→number');
assert(np1.gender === 'male', 'gender passthrough');

// Bot-style profile (weight field, numbers)
const botProfile = { h: 1.7, weight: 85, age: 30, gender: 'female' };
const np2 = normalizeProfile(botProfile);
assert(np2.heightCm === 170, 'heightCm from meters');
assert(np2.cw === 85, 'cw from weight');
assert(np2.h === 1.7, 'h preserved as meters');

// Edge: empty profile
const np3 = normalizeProfile({});
assert(np3.cw === 0, 'empty → cw=0');
assert(np3.heightCm === 0, 'empty → heightCm=0');
assert(np3.age === 30, 'empty → age default 30');
assert(np3.timezone === 'Asia/Seoul', 'empty → default timezone');

// Edge: null profile
const np4 = normalizeProfile(null);
assert(np4.cw === 0, 'null → cw=0');

// Profile with all three weight fields (priority: cw > weight > sw)
const np5 = normalizeProfile({ cw: 80, weight: 85, sw: '90' });
assert(np5.cw === 80, 'cw takes priority over weight and sw');

// ============================================================
section('=== normalizeDaily ===');
// ============================================================

// App writes riskChecks/recoveries
const appDaily = {
  checks: { 0: true, 2: true },
  riskChecks: { 0: true, 3: true },
  recoveries: { 0: true },
  weight: 85.2,
  meals: [{ menu: 'test', kcal: 300, time: '12:00' }],
};
const nd1 = normalizeDaily(appDaily);
assert(nd1.riskActive['0'] === true, 'riskActive reads from riskChecks');
assert(nd1.riskActive['3'] === true, 'riskActive reads riskChecks key 3');
assert(nd1.recoveryDone['0'] === true, 'recoveryDone reads from recoveries');
assert(nd1.meals.length === 1, 'meals preserved');
assert(nd1.weight === 85.2, 'weight preserved');

// Bot writes riskActive/recoveryDone (legacy)
const botDaily = {
  checks: { 1: true },
  riskActive: { 2: true },
  recoveryDone: { 2: true },
};
const nd2 = normalizeDaily(botDaily);
assert(nd2.riskActive['2'] === true, 'riskActive direct read');
assert(nd2.recoveryDone['2'] === true, 'recoveryDone direct read');

// Empty daily
const nd3 = normalizeDaily({});
assert(JSON.stringify(nd3.checks) === '{}', 'empty checks');
assert(JSON.stringify(nd3.riskActive) === '{}', 'empty riskActive');
assert(nd3.meals.length === 0, 'empty meals');
assert(nd3.weight === null, 'null weight');

// Both fields present (riskActive takes priority over riskChecks)
const nd4 = normalizeDaily({ riskActive: { 0: true }, riskChecks: { 1: true } });
assert(nd4.riskActive['0'] === true, 'riskActive takes priority');
assert(!nd4.riskActive['1'], 'riskChecks ignored when riskActive exists');

// ============================================================
section('=== calculateTargetCalories (boundary) ===');
// ============================================================

// App-style input (strings, cm)
const tc1 = calculateTargetCalories({ h: '170', weight: 85, age: '42', gender: 'male' });
assert(tc1 !== null, 'works with string cm height');
assert(tc1.bmr > 1500 && tc1.bmr < 2000, 'BMR in normal range: ' + tc1.bmr);
assert(tc1.target > 1200 && tc1.target < 2500, 'target in normal range: ' + tc1.target);

// Same person, meters input
const tc2 = calculateTargetCalories({ h: 1.7, cw: 85, age: 42, gender: 'male' });
assert(tc2.bmr === tc1.bmr, 'cm and m inputs give same BMR');

// Missing weight
const tc3 = calculateTargetCalories({ h: '170', age: '30', gender: 'female' });
assert(tc3 === null, 'null when no weight');

// sw fallback
const tc4 = calculateTargetCalories({ h: '165', sw: '60', age: '35', gender: 'female' });
assert(tc4 !== null, 'works with sw fallback');
assert(tc4.target >= 1200, 'target at least 1200');

// ============================================================
section('=== getWeightPrediction (boundary) ===');
// ============================================================

const dummyImem = { alpha_net: 0.8, beta_net: 0.7, gamma_net: 0.6, alpha_penalty: 0, beta_penalty: 0, gamma_penalty: 0 };

// App-style profile
const wp1 = getWeightPrediction({ imem: dummyImem, score: 70, profile: { h: '180', weight: 85, age: '42', gender: 'male' } });
assert(wp1 !== null, 'prediction works with app-style profile');
assert(wp1.bmr > 1500 && wp1.bmr < 2200, 'prediction BMR normal: ' + wp1.bmr);
assert(wp1.predicted > 50 && wp1.predicted < 150, 'predicted weight normal: ' + wp1.predicted);

// Meters input
const wp2 = getWeightPrediction({ imem: dummyImem, score: 70, profile: { h: 1.8, cw: 85, age: 42, gender: 'male' } });
assert(wp2.bmr === wp1.bmr, 'same BMR for cm and m');

// Missing data
const wp3 = getWeightPrediction({ imem: dummyImem, score: 70, profile: {} });
assert(wp3 === null, 'null when no profile data');

// ============================================================
section('=== analyzeMealDay with app-style profile ===');
// ============================================================

const meals = [
  { menu: '김치찌개', kcal: 450, time: '12:30', macros: { protein: 25, carbs: 40, fat: 15 } },
  { menu: '사과', kcal: 80, time: '15:00' },
];

const md1 = analyzeMealDay(meals, { h: '170', weight: 85, age: '42', gender: 'male' });
assert(md1 !== null, 'analyzeMealDay works with app-style profile');
assert(md1.totalKcal === 530, 'totalKcal correct');
assert(md1.dailyTarget > 1200 && md1.dailyTarget < 2500, 'dailyTarget normal: ' + md1.dailyTarget);
assert(md1.proteinTarget > 80 && md1.proteinTarget < 200, 'proteinTarget normal: ' + md1.proteinTarget);

// ============================================================
section('=== buildIMEMContext with app-style data ===');
// ============================================================

const ctx = buildIMEMContext({
  profile: { h: '170', sw: '86', age: '42', gender: 'male', lat: '37.5', userStartDate: '2026-03-01' },
  today: {
    checks: [true, true, false, false, false, false, false, false, false, false],
    riskActive: [false, false, false, false, false, false, false, false],
    recoveryDone: [false, false, false, false, false, false, false, false],
    meals: [{ menu: 'test', kcal: 300, time: '12:00' }],
  },
  historyDays: 10,
});
assert(ctx.currentWeight === 86, 'context currentWeight from sw');
assert(ctx.height === 170, 'context height in cm');
assert(ctx.age === 42, 'context age numeric');
assert(ctx.mealCount === 1, 'context mealCount');
assert(typeof ctx.alpha === 'number', 'alpha is number');
assert(typeof ctx.score === 'number', 'score is number');

// ============================================================
// Report
// ============================================================

console.log('\n' + '='.repeat(50));
console.log('Results: ' + pass + ' passed, ' + fail + ' failed out of ' + (pass + fail));
if (fail > 0) { console.log('❌ SOME TESTS FAILED'); process.exit(1); }
else { console.log('✅ ALL TESTS PASSED'); }
