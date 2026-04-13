// IMEM beta_meal 엔진 테스트
// 실행: node test-beta-meal.js

const { calculateIMEM, computeBetaMeal, totalEfficiency } = require('./calculate');
const { classifyMealType, calculateTargetCalories, getMealBudget, analyzeMealDay } = require('./meal-utils');

let passed = 0, failed = 0;
function assert(name, actual, expected, tolerance) {
  const tol = tolerance || 0.001;
  const ok = Math.abs(actual - expected) < tol;
  if (ok) { passed++; console.log(`  ✅ ${name}: ${actual}`); }
  else { failed++; console.log(`  ❌ ${name}: got ${actual}, expected ${expected}`); }
}
function assertEq(name, actual, expected) {
  if (actual === expected) { passed++; console.log(`  ✅ ${name}: ${actual}`); }
  else { failed++; console.log(`  ❌ ${name}: got ${actual}, expected ${expected}`); }
}
function assertBool(name, actual, expected) {
  if (!!actual === !!expected) { passed++; console.log(`  ✅ ${name}: ${actual}`); }
  else { failed++; console.log(`  ❌ ${name}: got ${actual}, expected ${expected}`); }
}

// ═══════════════════════════════════════
console.log('\n═══ 1. computeBetaMeal 단위 테스트 ═══');
// ═══════════════════════════════════════

// 1-1. 식사 없음 → 1.0 (하위 호환)
assert('식사 없음', computeBetaMeal([]), 1.0);
assert('null 입력', computeBetaMeal(null), 1.0);
assert('undefined', computeBetaMeal(undefined), 1.0);

// 1-2. 완벽한 식사 (betaScore=1.0) → 0.95 + 1.0 * 0.075 = 1.025
assert('완벽한 식사', computeBetaMeal([{ betaScore: 1.0 }]), 1.025);

// 1-3. 최악의 식사 (betaScore=0) → 0.95 + 0 = 0.95
assert('최악의 식사', computeBetaMeal([{ betaScore: 0 }]), 0.95);

// 1-4. 중간 식사 (betaScore=0.67) → 0.95 + 0.67 * 0.075 ≈ 1.000
assert('중립점 betaScore=0.67', computeBetaMeal([{ betaScore: 0.67 }]), 1.0, 0.002);

// 1-5. 여러 끼니 평균
const mixed = [{ betaScore: 0.8 }, { betaScore: 0.6 }, { betaScore: 0.4 }];
// avg = 0.6 → 0.95 + 0.6 * 0.075 = 0.995
assert('3끼 평균 0.6', computeBetaMeal(mixed), 0.995);

// 1-6. betaScore 없는 끼니는 무시
const partial = [{ betaScore: 0.8 }, { menu: '라면' }, { betaScore: 0.4 }];
// valid: [0.8, 0.4], avg = 0.6 → 0.995
assert('betaScore 없는 끼니 제외', computeBetaMeal(partial), 0.995);

// 1-7. 음수 betaScore 필터링
assert('음수 betaScore 제외', computeBetaMeal([{ betaScore: -1 }, { betaScore: 0.5 }]), 0.95 + 0.5 * 0.075);

// ═══════════════════════════════════════
console.log('\n═══ 2. classifyMealType 시간대 분류 ═══');
// ═══════════════════════════════════════

assertEq('06:00 아침', classifyMealType('06:00'), 'breakfast');
assertEq('09:30 아침', classifyMealType('09:30'), 'breakfast');
assertEq('10:00 간식', classifyMealType('10:00'), 'snack');
assertEq('11:00 점심', classifyMealType('11:00'), 'lunch');
assertEq('13:59 점심', classifyMealType('13:59'), 'lunch');
assertEq('14:00 간식', classifyMealType('14:00'), 'snack');
assertEq('17:00 저녁', classifyMealType('17:00'), 'dinner');
assertEq('18:59 저녁', classifyMealType('18:59'), 'dinner');
assertEq('19:00 야식', classifyMealType('19:00'), 'lateNight');
assertEq('23:30 야식', classifyMealType('23:30'), 'lateNight');
assertEq('05:00 간식', classifyMealType('05:00'), 'snack');
assertEq('null → snack', classifyMealType(null), 'snack');
assertEq('빈 문자열', classifyMealType(''), 'snack');

// ═══════════════════════════════════════
console.log('\n═══ 3. calculateTargetCalories 칼로리 목표 ═══');
// ═══════════════════════════════════════

