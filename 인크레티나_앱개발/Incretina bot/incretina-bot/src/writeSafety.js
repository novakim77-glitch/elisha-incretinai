// writeSafety.js — Firestore 쓰기 안정성 공통 유틸
// 봇 → 앱 데이터 전달 경로(식사/체중/루틴) 전체의 재시도 계층.
// store.js 자체는 건드리지 않고(배치 검증 보존), 호출 측에서 감싸 사용합니다.

const RETRYABLE_CODES = new Set([
  4,  // DEADLINE_EXCEEDED
  8,  // RESOURCE_EXHAUSTED
  10, // ABORTED
  13, // INTERNAL
  14, // UNAVAILABLE
]);
const RETRYABLE_PATTERN = /unavailable|deadline|internal|network|timeout|fetch[ _]failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i;

function isRetryable(e) {
  if (!e) return false;
  if (typeof e.code === 'number' && RETRYABLE_CODES.has(e.code)) return true;
  const msg = (e.message || e.details || '').toString();
  return RETRYABLE_PATTERN.test(msg);
}

/**
 * Firestore 쓰기를 재시도로 감쌉니다.
 * - 멱등성 있는 set/batch 쓰기에만 사용 (read-modify-write도 내부에서 다시 읽으므로 안전)
 * - 일시 오류만 재시도, 영구 오류(권한/유효성)는 즉시 throw
 * Backoff: 250ms → 500ms → 1000ms
 */
async function withRetry(fn, label = 'write', maxAttempts = 3) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await fn();
      if (i > 0) console.log(`[writeSafety] ${label} recovered on attempt ${i + 1}`);
      return result;
    } catch (e) {
      lastErr = e;
      const canRetry = isRetryable(e) && i < maxAttempts - 1;
      if (!canRetry) {
        if (i > 0) console.error(`[writeSafety] ${label} exhausted after ${i + 1} attempts`);
        break;
      }
      const delay = 250 * Math.pow(2, i);
      console.warn(`[writeSafety] ${label} attempt ${i + 1}/${maxAttempts} failed: ${e.message || 'unknown'} — retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * 쓰기 실패를 best-effort로 처리 — 성공 여부만 반환, 절대 throw 하지 않음.
 * 부가 작업(자동 루틴 매핑, 알림 로그 등)에 사용.
 */
async function tryWrite(fn, label = 'write') {
  try {
    await withRetry(fn, label);
    return { ok: true };
  } catch (e) {
    console.warn(`[writeSafety] ${label} failed non-fatally:`, e.message || e);
    return { ok: false, error: e.message || 'unknown' };
  }
}

module.exports = { withRetry, tryWrite, isRetryable };
