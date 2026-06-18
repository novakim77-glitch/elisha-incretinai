// test-crew.js — 크루 순수 로직 단위 테스트
const { resolveNickname, isCrewActive, isMember, parseSetupArgs, validateNickname, rankByCCS, crewAverages } = require('../src/crew');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ❌', msg); } };

// resolveNickname: 닉네임 > 실명 > 폴백
ok(resolveNickname({ nickname: '철이', name: '김철수' }) === '철이', 'nickname 우선');
ok(resolveNickname({ name: '김철수' }) === '김철수', '실명 폴백');
ok(resolveNickname({}) === '익명', '폴백 익명');
ok(resolveNickname(null) === '익명', 'null 방어');

// isCrewActive: flag + 기간
const crew = { active: true, startDate: '2026-07-01', endDate: '2026-08-26' };
ok(isCrewActive(crew, '2026-07-15') === true, '기간 내 active');
ok(isCrewActive(crew, '2026-06-30') === false, '시작 전 비활성');
ok(isCrewActive(crew, '2026-08-27') === false, '종료 후 비활성');
ok(isCrewActive({ ...crew, active: false }, '2026-07-15') === false, 'flag off');
ok(isCrewActive(null, '2026-07-15') === false, 'null 방어');

// isMember
ok(isMember({ memberUids: ['a', 'b'] }, 'a') === true, '멤버 맞음');
ok(isMember({ memberUids: ['a', 'b'] }, 'c') === false, '멤버 아님');
ok(isMember({}, 'a') === false, 'memberUids 없음 방어');

// parseSetupArgs
let p = parseSetupArgs('2026-07-01 2026-08-26 미라클 크루');
ok(p.ok && p.startDate === '2026-07-01' && p.endDate === '2026-08-26' && p.name === '미라클 크루', '정상 파싱+이름');
ok(parseSetupArgs('2026-07-01 2026-08-26').name === '미라클 크루', '이름 생략 시 기본값');
ok(parseSetupArgs('2026-07-01').ok === false, '날짜 1개 → 실패');
ok(parseSetupArgs('notadate 2026-08-26').ok === false, '날짜 형식 오류');
ok(parseSetupArgs('2026-08-26 2026-07-01').ok === false, '종료<시작 거부');
ok(parseSetupArgs('').ok === false, '빈 입력 방어');

// validateNickname
ok(validateNickname('철이').ok === true, '정상 닉네임');
ok(validateNickname('').ok === false, '빈 닉네임 거부');
ok(validateNickname('a'.repeat(21)).ok === false, '21자 거부');
ok(validateNickname('<b>해킹').ok === false, 'HTML 문자 거부');
ok(validateNickname('  공백트림  ').nickname === '공백트림', '공백 트림');

// rankByCCS: 모든 지표 1위인 사람이 종합 1위 + 입력 불변
const parts = [
  { uid: 'a', nickname: 'A', weightChangePct: 3.0, imemAvg: 80, completionDays: 20 }, // 전부 최고
  { uid: 'b', nickname: 'B', weightChangePct: 1.0, imemAvg: 60, completionDays: 10 },
  { uid: 'c', nickname: 'C', weightChangePct: -1.0, imemAvg: 40, completionDays: 5 },
];
const ranked = rankByCCS(parts);
ok(ranked.length === 3, 'rankByCCS 3명 반환');
ok(ranked[0].uid === 'a', '전 지표 1위가 종합 1위');
ok(ranked[2].uid === 'c', '전 지표 꼴찌가 종합 꼴찌');
ok(typeof ranked[0].ccs === 'number', 'ccs 숫자');
ok(parts[0].ccs === undefined, '입력 배열 불변(원본에 ccs 안 붙음)');
ok(rankByCCS([]).length === 0, '빈 배열 방어');

// crewAverages
const avg = crewAverages(parts);
ok(avg.count === 3, '평균 count 3');
ok(Math.abs(avg.avgImem - 60) < 0.01, '평균 IMEM 60');
ok(crewAverages([]).count === 0, '빈 평균 방어');

console.log(`\ncrew 로직: ${pass} pass, ${fail} fail`, fail === 0 ? '✅' : '❌');
process.exit(fail ? 1 : 0);