// 80kg 남성, 170cm, 35세
const maleProfile = { cw: 80, h: 1.70, age: 35, gender: 'male' };
const maleTarget = calculateTargetCalories(maleProfile);
// BMR = 10*80 + 6.25*170 - 5*35 + 5 = 800+1062.5-175+5 = 1692.5
// TDEE = 1693 * 1.2 = 2031
// Target = 2031 - 500 = 1531
assert('남성 BMR', maleTarget.bmr, 1693, 5);
assert('남성 TDEE', maleTarget.tdee, 2031, 5);
assert('남성 Target', maleTarget.target, 1531, 5);

// 55kg 여성, 160cm, 28세
const femaleProfile = { cw: 55, h: 1.60, age: 28, gender: 'female' };
const femaleTarget = calculateTargetCalories(femaleProfile);
// BMR = 10*55 + 6.25*160 - 5*28 - 161 = 550+1000-140-161 = 1249
// TDEE = 1249 * 1.2 = 1499
// Target = max(1200, 1499 - 500) = 1200 (최소값)
assert('여성 BMR', femaleTarget.bmr, 1249, 5);
assert('여성 Target ≥ 1200', femaleTarget.target, 1200, 5);

// 프로필 없을 때
assertEq('프로필 불완전', calculateTargetCalories({ cw: 0 }), null);

// ═══════════════════════════════════════
console.log('\n═══ 4. getMealBudget 끼니별 예산 ═══');
// ═══════════════════════════════════════

assert('아침 25%', getMealBudget(1600, 'breakfast'), 400);
assert('점심 40%', getMealBudget(1600, 'lunch'), 640);
assert('저녁 30%', getMealBudget(1600, 'dinner'), 480);
assert('간식 5%', getMealBudget(1600, 'snack'), 80);
assert('야식 0%', getMealBudget(1600, 'lateNight'), 0);

// ═══════════════════════════════════════
console.log('\n═══ 5. analyzeMealDay 일일 분석 ═══');
// ═══════════════════════════════════════

const dayMeals = [
  { time: '08:00', kcal: 400, macros: { protein: 25, carbs: 40, fat: 10 }, betaScore: 0.8 },
  { time: '12:30', kcal: 600, macros: { protein: 35, carbs: 60, fat: 15 }, betaScore: 0.7 },
  { time: '19:30', kcal: 300, macros: { protein: 10, carbs: 50, fat: 8 }, betaScore: 0.3 },
];
const analysis = analyzeMealDay(dayMeals, maleProfile);
assert('총 칼로리', analysis.totalKcal, 1300);
assertEq('끼니 수', analysis.mealCount, 3);
assert('총 단백질', analysis.totalProtein, 70);
assert('단백질 목표 (1.4g/kg)', analysis.proteinTarget, 112);
assert('단백질 갭', analysis.proteinGap, 42);
assertBool('야식 감지', analysis.hasLateNight, true);
assert('남은 칼로리', analysis.remaining, analysis.dailyTarget - 1300, 5);

// 야식 없는 케이스
const goodMeals = [
  { time: '08:00', kcal: 400, macros: { protein: 30, carbs: 30, fat: 10 }, betaScore: 0.9 },
  { time: '12:00', kcal: 550, macros: { protein: 40, carbs: 50, fat: 12 }, betaScore: 0.8 },
];
const goodAnalysis = analyzeMealDay(goodMeals, maleProfile);
assertBool('야식 없음', goodAnalysis.hasLateNight, false);
assertBool('고탄수 아님', goodAnalysis.isHighCarb, false);

// 고탄수화물 식단
const carbHeavy = [
  { time: '12:00', kcal: 800, macros: { protein: 10, carbs: 100, fat: 5 }, betaScore: 0.2 },
];
const carbAnalysis = analyzeMealDay(carbHeavy, maleProfile);
assertBool('고탄수 감지', carbAnalysis.isHighCarb, true);
assertBool('저단백 감지', carbAnalysis.isLowProtein, true);

// ═══════════════════════════════════════
console.log('\n═══ 6. calculateIMEM β_meal 통합 ═══');
// ═══════════════════════════════════════

const baseInput = {
  checks: [true, true, true, true, true, true, true, true, true, true],
  riskActive: [false, false, false, false, false, false, false, false],
  recoveryDone: [false, false, false, false, false, false, false, false],
  profile: { isDiabetic: 'no', exCount: 3 },
  sunset: { h: 19, m: 0 },
};

