/**
 * Sync Logic Verification Tests
 *
 * 앱↔봇 Firestore 동기화 로직의 핵심 시나리오를 검증합니다.
 * 실행: node test-sync-logic.js
 *
 * Firestore 없이 순수 로직만 테스트 (unit test).
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

// ─── _normalizeMap 재구현 (앱과 동일) ───
function _normalizeMap(raw, len) {
  if (!raw) return new Array(len).fill(false);
  if (Array.isArray(raw)) {
    const a = [...raw];
    while (a.length < len) a.push(false);
    return a.map((v) => !!v);
  }
  const a = new Array(len).fill(false);
  Object.entries(raw).forEach(([k, v]) => {
    const i = Number(k);
    if (i >= 0 && i < len) a[i] = !!v;
  });
  return a;
}

// ─── saveDailyToCloud 로직 시뮬레이션 (수정 후 — dot notation) ───
function simulateSaveDailyToCloud_NEW(touched, domState, touchedRisks, riskDomState, recDomState) {
  const data = { score: 50, _source: 'app' };
  // dot notation: "checks.0", "checks.1" 등으로 개별 키만 전송
  touched.forEach((i) => {
    data['checks.' + i] = domState[i] || false;
  });
  touchedRisks.forEach((i) => {
    data['riskChecks.' + i] = riskDomState[i] || false;
    data['recoveries.' + i] = recDomState[i] || false;
  });
  return data;
}

// ─── saveDailyToCloud 로직 시뮬레이션 (수정 전 — 기존 방식) ───
function simulateSaveDailyToCloud_OLD(touched, domState, cloudChecks, len) {
  const checks = _normalizeMap(cloudChecks, len);
  touched.forEach((i) => {
    checks[i] = domState[i] || false;
  });
  return { checks }; // 전체 배열 반환
}

// ─── Firestore merge:true 시뮬레이션 ───
// Firestore의 실제 동작: set({merge:true})에서
// - 일반 필드 (checks: {...}): 해당 필드 전체를 교체 (deep merge 아님!)
// - dot notation 필드 (checks.0: true): 해당 키만 업데이트, 나머지 보존
function firebaseMerge(existing, incoming) {
  const result = JSON.parse(JSON.stringify(existing)); // deep clone
  for (const [key, val] of Object.entries(incoming)) {
    if (key.includes('.')) {
      // dot notation: "checks.0" → result.checks["0"] = val
      const parts = key.split('.');
      const parent = parts[0];
      const child = parts[1];
      if (!result[parent] || typeof result[parent] !== 'object') {
        result[parent] = {};
      }
      result[parent][child] = val;
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      // nested object without dot notation → REPLACES entire field (Firestore 실제 동작)
      result[key] = val;
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ─── freshClick 가드 시뮬레이션 ───
function simulateLoadDateData_NEW(cloudChecks, domState, freshClick, touchedRoutines, len) {
  const checksArr = _normalizeMap(cloudChecks, len);
  const result = [...domState];
  for (let i = 0; i < len; i++) {
    const cloudVal = checksArr[i];
    const domVal = domState[i];
    if (freshClick && touchedRoutines.has(i) && cloudVal !== domVal) continue; // skip
    result[i] = cloudVal;
  }
  return result;
}

function simulateLoadDateData_OLD(cloudChecks, domState, freshClick, len) {
  const checksArr = _normalizeMap(cloudChecks, len);
  const result = [...domState];
  for (let i = 0; i < len; i++) {
    const cloudVal = checksArr[i];
    const domVal = domState[i];
    if (freshClick && cloudVal !== domVal) continue; // skip ALL mismatched
    result[i] = cloudVal;
  }
  return result;
}

// ========================================
console.log('\n═══ Test Suite: Sync Logic Verification ═══\n');

// ─── 1. _normalizeMap 호환성 ───
console.log('1️⃣  _normalizeMap: map/array 양방향 호환');
{
  const fromMap = _normalizeMap({ 0: true, 3: true }, 5);
  assert(fromMap[0] === true && fromMap[3] === true && fromMap[1] === false, 'map → array 변환');

  const fromArr = _normalizeMap([true, false, false, true], 5);
  assert(fromArr[0] === true && fromArr[3] === true && fromArr[4] === false, 'array → array 변환 + 패딩');

  const fromNull = _normalizeMap(null, 3);
  assert(fromNull.length === 3 && fromNull.every((v) => v === false), 'null → false 배열');

  const fromEmpty = _normalizeMap({}, 3);
  assert(fromEmpty.length === 3 && fromEmpty.every((v) => v === false), 'empty map → false 배열');
}

// ─── 2. Phase A: 봇 데이터 보존 (핵심 시나리오) ───
console.log('\n2️⃣  Phase A: 봇이 쓴 checks를 앱이 덮어쓰지 않음');
{
  // 시나리오: 봇이 index 3을 체크 → 앱에서 index 0을 체크
  const firestoreState = { checks: { 3: true } }; // 봇이 쓴 상태

  // 앱: 사용자가 index 0만 터치
  const touched = new Set([0]);
  const domState = [true, false, false, false, false]; // index 0 = true

  const appWrite = simulateSaveDailyToCloud_NEW(touched, domState, new Set(), [], []);
  // 앱이 보내는 데이터: { "checks.0": true } (dot notation)
  assert(appWrite['checks.0'] === true, '앱은 dot notation으로 index 0만 전송');
  assert(appWrite['checks.3'] === undefined, 'index 3은 전송하지 않음 (봇 데이터 보존)');

  // Firestore merge 시뮬레이션
  const afterMerge = firebaseMerge(firestoreState, appWrite);
  assert(afterMerge.checks['3'] === true, 'merge 후 봇의 index 3 보존됨 ✓');
  assert(afterMerge.checks['0'] === true, 'merge 후 앱의 index 0 반영됨 ✓');
}

// ─── 3. 기존 방식(OLD)에서 봇 데이터 유실 재현 ───
console.log('\n3️⃣  기존 방식: 봇 데이터 유실 재현');
{
  // 봇이 index 3을 체크했지만 앱 캐시에 아직 미반영
  const staleCloudChecks = {}; // 캐시가 오래됨
  const touched = new Set([0]);
  const domState = [true, false, false, false, false];

  const oldWrite = simulateSaveDailyToCloud_OLD(touched, domState, staleCloudChecks, 5);
  // 기존 방식: 전체 배열 [true, false, false, false, false] 전송
  assert(Array.isArray(oldWrite.checks), '기존: 전체 배열 전송');
  assert(oldWrite.checks[3] === false, '기존: 봇의 index 3이 false로 덮어써짐 (버그 재현)');

  // Firestore merge: 배열은 atomic → 전체 교체
  const firestoreState = { checks: { 3: true } };
  const afterMerge = firebaseMerge(firestoreState, oldWrite);
  assert(Array.isArray(afterMerge.checks), '기존: merge 후 checks가 배열로 교체됨');
  assert(afterMerge.checks[3] === false, '기존: 봇 데이터 유실 확인 (버그)');
}

// ─── 4. Phase B: freshClick 가드 — 봇 업데이트 즉시 반영 ───
console.log('\n4️⃣  Phase B: freshClick 시 봇 업데이트 반영');
{
  // 봇이 index 3 체크, 사용자가 index 0 방금 클릭 (freshClick=true)
  const cloudChecks = { 0: false, 3: true }; // 봇이 3을 true로 씀, 0은 아직 false
  const domState = [true, false, false, false, false]; // 사용자가 0을 true로 변경
  const touchedRoutines = new Set([0]);

  const newResult = simulateLoadDateData_NEW(cloudChecks, domState, true, touchedRoutines, 5);
  assert(newResult[0] === true, 'NEW: 사용자가 터치한 index 0은 DOM 값 유지');
  assert(newResult[3] === true, 'NEW: 봇이 쓴 index 3은 cloud에서 즉시 반영 ✓');

  const oldResult = simulateLoadDateData_OLD(cloudChecks, domState, true, 5);
  assert(oldResult[0] === true, 'OLD: index 0 DOM 값 유지 (동일)');
  assert(oldResult[3] === false, 'OLD: index 3도 mismatch로 skip됨 (버그 — 봇 업데이트 차단)');
}

// ─── 5. Phase C: 빈 touched-set → 저장 방지 ───
console.log('\n5️⃣  Phase C: touched-set 비어있으면 checks 전송 안 함');
{
  const touched = new Set(); // 아무것도 안 터치
  const domState = [false, false, false, false, false];
  const appWrite = simulateSaveDailyToCloud_NEW(touched, domState, new Set(), [], []);
  const hasChecksKey = Object.keys(appWrite).some(k => k.startsWith('checks.'));
  assert(!hasChecksKey, 'checks dot notation 키 없음 → Firestore에 checks 쓰기 안 함');
  assert(appWrite._source === 'app', '_source 태그 존재');
}

// ─── 6. 복합 시나리오: 봇 + 앱 동시 작업 ───
console.log('\n6️⃣  복합: 봇이 3,5를 체크 → 앱에서 0,1을 체크');
{
  let firestoreState = { checks: { 3: true, 5: true } }; // 봇이 먼저 씀

  const touched = new Set([0, 1]);
  const domState = [true, true, false, false, false, false, false, false, false, false];
  const appWrite = simulateSaveDailyToCloud_NEW(touched, domState, new Set(), [], []);
  // appWrite = { "checks.0": true, "checks.1": true, ... }

  const afterMerge = firebaseMerge(firestoreState, appWrite);
  assert(afterMerge.checks[0] === true || afterMerge.checks['0'] === true, '앱의 index 0 반영');
  assert(afterMerge.checks[1] === true || afterMerge.checks['1'] === true, '앱의 index 1 반영');
  assert(afterMerge.checks[3] === true || afterMerge.checks['3'] === true, '봇의 index 3 보존');
  assert(afterMerge.checks[5] === true || afterMerge.checks['5'] === true, '봇의 index 5 보존');
}

// ─── 7. 앱이 루틴을 끈 경우 (uncheck) ───
console.log('\n7️⃣  앱에서 루틴 해제: touched 인덱스의 false도 정확히 저장');
{
  let firestoreState = { checks: { 0: true, 3: true } };

  // 사용자가 index 0을 끔
  const touched = new Set([0]);
  const domState = [false]; // index 0 = false
  const appWrite = simulateSaveDailyToCloud_NEW(touched, domState, new Set(), [], []);

  const afterMerge = firebaseMerge(firestoreState, appWrite);
  assert(afterMerge.checks[0] === false || afterMerge.checks['0'] === false, '앱이 끈 index 0 = false 반영');
  assert(afterMerge.checks[3] === true || afterMerge.checks['3'] === true, '봇의 index 3 보존');
}

// ─── 8. 봇이 checks를 map으로 쓰고 앱이 map으로 읽기 ───
console.log('\n8️⃣  봇 map → _normalizeMap → 앱 UI 정상 표시');
{
  // 봇이 쓴 sparse map (일부 인덱스만)
  const botChecks = { 2: true, 7: true };
  const arr = _normalizeMap(botChecks, 10);
  assert(arr.length === 10, '배열 길이 10');
  assert(arr[2] === true && arr[7] === true, '봇이 쓴 인덱스 true');
  assert(arr[0] === false && arr[5] === false, '나머지 false');
}

// ─── 9. Risk checks도 동일한 map 방식 ───
console.log('\n9️⃣  riskChecks/recoveries도 dot notation 보존');
{
  let firestoreState = { riskChecks: { 2: true }, recoveries: { 2: true } };

  const touchedRisks = new Set([5]);
  const riskDom = [false, false, false, false, false, true, false, false];
  const recDom = [false, false, false, false, false, true, false, false];
  const appWrite = simulateSaveDailyToCloud_NEW(new Set(), [], touchedRisks, riskDom, recDom);
  // appWrite = { "riskChecks.5": true, "recoveries.5": true, ... }

  const afterMerge = firebaseMerge(firestoreState, appWrite);
  assert(afterMerge.riskChecks[2] === true || afterMerge.riskChecks['2'] === true, '기존 risk index 2 보존');
  assert(afterMerge.riskChecks[5] === true || afterMerge.riskChecks['5'] === true, '앱의 risk index 5 반영');
  assert(afterMerge.recoveries[2] === true || afterMerge.recoveries['2'] === true, '기존 recovery 보존');
  assert(afterMerge.recoveries[5] === true || afterMerge.recoveries['5'] === true, '앱의 recovery 반영');
}

// ─── 10. 레거시 배열 데이터 하위 호환 ───
console.log('\n🔟  레거시: 기존 배열 데이터 읽기 호환');
{
  // Firestore에 이미 배열로 저장된 레거시 데이터
  const legacyChecks = [true, false, true, false, false];
  const arr = _normalizeMap(legacyChecks, 5);
  assert(arr[0] === true && arr[2] === true, '레거시 배열 데이터 정상 읽기');
  assert(arr[1] === false && arr[3] === false, '레거시 false 값도 정상');

  // 레거시 데이터 위에 새 map 방식 쓰기
  // Firestore merge: 배열 위에 map을 merge하면?
  // → Firestore는 배열을 map으로 교체함 (merge:true이므로 checks 필드 자체가 교체)
  // 하지만 우리는 touched 인덱스만 보내므로 문제없음
  const touched = new Set([4]);
  const domState = [true, false, true, false, true];
  const appWrite = simulateSaveDailyToCloud_NEW(touched, domState, new Set(), [], []);
  // dot notation: "checks.4" = true → 레거시 배열도 map으로 자동 변환됨
  assert(appWrite['checks.4'] === true, '레거시 위에 dot notation 쓰기 가능');
}

// ─── 11. date 변경 시 touched-set 리셋 후 안전성 ───
console.log('\n1️⃣1️⃣  날짜 변경 후 touched-set 빈 상태 → 불필요한 저장 없음');
{
  // 날짜 변경 → touched 리셋
  const touched = new Set(); // 비어있음
  const touchedRisks = new Set();
  const domState = [false, false, false, false, false];
  const appWrite = simulateSaveDailyToCloud_NEW(touched, domState, touchedRisks, [], []);
  const hasChecks = Object.keys(appWrite).some(k => k.startsWith('checks.'));
  const hasRisks = Object.keys(appWrite).some(k => k.startsWith('riskChecks.'));
  assert(!hasChecks, 'touched 빈 상태: checks 미전송');
  assert(!hasRisks, 'touched 빈 상태: riskChecks 미전송');
}

// ─── 결과 ───
console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`);
if (failed > 0) {
  console.error('\n⚠️  FAILURES DETECTED — review above');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
}
