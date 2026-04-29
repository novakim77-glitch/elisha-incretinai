// /ranking — 챌린지 CCS 실시간 순위 (관리자 전용)
// 사용법: /ranking
// 관리자 chatId만 허용 (ADMIN_CHAT_ID 환경변수)

const {
  listActiveTelegramUsers, getProfile, getChallengeConfig, getUserChallengeDays, toLogicalDate,
} = require('../store');

const ADMIN_IDS = (process.env.ADMIN_CHAT_ID || '')
  .split(',').map((s) => Number(s.trim())).filter(Boolean);

async function rankingCommand(ctx) {
  const chatId = ctx.chat?.id;

  // 관리자 검증
  if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(chatId)) {
    return ctx.reply('⛔ 관리자 전용 명령어입니다.');
  }

  await ctx.reply('📊 챌린지 순위 집계 중... 잠시만 기다려주세요.');

  try {
    const config = await getChallengeConfig();
    if (!config || !config.active) {
      return ctx.reply('ℹ️ 현재 활성화된 챌린지가 없습니다.\n\nFirestore <code>challenges/weekly-challenge</code>에서 <code>active: true</code>로 설정해 주세요.', { parse_mode: 'HTML' });
    }

    const { startDate, endDate } = config;
    const today = toLogicalDate(new Date(), 'Asia/Seoul');
    const users = await listActiveTelegramUsers();

    if (!users.length) {
      return ctx.reply('ℹ️ 텔레그램 연결된 참가자가 없습니다.');
    }

    // 각 사용자 데이터 수집
    const participants = [];
    for (const { uid, chatId: userChatId } of users) {
      try {
        const profile = await getProfile(uid);
        if (!profile) continue;

        // 시작 체중: sw 우선, 없으면 첫 기록 체중
        const startWeight = parseFloat(profile.sw) || parseFloat(profile.cw) || 0;
        if (!startWeight) continue;

        const days = await getUserChallengeDays(uid, startDate, today);
        let latestWeight = startWeight;
        let totalScore = 0;
        let scoreDays = 0;
        let completionDays = 0;
        let recordedDays = days.length;

        days.forEach((day) => {
          const w = parseFloat(day.weight);
          if (w > 0) latestWeight = w;
          if (typeof day.score === 'number') {
            totalScore += day.score;
            scoreDays++;
            if (day.score >= 50) completionDays++;
          }
        });

        const weightChangePct = startWeight > 0
          ? ((startWeight - latestWeight) / startWeight) * 100
          : 0;

        participants.push({
          uid,
          chatId: userChatId,
          name: profile.name || '이름없음',
          startWeight,
          latestWeight,
          weightChangePct,
          imemAvg: scoreDays > 0 ? totalScore / scoreDays : 0,
          completionDays,
          recordedDays,
        });
      } catch (e) {
        console.error(`[ranking] uid=${uid} 데이터 오류:`, e.message);
      }
    }

    if (!participants.length) {
      return ctx.reply('ℹ️ 시작 체중이 등록된 참가자가 없습니다.');
    }

    // CCS 계산 (challenge.html과 동일 로직)
    const n = participants.length;
    const rankBy = (key) => {
      const sorted = [...participants].sort((a, b) => b[key] - a[key]);
      sorted.forEach((p, i) => { p[`${key}Rank`] = n - i; });
    };
    rankBy('weightChangePct');
    rankBy('imemAvg');
    rankBy('completionDays');

    participants.forEach((p) => {
      p.ccs = p.weightChangePctRank * 0.40
            + p.imemAvgRank        * 0.35
            + p.completionDaysRank * 0.25;
    });

    const ranked = [...participants].sort((a, b) => b.ccs - a.ccs);

    // 경과 주차 계산
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weekNum = Math.min(
      Math.floor((Date.now() - new Date(startDate).getTime()) / msPerWeek) + 1,
      8,
    );

    // 메달
    const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

    // 메시지 조립
    const lines = [
      `🏆 <b>다이어트 챌린지 CCS 순위</b>`,
      `📅 ${startDate} ~ ${endDate} (${weekNum}주차)`,
      `👥 집계 인원: ${n}명 / 기준일: ${today}`,
      ``,
      `<b>종합 순위 (CCS)</b>`,
    ];

    for (let i = 0; i < ranked.length; i++) {
      const p = ranked[i];
      const wtSign = p.weightChangePct >= 0 ? '↓' : '↑';
      const wtAbs  = Math.abs(p.weightChangePct).toFixed(1);
      lines.push(
        `${medal(i)} <b>${p.name}</b>  CCS ${p.ccs.toFixed(2)}`,
        `   체중 ${wtSign}${wtAbs}%(${p.weightChangePctRank}위) | IMEM ${p.imemAvg.toFixed(0)}점(${p.imemAvgRank}위) | 완수 ${p.completionDays}일(${p.completionDaysRank}위)  [기록 ${p.recordedDays}일]`,
      );
    }

    lines.push(
      ``,
      `<i>CCS = 체중변화율×0.4 + IMEM평균×0.35 + 루틴완수일×0.25</i>`,
    );

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });

  } catch (e) {
    console.error('[ranking] 오류:', e);
    await ctx.reply(`❌ 순위 집계 중 오류가 발생했습니다: ${e.message}`);
  }
}

// 참가자 현황 (온보딩 체크)
async function participantsCommand(ctx) {
  const chatId = ctx.chat?.id;
  if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(chatId)) {
    return ctx.reply('⛔ 관리자 전용 명령어입니다.');
  }

  try {
    const users = await listActiveTelegramUsers();
    if (!users.length) {
      return ctx.reply('ℹ️ 텔레그램에 연결된 사용자가 없습니다.');
    }

    const lines = [
      `👥 <b>참가자 현황</b> (텔레그램 연결 완료)`,
      `총 ${users.length}명`,
      ``,
    ];

    for (const { uid, chatId: userChatId } of users) {
      try {
        const profile = await getProfile(uid);
        const name = profile?.name || '이름없음';
        const sw = profile?.sw ? `${profile.sw}kg` : '시작체중 미설정 ⚠️';
        const today = toLogicalDate(new Date(), profile?.timezone || 'Asia/Seoul');
        lines.push(`• <b>${name}</b>  시작체중: ${sw}`);
      } catch (e) {
        lines.push(`• uid=${uid} (프로필 오류)`);
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  } catch (e) {
    console.error('[participants] 오류:', e);
    await ctx.reply(`❌ 오류: ${e.message}`);
  }
}

module.exports = { rankingCommand, participantsCommand };
