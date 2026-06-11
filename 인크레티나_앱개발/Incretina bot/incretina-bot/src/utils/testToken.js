// src/utils/testToken.js
// 인크레틴 코드 테스트 결과 토큰 디코더
// 토큰 인코딩: IncretinAi_Test.html의 encodeTestToken()
// 형식: Base64URL({ t, s:[a,b,g], d:unixTimestamp, v:1 })
// 텔레그램 start payload: https://t.me/<bot>?start=ti_<token>

const TYPE_FULL = { a: 'alpha', b: 'beta', g: 'gamma', x: 'balanced' };

/**
 * 토큰 문자열을 디코딩하여 테스트 결과를 반환한다.
 * @param {string} token - Base64URL 인코딩된 토큰 (ti_ prefix 제거 후)
 * @returns {{ type: string, scores: { alpha: number, beta: number, gamma: number }, takenAt: Date }}
 * @throws {Error} 형식 오류 또는 만료 시
 */
function decodeTestToken(token) {
  if (!token || typeof token !== 'string') throw new Error('invalid token');

  // Base64URL → 표준 Base64 변환
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - token.length % 4) % 4);

  let payload;
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    payload = JSON.parse(json);
  } catch (e) {
    throw new Error('token decode failed');
  }

  // 형식 검증
  if (!payload.t || !TYPE_FULL[payload.t]) throw new Error('invalid type');
  if (!Array.isArray(payload.s) || payload.s.length !== 3) throw new Error('invalid scores');
  if (payload.v !== 1) throw new Error('unsupported version');

  // 점수 범위 검증 (0~100)
  for (const score of payload.s) {
    if (typeof score !== 'number' || score < 0 || score > 100) {
      throw new Error('score out of range');
    }
  }

  // 만료 검증 — 30일
  const ageSecs = Date.now() / 1000 - (payload.d || 0);
  if (ageSecs > 30 * 24 * 3600) throw new Error('token expired');

  return {
    type: TYPE_FULL[payload.t],
    scores: {
      alpha: payload.s[0],
      beta:  payload.s[1],
      gamma: payload.s[2],
    },
    takenAt: new Date((payload.d || 0) * 1000),
  };
}

module.exports = { decodeTestToken };
