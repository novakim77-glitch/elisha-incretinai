// crewNotifier.js — 크루 그룹챗 발송 (Phase 1B: 일일 리더보드)
// 프라이버시 안전판: 그룹엔 닉네임·상위 3명·체중 변화율(%)만. 원본 체중(kg)·하위권 비공개.
// 가드: crew 미설정 / groupChatId 없음 / 비활성(active=false) / 멤버<2 → 발송 안 함.
//   → 1A 상태(active:false·groupChatId 미등록)에선 자동 발송 0. 기존 동작 무영향.

const {
  getCrew, getProfile, getUserChallengeDays, toLogicalDate,
  addMilestone, saveCrewReturnState,
} = require('./store');
const {
  resolveNickname, isCrewActive, rankByCCS, crewAverages,
  computeStreak, daysSinceLastRecord, detectMilestones, milestoneMessage,
  shouldNudgeReturn, returnNudgeMessage, computeWeeklyAwards,
} = require('./crew');

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
  let maxScore = 0;
  const recordDates = [];
  days.forEach((day) => {
    recordDates.push(day.date);
    const w = parseFloat(day.weight);
    if (w > 0) latestWeight = w;
    if (typeof day.score === 'number') {
      totalScore += day.score;
      scoreDays++;
      if (day.score >= 50) completionDays++;
      if (day.score > maxScore) maxScore = day.score;
    }
  });

  const weightChangePct = startWeight > 0 ? ((startWeight - latestWeight) / startWeight) * 100 : 0;
  return {
    uid,
    nickname: resolveNickname(profile),
    weightChangePct,
    imemAvg: scoreDays > 0 ? totalScore / scoreDays : 0,
    completionDays,
    // 마일스톤용 지표
    maxScore,
    weightLost: startWeight - latestWeight,
    streak: computeStreak(recordDates, endDate),
    recordDates,
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

/**
 * 마일스톤 축하 — 멤버가 새로 달성한 마일스톤을 그룹챗에 축하 (긍정만).
 * 중복 방지: users/{uid}.milestones[]. 가드는 리더보드와 동일.
 */
async function sendCrewMilestones(bot, opts = {}) {
  const crew = await getCrew();
  if (!crew || !crew.groupChatId) return;
  const today = toLogicalDate(new Date(), 'Asia/Seoul');
  if (!opts.manual && !isCrewActive(crew, today)) return;

  const members = Array.isArray(crew.memberUids) ? crew.memberUids : [];
  let celebrated = 0;
  for (const uid of members) {
    try {
      const profile = await getProfile(uid);
      if (!profile) continue;
      const stats = await collectMemberStats(uid, crew.startDate, today);
      if (!stats) continue;
      const earned = detectMilestones(stats, profile.milestones || []);
      for (const key of earned) {
        const msg = milestoneMessage(key, stats.nickname);
        if (!msg) continue;
        const ok = await bot.api.sendMessage(crew.groupChatId, msg, { parse_mode: 'HTML' })
          .then(() => true).catch((e) => { console.error('[crew-milestone] send:', e.description || e.message); return false; });
        if (ok) { await addMilestone(uid, key).catch((e) => console.warn('[crew-milestone] save:', e.message)); celebrated++; }
      }
    } catch (e) {
      console.warn(`[crew-milestone] ${uid} 실패:`, e.message);
    }
  }
  console.log(`[crew] 마일스톤 축하 ${celebrated}건`);
}

/**
 * 부드러운 복귀 — 3일+ 비활성 멤버에게 개인 DM 안부 (그룹엔 절대 노출 안 함).
 * 5일 backoff. 회복 코칭 톤.
 */
async function sendCrewReturnNudge(bot, opts = {}) {
  const crew = await getCrew();
  if (!crew) return;
  const today = toLogicalDate(new Date(), 'Asia/Seoul');
  if (!opts.manual && !isCrewActive(crew, today)) return;

  const members = Array.isArray(crew.memberUids) ? crew.memberUids : [];
  let nudged = 0;
  for (const uid of members) {
    try {
      const profile = await getProfile(uid);
      if (!profile || !profile.telegramChatId) continue;
      const days = await getUserChallengeDays(uid, crew.startDate, today);
      const inactive = daysSinceLastRecord(days.map((d) => d.date), today);
      if (!shouldNudgeReturn(profile.crewReturnState, inactive, today)) continue;

      const ok = await bot.api.sendMessage(profile.telegramChatId, returnNudgeMessage(resolveNickname(profile)))
        .then(() => true).catch((e) => { console.error('[crew-return] send:', e.description || e.message); return false; });
      if (ok) { await saveCrewReturnState(uid, { lastNudge: today }).catch(() => {}); nudged++; }
    } catch (e) {
      console.warn(`[crew-return] ${uid} 실패:`, e.message);
    }
  }
  console.log(`[crew] 부드러운 복귀 ${nudged}명`);
}

/**
 * 주간 어워드 — 종합 TOP3 + 부문상(발전·꾸준·도전)을 그룹챗에 발송.
 * 가드는 리더보드와 동일. 월요일 발송(scheduler).
 */
async function sendCrewWeeklyAward(bot, opts = {}) {
  const crew = await getCrew();
  if (!crew || !crew.groupChatId) return;
  const today = toLogicalDate(new Date(), 'Asia/Seoul');
  if (!opts.manual && !isCrewActive(crew, today)) return;

  const members = Array.isArray(crew.memberUids) ? crew.memberUids : [];
  const participants = [];
  for (const uid of members) {
    try {
      const s = await collectMemberStats(uid, crew.startDate, today);
      if (s) participants.push(s);
    } catch (e) {
      console.warn(`[crew-award] ${uid} 집계 실패:`, e.message);
    }
  }
  if (participants.length < 2) { console.log('[crew] 어워드 멤버<2 — skip'); return; }

  const a = computeWeeklyAwards(participants);
  if (!a) return;
  const medal = ['🥇', '🥈', '🥉'];
  const lines = [
    `🏆 <b>${escapeHtml(crew.name || '미라클 크루')} — 주간 어워드</b>`,
    `📅 ${today} 기준`,
    ``,
    `<b>종합 순위</b>`,
  ];
  a.top3.forEach((p, i) => {
    lines.push(`${medal[i]} <b>${escapeHtml(p.nickname)}</b> · CCS ${p.ccs.toFixed(1)}`);
  });
  const im = a.mostImproved, co = a.consistent, ch = a.challenger;
  const sign = (v) => (v >= 0 ? '↓' : '↑');
  lines.push(
    ``,
    `<b>이번 주 부문상</b>`,
    `🌱 발전상 — <b>${escapeHtml(im.nickname)}</b> (체중 ${sign(im.weightChangePct)}${Math.abs(im.weightChangePct).toFixed(1)}%)`,
    `🎯 꾸준상 — <b>${escapeHtml(co.nickname)}</b> (완수 ${co.completionDays}일)`,
    `💪 도전상 — <b>${escapeHtml(ch.nickname)}</b> (IMEM ${ch.imemAvg.toFixed(0)}점)`,
    ``,
    `이번 주도 함께 빛났어요. 다음 주도 같이 가요 ✨`,
  );

  try {
    await bot.api.sendMessage(crew.groupChatId, lines.join('\n'), { parse_mode: 'HTML' });
    console.log('[crew] 주간 어워드 발송 완료');
  } catch (e) {
    console.error('[crew-award] 발송 실패:', e.description || e.message);
  }
}

module.exports = {
  sendCrewLeaderboard, collectMemberStats, sendCrewMilestones, sendCrewReturnNudge, sendCrewWeeklyAward,
};
