// Sanity tests for IMEM core. Run: node packages/imem-core/test.js
const {
  calculateIMEM,
  totalEfficiency,
  calculateSunTimes,
  calculateScore,
  getUserWeek,
  getUnlockedRoutineIndices,
  getUnlockedMaxScore,
  getWeightPrediction,
  buildIMEMContext,
} = require('./');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = Math.abs(got - want) < 1e-6;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}: got ${got}, want ${want}`); }
}

const empty = {
  checks: Array(10).fill(false),
  riskActive: Array(8).fill(false),
  recoveryDone: Array(8).fill(false),
  profile: { isDiabetic: 'no', exCount: 0 },
  sunset: { h: 18, m: 47 },
  isNightMode: false,
};

console.log('\n[1] Baseline (nothing checked, day mode)');
let r = calculateIMEM(empty);
eq('alpha_net', r.alpha_net, 1.00);
eq('beta_net',  r.beta_net,  1.00);
eq('gamma_net', r.gamma_net, 1.00);

console.log('\n[2] Sunset close before 19:00 (1140m) → α=1.05');
r = calculateIMEM({ ...empty, checks: Object.assign(Array(10).fill(false), { 6: true }), sunset: { h: 18, m: 47 } });
eq('alpha_net', r.alpha_net, 1.05);

console.log('\n[3] Sunset close at/after 19:00 → α=1.10');
r = calculateIMEM({ ...empty, checks: Object.assign(Array(10).fill(false), { 6: true }), sunset: { h: 19, m: 30 } });
eq('alpha_net', r.alpha_net, 1.10);

console.log('\n[4] α full bonus stack: 6 + 0 + (8&9) → 1.10+0.02+0.02=1.14');
r = calculateIMEM({ ...empty,
  checks: Object.assign(Array(10).fill(false), { 0: true, 6: true, 8: true, 9: true }),
  sunset: { h: 19, m: 30 },
});
eq('alpha_net', r.alpha_net, 1.14);

console.log('\n[5] β preload + sequence + walk → 1.025 * 1.025 ≈ 1.051');
r = calculateIMEM({ ...empty, checks: Object.assign(Array(10).fill(false), { 3: true, 4: true, 5: true }) });
eq('beta_net', r.beta_net, 1.051);

console.log('\n[6] γ diabetic + 3+ exercise + check[7] → 0.85*(1+0.05)=0.89');
r = calculateIMEM({ ...empty,
  profile: { isDiabetic: 'yes', exCount: 3 },
  checks: Object.assign(Array(10).fill(false), { 7: true }),
});
eq('gamma_net', r.gamma_net, 0.89);

console.log('\n[7] α penalty: night-eat (R-07) → 1.00 - 0.20 → clamp 0.80');
r = calculateIMEM({ ...empty, riskActive: Object.assign(Array(8).fill(false), { 6: true }) });
eq('alpha_net', r.alpha_net, 0.80);
eq('alpha_penalty', r.alpha_penalty, 0.20);

console.log('\n[8] α recovery on R-07: -0.20 + 0.20*0.40 = -0.12 → 0.88');
r = calculateIMEM({ ...empty,
  riskActive: Object.assign(Array(8).fill(false), { 6: true }),
  recoveryDone: Object.assign(Array(8).fill(false), { 6: true }),
});
eq('alpha_net', r.alpha_net, 0.88);

console.log('\n[9] α clamp lower bound 0.75');
r = calculateIMEM({ ...empty,
  riskActive: Object.assign(Array(8).fill(false), { 0: true, 5: true, 6: true, 7: true }),
});
eq('alpha_net', r.alpha_net, 0.75);

console.log('\n[10] biosync — Seoul lat 37.5 returns plausible sunrise/sunset');
const sun = calculateSunTimes(37.5, new Date('2026-06-21'));
const ok = sun.sunrise.h >= 4 && sun.sunrise.h <= 6 && sun.sunset.h >= 18 && sun.sunset.h <= 20;
if (ok) { pass++; console.log(`  ✓ Seoul summer solstice: ${sun.sunrise.h}:${sun.sunrise.m} → ${sun.sunset.h}:${sun.sunset.m}`); }
else { fail++; console.log(`  ✗ Seoul: got ${JSON.stringify(sun)}`); }

// ─────────────── Score & Unlocking ───────────────
console.log('\n[11] getUserWeek: 7+ history days → week 4');
{ const got = getUserWeek({ historyDays: 10 });
  if (got === 4) { pass++; console.log('  ✓ week=4'); } else { fail++; console.log(`  ✗ ${got}`); } }

console.log('\n[12] getUserWeek: no startDate, no history → week 1');
{ const got = getUserWeek({});
  if (got === 1) { pass++; console.log('  ✓ week=1'); } else { fail++; console.log(`  ✗ ${got}`); } }

console.log('\n[13] getUserWeek: 15 days since start → week 3');
{ const start = new Date(); start.setDate(start.getDate() - 15);
  const got = getUserWeek({ userStartDate: start });
  if (got === 3) { pass++; console.log('  ✓ week=3'); } else { fail++; console.log(`  ✗ ${got}`); } }

console.log('\n[14] week-1 unlocked = [3,4,5], maxScore = 12+13+13 = 38');
{ const idx = getUnlockedRoutineIndices(1);
  const max = getUnlockedMaxScore(1);
  const ok = idx.length === 3 && idx.includes(3) && idx.includes(4) && idx.includes(5) && max === 38;
  if (ok) { pass++; console.log(`  ✓ [${idx}], max=${max}`); } else { fail++; console.log(`  ✗ [${idx}], max=${max}`); } }

console.log('\n[15] week-4 unlocked = all 10');
{ const idx = getUnlockedRoutineIndices(4);
  if (idx.length === 10) { pass++; console.log('  ✓ all 10'); } else { fail++; console.log(`  ✗ ${idx.length}`); } }

console.log('\n[16] calculateScore: week-1, all 3 unlocked checked → 100');
{ const s = calculateScore({
    checks: Object.assign(Array(10).fill(false), { 3: true, 4: true, 5: true }),
    riskActive: Array(8).fill(false),
    recoveryDone: Array(8).fill(false),
    week: 1,
  });
  eq('score', s, 100); }

console.log('\n[17] calculateScore: week-1, none checked → 0');
{ const s = calculateScore({
    checks: Array(10).fill(false), riskActive: Array(8).fill(false),
    recoveryDone: Array(8).fill(false), week: 1,
  });
  eq('score', s, 0); }

console.log('\n[18] calculateScore: week-4, all checked, no risks → 100');
{ const s = calculateScore({
    checks: Array(10).fill(true), riskActive: Array(8).fill(false),
    recoveryDone: Array(8).fill(false), week: 4,
  });
  eq('score', s, 100); }

console.log('\n[19] calculateScore: week-4, all checked + R-07 야식 (-20) → ~80');
{ const s = calculateScore({
    checks: Array(10).fill(true),
    riskActive: Object.assign(Array(8).fill(false), { 6: true }),
    recoveryDone: Array(8).fill(false), week: 4,
  });
  // raw = 100 - 20 = 80 / 100 → 80
  eq('score', s, 80); }

console.log('\n[20] calculateScore: floor at -20');
{ const s = calculateScore({
    checks: Array(10).fill(false),
    riskActive: Array(8).fill(true),
    recoveryDone: Array(8).fill(false), week: 4,
  });
  if (s === -20) { pass++; console.log('  ✓ floored at -20'); } else { fail++; console.log(`  ✗ ${s}`); } }

// ─────────────── Prediction ───────────────
console.log('\n[21] prediction: baseline IMEM=1.0, score=100 → -2.0kg over 4w');
{ const p = getWeightPrediction({
    imem: { alpha_net: 1, beta_net: 1, gamma_net: 1 },
    score: 100,
    profile: { cw: 80, h: 1.7, age: 35, gender: 'male' },
  });
  // weeklyDelta = -0.5 * 1 * 1 = -0.5; 4w = -2.0; predicted = 78.0
  eq('predicted', p.predicted, 78.0);
  eq('delta', p.delta, -2.0); }

console.log('\n[22] prediction: bad inputs → null');
{ const p = getWeightPrediction({
    imem: { alpha_net: 1, beta_net: 1, gamma_net: 1 },
    score: 50,
    profile: { cw: 0, h: 1.7, age: 35, gender: 'male' },
  });
  if (p === null) { pass++; console.log('  ✓ null'); } else { fail++; console.log(`  ✗ ${JSON.stringify(p)}`); } }

console.log('\n[23] prediction: low score floors compliance at 0.3');
{ const p = getWeightPrediction({
    imem: { alpha_net: 1, beta_net: 1, gamma_net: 1 },
    score: 10,  // 0.10 → floored to 0.30
    profile: { cw: 80, h: 1.7, age: 35, gender: 'male' },
  });
  // weeklyDelta = -0.5 * 1 * 0.3 = -0.15; 4w = -0.6; predicted = 79.4
  eq('predicted', p.predicted, 79.4); }

// ─────────────── Context Builder ───────────────
console.log('\n[24] buildIMEMContext: shape & key fields');
{ const ctx = buildIMEMContext({
    profile: { h: 1.7, cw: 80, gw: 72, age: 35, gender: 'male',
               isDiabetic: 'no', exCount: 3, lat: 37.5, persona: 'clinical' },
    today: {
      checks:       Object.assign(Array(10).fill(false), { 3: true, 4: true, 5: true }),
      riskActive:   Array(8).fill(false),
      recoveryDone: Array(8).fill(false),
    },
    historyDays: 10,
    now: new Date('2026-06-21T12:00:00'),
  });
  const okShape =
    typeof ctx.alpha === 'number' &&
    typeof ctx.beta === 'number' &&
    typeof ctx.gamma === 'number' &&
    typeof ctx.totalEfficiency === 'number' &&
    Array.isArray(ctx.completedRoutines) &&
    Array.isArray(ctx.pendingRoutines) &&
    ctx.persona === 'clinical' &&
    ctx.week === 4 &&
    ctx.diabeticType === 'no';
  if (okShape) { pass++; console.log(`  ✓ shape OK (α=${ctx.alpha} β=${ctx.beta} γ=${ctx.gamma} score=${ctx.score} sunset=${ctx.sunset})`); }
  else { fail++; console.log('  ✗', JSON.stringify(ctx, null, 2)); } }

console.log('\n[25] buildIMEMContext: completed/pending mutually exclusive & total = 10');
{ const ctx = buildIMEMContext({
    profile: { h: 1.7, cw: 80, gw: 72, age: 35, gender: 'male',
               isDiabetic: 'no', exCount: 0, lat: 37.5 },
    today: {
      checks:       Object.assign(Array(10).fill(false), { 0: true, 3: true, 6: true }),
      riskActive:   Array(8).fill(false),
      recoveryDone: Array(8).fill(false),
    },
    historyDays: 10,
  });
  const ok = ctx.completedRoutines.length === 3 &&
             ctx.pendingRoutines.length === 7 &&
             (ctx.completedRoutines.length + ctx.pendingRoutines.length) === 10;
  if (ok) { pass++; console.log('  ✓ 3 completed / 7 pending'); }
  else { fail++; console.log(`  ✗ ${ctx.completedRoutines.length}/${ctx.pendingRoutines.length}`); } }

// ─────────────── Schema v2 ───────────────
const { schema } = require('./');
const { SOURCE, EVENT, PERSONA, paths, makeMeta, makeEvent, makeLinkCode, detectSchemaVersion, SCHEMA_VERSION } = schema;

console.log('\n[26] schema: paths build correctly');
{ const ok = paths.user('u1') === 'users/u1'
          && paths.dailyRoutine('u1', '2026-04-07') === 'users/u1/dailyRoutines/2026-04-07'
          && paths.event('u1', 'evt1') === 'users/u1/events/evt1'
          && paths.linkCode('482917') === 'linkCodes/482917';
  if (ok) { pass++; console.log('  ✓ paths OK'); } else { fail++; console.log('  ✗ paths'); } }

console.log('\n[27] makeMeta: includes schemaVersion=2 and source');
{ const m = makeMeta(SOURCE.WEB_APP, new Date('2026-04-07T10:00:00Z'));
  const ok = m.schemaVersion === 2 && m.source === 'web_app' && m.createdAt && m.updatedAt;
  if (ok) { pass++; console.log('  ✓'); } else { fail++; console.log('  ✗', m); } }

console.log('\n[28] makeMeta: rejects invalid source');
{ let threw = false;
  try { makeMeta('hacker_console'); } catch (e) { threw = true; }
  if (threw) { pass++; console.log('  ✓ throws'); } else { fail++; console.log('  ✗ accepted bad source'); } }

console.log('\n[29] makeEvent: well-formed routine_check event');
{ const e = makeEvent({
    type: EVENT.ROUTINE_CHECK,
    date: '2026-04-07',
    source: SOURCE.TELEGRAM_BOT,
    payload: { index: 3, value: true, prevValue: false },
    now: new Date('2026-04-07T11:30:00Z'),
  });
  const ok = e.type === 'routine_check' && e.source === 'telegram_bot'
          && e.imemVersion === '2.0.0' && e.payload.index === 3
          && e._meta.schemaVersion === 2;
  if (ok) { pass++; console.log('  ✓'); } else { fail++; console.log('  ✗', e); } }

console.log('\n[30] makeEvent: rejects invalid event type');
{ let threw = false;
  try { makeEvent({ type: 'free_beer', date: '2026-04-07', source: SOURCE.WEB_APP, payload: {} }); }
  catch (e) { threw = true; }
  if (threw) { pass++; console.log('  ✓ throws'); } else { fail++; console.log('  ✗'); } }

console.log('\n[31] makeEvent: rejects malformed date');
{ let threw = false;
  try { makeEvent({ type: EVENT.WEIGHT_LOG, date: '2026/04/07', source: SOURCE.WEB_APP, payload: {} }); }
  catch (e) { threw = true; }
  if (threw) { pass++; console.log('  ✓ throws'); } else { fail++; console.log('  ✗'); } }

console.log('\n[32] makeLinkCode: 6-digit code with 5-min TTL');
{ const { code, doc } = makeLinkCode('uid-abc', new Date('2026-04-07T10:00:00Z'));
  const ttlMs = doc.expiresAt - doc.createdAt;
  const ok = /^\d{6}$/.test(code) && ttlMs === 5 * 60 * 1000 && doc.uid === 'uid-abc' && doc.used === false;
  if (ok) { pass++; console.log(`  ✓ code=${code}`); } else { fail++; console.log('  ✗', { code, doc }); } }

console.log('\n[33] detectSchemaVersion: v1 (no _meta) → 1, v2 → 2');
{ const v1 = detectSchemaVersion({ checks: [] });
  const v2 = detectSchemaVersion({ _meta: { schemaVersion: 2 } });
  if (v1 === 1 && v2 === 2) { pass++; console.log('  ✓'); } else { fail++; console.log(`  ✗ v1=${v1} v2=${v2}`); } }

console.log('\n[34] enums: SCHEMA_VERSION=2, all personas listed');
{ const ok = SCHEMA_VERSION === 2 && PERSONA.CLINICAL === 'clinical' && Object.values(PERSONA).length === 3;
  if (ok) { pass++; console.log('  ✓'); } else { fail++; console.log('  ✗'); } }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
