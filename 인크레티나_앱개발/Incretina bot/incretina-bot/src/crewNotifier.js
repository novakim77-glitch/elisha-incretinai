// crewNotifier.js — 크루 그룹챗 발송 (Phase 1B: 일일 리더보드)
// 프라이버시 안전판: 그룹엔 닉네임·상위 3명·체중 변화율(%)만. 원본 체중(kg)·하위권 비공개.
// 가드: crew 미설정 / groupChatId 없음 / 비활성(active=false) / 멤버<2 → 발송 안 함.
//   → 1A 상태(active:false·groupChatId 미등록)에선 자동 발송 0. 기존 동작 무영향.

const { getCrew, getProfile, getUserChallengeDays, toLogicalDate } = require('./store');
const { resolveNickname, isCrewActive, rankByCCS, crewAverages } = require('./crew');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 한 멤버의 챌린지 기간 통계 집계 (ranking.js와 동일 규칙)
async function collectMemberStats(uid, startDate, endDate) {
  const profile = await getProfile(uid);
  if (!profile) return null;
  const startWeight = parseFloat(profile.sw) || parseFloat(profile.cw) || 0;
  if (!startWeight) return null; // 시작 체중 없으면 순위 집계 불가

  const days = await getUserChallengeDays(uid, startDate, endDate);
  let latestWeight = startWeight;
  let totalScore = 0;
  let scoreDays = 0;
  let completionDays = 0;
  days.forEach((day) => {
    const w = parseFloat(day.weight);
    if (w > 0) latestWeight = w;
    if (typeof day.score === 'number') {
      totalScore += day.score;
      scoreDays++;
      if (day.score >= 50) completionDays++;
    }
  });

  const weightChangePct = startWeight > 0 ? ((startWeight - latestWeight) / startWeight) * 100 : 0;
  return {
    uid,
    nickname: resolveNickname(profile),
    weightChangePct,
    imemAvg: scoreDays > 0 ? totalScore / scoreDays : 0,
    completionDays,
  };
}

/**
 * 일일 크루 리더보드 — 그룹챗에 상위 3명 + 크루 평균 발송.
 * @param {Bot} bot
 * @param {{ manual?: boolean }} opts  manual=true면 기간/활성 가드 우회(테스트용)
 */
async function sendCrewLeaderboard(bot, opts = {}) {
  const manual = !!opts.manual;
  const crew = await getCrew();
  if (!crew) { console.log('[crew] 설정 없음 — 발송 건너뜀'); return; }
  if (!crew.groupChatId) { console.log('[crew] groupChatId 미등록 — 발송 건너뜀'); return; }

  const today = toLogicalDate(new Date(), 'Asia/Seoul'); // 크루 대표 기준일
  if (!manual && !isCrewActive(crew, today)) {
    console.log('[crew] 비활성/기간 외 — 발송 건너뜀');
    return;
  }

  // 멤버 통계 수집
  const members = Array.isArray(crew.memberUids) ? crew.memberUids : [];
  const participants = [];
  for (const uid of members) {
    try {
      const s = await collectMemberStats(uid, crew.startDate, today);
      if (s) participants.push(s);
    } catch (e) {
      console.warn(`[crew] member ${uid} 집계 실패:`, e.message);
    }
  }
  if (participants.length < 2) {
    console.log(`[crew] 집계 가능 멤버 ${participants.length}명 (<2) — 발송 건너뜀`);
    return;
  }

  const ranked = rankByCCS(participants);
  const avg = crewAverages(participants);
  const medal = ['🥇', '🥈', '🥉'];

  const lines = [
    `🏃 <b>${escapeHtml(crew.name || '미라클 크루')} — 오늘의 리더보드</b>`,
    `📅 ${today}`,
    ``,
    `<b>오늘의 TOP 3</b>`,
  ];
  ranked.slice(0, 3).forEach((p, i) => {
    const sign = p.weightChangePct >= 0 ? '↓' : '↑';
    const pct = Math.abs(p.weightChangePct).toFixed(1);
    lines.push(`${medal[i]} <b>${escapeHtml(p.nickname)}</b>  ·  CCS ${p.ccs.toFixed(1)}  (체중 ${sign}${pct}%)`);
  });
  lines.push(
    ``,
    `👥 크루 평균 — IMEM ${avg.avgImem.toFixed(0)}점 · 완수 ${avg.avgCompletion.toFixed(1)}일 (${avg.count}명)`,
    `오늘도 함께 한 걸음. 끝까지 같이 가요 💪`,
  );

  try {
    await bot.api.sendMessage(crew.groupChatId, lines.join('\n'), { parse_mode: 'HTML' });
    console.log(`[crew] 리더보드 발송 완료 → 그룹 ${crew.groupChatId} (${avg.count}명)`);
  } catch (e) {
    console.error('[crew] 그룹 발송 실패:', e.description || e.message);
  }
}

module.exports = { sendCrewLeaderboard, collectMemberStats };
