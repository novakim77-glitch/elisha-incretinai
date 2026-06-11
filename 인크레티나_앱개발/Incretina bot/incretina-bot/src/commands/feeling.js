// commands/feeling.js — 느낌 기록 (Phase 1 회복 코칭)
// Feature Flag에 의해 보호됨: Firestore `features/recovery.active` 또는 whitelist
//
// 두 가지 진입 경로:
//   1. InlineKeyboard 버튼 콜백 (feeling:good / feeling:normal / feeling:bad)
//   2. 자연어 감지 (localRouter → parseFeeling → handleFeelingCallback)

const { saveFeeling, isFeelingsEnabled } = require('../store');
const { resolveUser } = require('./_shared');

// 느낌 타입 레이블
const FEELING_LABELS = {
  good:   '😊 좋아요',
  normal: '🙂 보통이에요',
  bad:    '😔 별로예요',
};

// 느낌 저장 후 격려 메시지 (페르소나 무관, 간결하게)
const FEELING_RESPONSES = {
  good:   '좋은 하루를 보내고 있군요 🤍\n그 흐름 그대로 이어가봐요.',
  normal: '평범한 날도 쌓이면 힘이 돼요 🤍\n오늘도 한 걸음씩.',
  bad:    '알려줘서 고마워요 🤍\n힘든 날일수록 작은 한 가지만 — 같이 해볼게요.',
};

/**
 * 자연어 텍스트에서 느낌을 감지한다.
 * @param {string} text
 * @returns {'good'|'normal'|'bad'|null}
 */
function parseFeeling(text) {
  if (!text) return null;
  const t = text.trim();

  // 좋음 패턴
  if (/좋[아았]|최고|훌륭|완벽|상쾌|활기|가뿐|개운|포만|든든|잘됐|잘되|컨디션\s*좋|몸이\s*가|기운차/.test(t)) return 'good';
  // 나쁨 패턴
  if (/별로|안좋|나쁘|힘들|피곤|무겁|지침|배고프|배고파|허기|속쓰|불편|쳐진|저조|우울|늘어지|의욕없|의욕 없/.test(t)) return 'bad';
  // 보통 패턴
  if (/보통|그냥|그저|평범|그럭저럭|나쁘지않|나쁘지 않|무난|그냥그냥/.test(t)) return 'normal';

  return null;
}

/**
 * InlineKeyboard 콜백 핸들러 — feeling:good / feeling:normal / feeling:bad
 * @param {import('grammy').Context} ctx
 */
async function handleFeelingCallback(ctx) {
  const data = ctx.callbackQuery?.data || '';
  if (!data.startsWith('feeling:')) return;

  const resolved = await resolveUser(ctx).catch(() => null);
  if (!resolved?.uid) {
    return ctx.answerCallbackQuery({ text: '먼저 앱과 연결해 주세요 (/link)' });
  }

  // Feature Flag 체크
  const enabled = await isFeelingsEnabled(ctx.chat.id).catch(() => false);
  if (!enabled) {
    return ctx.answerCallbackQuery({ text: '준비 중인 기능이에요!' });
  }

  const feelingType = data.replace('feeling:', '');
  if (!FEELING_LABELS[feelingType]) {
    return ctx.answerCallbackQuery({ text: '알 수 없는 응답이에요.' });
  }

  try {
    await saveFeeling(resolved.uid, feelingType, ctx.chat.id);
    await ctx.answerCallbackQuery({ text: `${FEELING_LABELS[feelingType]} — 기억할게요 🤍` });
    // 버튼 제거 (중복 클릭 방지)
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  } catch (e) {
    console.error('[feeling:callback] error:', e.message);
    await ctx.answerCallbackQuery({ text: '저장 중 오류가 났어요. 다시 시도해 주세요.' });
  }
}

/**
 * 자연어로 느낌을 말한 경우 직접 저장하고 응답 반환.
 * Feature Flag OFF 또는 감지 실패 시 null 반환 (Claude로 폴백).
 * @param {import('grammy').Context} ctx
 * @param {'good'|'normal'|'bad'} feelingType
 * @returns {Promise<string|null>}
 */
async function handleFeelingText(ctx, feelingType) {
  try {
    const enabled = await isFeelingsEnabled(ctx.chat.id).catch(() => false);
    if (!enabled) return null;

    const resolved = await resolveUser(ctx).catch(() => null);
    if (!resolved?.uid) return null;

    await saveFeeling(resolved.uid, feelingType, ctx.chat.id);
    return FEELING_RESPONSES[feelingType] || null;
  } catch (e) {
    console.error('[feeling:text] error:', e.message);
    return null;
  }
}

module.exports = { handleFeelingCallback, handleFeelingText, parseFeeling };
