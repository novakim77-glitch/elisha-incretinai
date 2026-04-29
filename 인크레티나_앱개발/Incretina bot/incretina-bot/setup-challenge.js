/**
 * 챌린지 Firestore 설정 스크립트
 * 사용법: node setup-challenge.js
 *
 * challenges/weekly-challenge 문서를 생성합니다.
 * 이미 존재하면 업데이트합니다.
 */

require('dotenv').config();
const { initFirebase } = require('./src/firebase');
const { db } = require('./src/firebase');

// ── 챌린지 설정 ──────────────────────────────────────
const CHALLENGE_CONFIG = {
  active:    true,
  startDate: '2026-04-29',   // 오늘 (시작일)
  endDate:   '2026-06-23',   // 8주 후
  title:     '미라클러스 직원 웰니스 챌린지 2026',
  maxParticipants: 16,
  rewards: {
    first:  500000,  // 챌린지 우승 (CCS 1위)
    second: 300000,  // 루틴 마스터상 (IMEM 평균 1위)
    third:  200000,  // 체형 변화상 (체중변화율 1위)
  },
  createdAt: new Date().toISOString(),
};
// ─────────────────────────────────────────────────────

async function main() {
  initFirebase();

  console.log('🔧 챌린지 설정 문서 생성 중...');
  console.log(`   기간: ${CHALLENGE_CONFIG.startDate} ~ ${CHALLENGE_CONFIG.endDate}`);
  console.log(`   참가자: 최대 ${CHALLENGE_CONFIG.maxParticipants}명`);

  try {
    await db().doc('challenges/weekly-challenge').set(CHALLENGE_CONFIG, { merge: true });
    console.log('✅ challenges/weekly-challenge 설정 완료!');
    console.log('');
    console.log('📋 다음 단계:');
    console.log('   1. 직원들이 앱 설치 + 텔레그램 봇 연결 (/link)');
    console.log('   2. 각자 프로필에서 시작 체중(sw) 설정');
    console.log('   3. 봇에서 /participants 로 등록 현황 확인');
    console.log('   4. 봇에서 /ranking 으로 실시간 순위 확인');
    console.log('');
    console.log('⚠️  중요: 직원들이 시작 체중을 앱 프로필에 "시작체중"으로 입력해야');
    console.log('   CCS 집계에 포함됩니다.');
  } catch (e) {
    console.error('❌ 설정 실패:', e.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
