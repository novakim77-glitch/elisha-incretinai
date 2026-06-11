// recovery-sanitize.js — Claude 응답에서 체중 수치 노출 방지
// Phase 1 회복 코칭 원칙: "봇은 체중 숫자를 대화에서 절대 언급하지 않는다"
// Claude 응답 텍스트를 통과시켜 수치를 "그 수치"로 대체한다.
//
// 대상: 30kg 이상 체중 수치 (예: 72.5kg, 84 kg, 100킬로)
// 비대상: 단백질/식이 소량 수치 (예: 1.5g, 200kcal)

const WEIGHT_PATTERN = /\b([3-9]\d|1\d{2}|2[0-4]\d|250)(\.\d{1,2})?\s*(kg|킬로그램|킬로|키로그램|키로)\b/gi;

/**
 * Claude 응답 텍스트에서 체중 수치를 "그 수치"로 대체한다.
 * @param {string} text - Claude 응답 원문
 * @returns {string} 수치가 대체된 텍스트
 */
function sanitizeResponse(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(WEIGHT_PATTERN, '그 수치');
}

module.exports = { sanitizeResponse };
