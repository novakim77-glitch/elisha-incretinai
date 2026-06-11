// /preload — 상황별 프리로드 레시피 추천 + β_pre 완료 기록
//
// 플로우:
//   /preload → 상황 선택 인라인 키보드
//   → 상황 선택 → 레시피 카드 + [레시피 보기] [다른 추천] [✅ 완료]
//   → [레시피 보기] → 전체 상세 + [✅ 완료] [🔄 다른 추천]
//   → [✅ 완료] → β_pre 저장 + 스트릭 표시
//   → [🔄 다른 추천] → 다른 레시피 카드 (이전 제외)

const { SITUATIONS, RECIPES, recommendRecipe, formatRecipeCard, formatRecipePreview } = require('../recipes');
const { resolveUser } = require('./_shared');
const { savePreloadLog, getRecentPreloadLogs, toLogicalDate } = require('../store');
const { withRetry } = require('../writeSafety');

// ── /preload 명령어 진입점 ──
async function preloadCommand(ctx) {
  await ctx.reply(
    '🥜 <b>프리로드 타임!</b>\n\n지금 상황을 알려주세요. 상황에 맞는 레시피를 골라드릴게요.',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          SITUATIONS.map(s => ({ text: s.label, callback_data: `preload:sit:${s.id}` })),
        ],
      },
    }
  );
}

// ── 상황 선택 → 레시피 미리보기 ──
async function handleSituationSelect(ctx, situation) {
  await ctx.answerCallbackQuery();

  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const now = new Date();
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(now),
    10
  );

  // 최근 3일 이력으로 순환 추천
  const logs = await getRecentPreloadLogs(uid, 3, tz);
  const recentIds = logs.filter(l => l.completed && l.recipeId).map(l => String(l.recipeId));

  const recipe = recommendRecipe(situation, localHour, recentIds);

  await ctx.editMessageText(
    `${formatRecipePreview(recipe)}\n\n<i>식전 15~30분에 섭취하세요!</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📖 레시피 보기', callback_data: `preload:detail:${recipe.id}:${situation}` },
            { text: '🔄 다른 추천', callback_data: `preload:next:${situation}:${recipe.id}` },
          ],
          [{ text: '✅ 완료!', callback_data: `preload:done:${recipe.id}:${recipe.name}` }],
        ],
      },
    }
  );
}

// ── 레시피 상세 보기 ──
async function handleRecipeDetail(ctx, recipeId, situation) {
  await ctx.answerCallbackQuery();
  const recipe = RECIPES.find(r => r.id === Number(recipeId));
  if (!recipe) return ctx.answerCallbackQuery('레시피를 찾을 수 없어요.');

  await ctx.editMessageText(
    formatRecipeCard(recipe),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 다른 추천', callback_data: `preload:next:${situation}:${recipe.id}` },
            { text: '✅ 완료!', callback_data: `preload:done:${recipe.id}:${recipe.name}` },
          ],
        ],
      },
    }
  );
}

// ── 다른 추천 (이전 제외) ──
async function handleNextRecipe(ctx, situation, excludeId) {
  await ctx.answerCallbackQuery();

  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const now = new Date();
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(now),
    10
  );

  const logs = await getRecentPreloadLogs(uid, 3, tz);
  const recentIds = logs.filter(l => l.completed && l.recipeId).map(l => String(l.recipeId));
  // 현재 화면에 보이는 것도 제외
  const exclude = [...new Set([...recentIds, String(excludeId)])];

  const recipe = recommendRecipe(situation, localHour, exclude);

  await ctx.editMessageText(
    `${formatRecipePreview(recipe)}\n\n<i>식전 15~30분에 섭취하세요!</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📖 레시피 보기', callback_data: `preload:detail:${recipe.id}:${situation}` },
            { text: '🔄 다른 추천', callback_data: `preload:next:${situation}:${recipe.id}` },
          ],
          [{ text: '✅ 완료!', callback_data: `preload:done:${recipe.id}:${recipe.name}` }],
        ],
      },
    }
  );
}

// ── 프리로드 완료 ──
async function handlePreloadDone(ctx, recipeId, recipeName) {
  await ctx.answerCallbackQuery('✅ 저장 중...');

  const { uid, profile } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
  const hour = parseInt(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()),
    10
  );
  const mealType = hour < 14 ? 'lunch' : 'dinner';

  try {
    await withRetry(
      () => savePreloadLog(uid, date, {
        mealType,
        recipeId: String(recipeId),
        recipeName: recipeName || null,
        situation: null,
        source: 'bot_command',
      }),
      'preload:done'
    );
  } catch (e) {
    console.error('[preload] savePreloadLog failed:', e.message || e);
    return ctx.editMessageText(
      '⚠️ 저장에 실패했어요. 잠시 후 다시 시도해 주세요.',
      { parse_mode: 'HTML' }
    );
  }

  // 스트릭 계산
  const logs = await getRecentPreloadLogs(uid, 30, tz);
  let streak = 0;
  for (const log of logs) {
    if (log.completed) streak++;
    else break;
  }

  const streakMsg = streak >= 3
    ? `\n🔥 프리로드 연속 <b>${streak}일째</b>! ${streak >= 7 ? '🏅 목표: 14일 뱃지!' : '다음 목표: 7일 뱃지!'}`
    : '';

  await ctx.editMessageText(
    [
      `✅ <b>프리로드 완료! β_pre = 1.025</b>`,
      ``,
      `점심 식사 때 채소 → 단백질 → 탄수화물 순서까지 지키면`,
      `β_seq까지 추가돼서 β = <b>1.051</b>로 올라가요!`,
      streakMsg,
      ``,
      `<i>/score 로 오늘 IMEM 점수를 확인해 보세요.</i>`,
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
}

// ── 콜백 라우터 (index.js에서 등록) ──
// callback_data 형식: preload:sit:{situation} | preload:detail:{id}:{sit} |
//                     preload:next:{sit}:{excludeId} | preload:done:{id}:{name}
async function preloadCallbackHandler(ctx) {
  const data = ctx.callbackQuery.data;
  const parts = data.split(':');
  // parts[0] = 'preload'

  try {
    if (parts[1] === 'sit') {
      return await handleSituationSelect(ctx, parts[2]);
    }
    if (parts[1] === 'detail') {
      return await handleRecipeDetail(ctx, parts[2], parts[3]);
    }
    if (parts[1] === 'next') {
      return await handleNextRecipe(ctx, parts[2], parts[3]);
    }
    if (parts[1] === 'done') {
      // recipeName은 콜백 데이터에 없을 수 있으므로 id로만 처리
      return await handlePreloadDone(ctx, parts[2], parts.slice(3).join(':') || null);
    }
    if (parts[1] === 'skip') {
      await ctx.answerCallbackQuery('건너뜀 ✓');
      try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) {}
      return;
    }
  } catch (e) {
    console.error('[preload callback] error:', e.message || e);
    try { await ctx.answerCallbackQuery('오류가 발생했어요. 다시 시도해 주세요.'); } catch (_) {}
  }
}

module.exports = { preloadCommand, preloadCallbackHandler };