// 6-1. 식사 없이 → beta_meal = 1.0
const noMeal = calculateIMEM({ ...baseInput, meals: [] });
assert('식사 없이 beta_meal', noMeal.beta_meal, 1.0);

// beta_base = 1.025 * 1.025 = 1.051 (preload + seq + walk)
// beta_net = 1.051 * 1.0 = 1.051 (capped)
assert('식사 없이 beta_net', noMeal.beta_net, 1.051);

// 6-2. 좋은 식사 → beta_meal > 1.0
const goodMealInput = calculateIMEM({
  ...baseInput,
  meals: [{ betaScore: 0.9 }, { betaScore: 0.8 }],
});
// avg = 0.85, beta_meal = 0.95 + 0.85*0.075 = 1.014
assert('좋은 식사 beta_meal', goodMealInput.beta_meal, 1.014, 0.002);
// beta_base(1.051) * 1.014 = 1.066 → capped at 1.051
assert('좋은 식사 beta_net (상한)', goodMealInput.beta_net, 1.051);

// 6-3. 나쁜 식사 → beta_meal < 1.0 → beta_net 하락
const badMealInput = calculateIMEM({
  ...baseInput,
  meals: [{ betaScore: 0.1 }, { betaScore: 0.0 }],
});
// avg = 0.05, beta_meal = 0.95 + 0.05*0.075 = 0.954
assert('나쁜 식사 beta_meal', badMealInput.beta_meal, 0.954, 0.002);
// beta_base(1.051) * 0.954 = 1.003
assert('나쁜 식사 beta_net 하락', badMealInput.beta_net, 1.003, 0.005);

// 6-4. 루틴 미완료 + 나쁜 식사 → 하락 누적
const worstCase = calculateIMEM({
  ...baseInput,
  checks: [false, false, false, false, false, false, false, false, false, false],
  riskActive: [false, true, true, true, false, false, false, false],
  meals: [{ betaScore: 0.0 }],
});
// beta_base = 1.0 * 1.0 = 1.0
// beta_meal = 0.95
// beta_pen = 0.03 + 0.02 + 0.05 = 0.10
// beta_net = max(0.90, 1.0 * 0.95 - 0.10) = max(0.90, 0.85) = 0.90
assert('최악 beta_net (하한)', worstCase.beta_net, 0.90);

// 6-5. totalEfficiency 검증
const eff = totalEfficiency(noMeal);
const expected = noMeal.alpha_net * noMeal.beta_net * noMeal.gamma_net;
assert('totalEfficiency', eff, expected);

// 6-6. 식사 있을 때와 없을 때 efficiency 차이
const withMeals = calculateIMEM({
  ...baseInput,
  checks: [true, false, false, true, true, true, true, true, true, true],
  meals: [{ betaScore: 0.0 }],
});
const withoutMeals = calculateIMEM({
  ...baseInput,
  checks: [true, false, false, true, true, true, true, true, true, true],
  meals: [],
});
console.log(`  📊 식사 없음 beta_net=${withoutMeals.beta_net}, 나쁜 식사 beta_net=${withMeals.beta_net}`);
assertBool('나쁜 식사가 beta_net 낮춤', withMeals.beta_net < withoutMeals.beta_net, true);

// ═══════════════════════════════════════
console.log('\n═══ 7. 경계값 테스트 ═══');
// ═══════════════════════════════════════

// betaScore 범위 밖 처리
assert('betaScore 1.5 (초과)', computeBetaMeal([{ betaScore: 1.5 }]), 0.95 + 1.5 * 0.075);
// → 1.0625 — 클램프 없음 (computeBetaMeal 자체에는 없고, calculateIMEM의 beta_net에서 상한 적용)

// 빈 macros
const emptyMacros = analyzeMealDay([{ time: '12:00', kcal: 500 }], maleProfile);
assert('macros 없어도 동작', emptyMacros.totalKcal, 500);
assert('macros 없으면 단백질 0', emptyMacros.totalProtein, 0);

// ═══════════════════════════════════════
console.log('\n═══ 결과 ═══');
console.log(`총 ${passed + failed}개 테스트: ✅ ${passed} 통과, ❌ ${failed} 실패\n`);
process.exit(failed > 0 ? 1 : 0);
