// /broadcast — 관리자 전체 공지 발송
// 사용법: /broadcast 공지 내용 (Shift+Enter로 줄바꿈)
// ADMIN_CHAT_ID 환경변수로 접근 제어 (쉼표로 여러 ID 허용)

const { listActiveTelegramUsers } = require('../store');

const ADMIN_IDS = (process.env.ADMIN_CHAT_ID || '')
  .split(',').map((s) => Number(s.trim())).filter(Boolean);

const USAGE =
  '📢 <b>전체 공지 사용법</b>\n\n' +
  '<code>/broadcast 공지 내용</code>\n\n' +
  '<b>예시</b>\n' +
  '<code>/broadcast 안녕하세요! 챌린지 1주차 마무리 수고하셨습니다 💪\n오늘 체중 기록 잊지 마세요!</code>\n\n' +
  '• 줄바꿈: Shift+Enter\n' +
  '• HTML 서식: &lt;b&gt;굵게&lt;/b&gt; &lt;i&gt;기울임&lt;/i&gt;\n' +
  '• 일반 텍스트도 그대로 전송됩니다';

async function broadcastCommand(ctx) {
  const chatId = ctx.chat?.id;

  if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(chatId)) {
    return ctx.reply('⛔ 관리자 전용 명령어입니다.');
  }

  // "/broadcast " 이후 텍스트 추출
  const raw = ctx.message?.text || '';
  const content = raw.replace(/^\/broadcast\s*/i, '').trim();

  if (!content) {
    return ctx.reply(USAGE, { parse_mode: 'HTML' });
  }

  const ack = await ctx.reply('📤 공지 발송 중...').catch(() => null);

  const users = await listActiveTelegramUsers();
  if (!users.length) {
    return ctx.reply('ℹ️ 텔레그램 연결된 사용자가 없습니다.');
  }

  let sent = 0;
  let failed = 0;
  for (const { chatId: userChatId } of users) {
    // 관리자 본인에게 중복 발송 방지
    if (userChatId === chatId) { sent++; continue; }
    try {
      await ctx.api.sendMessage(userChatId, content, { parse_mode: 'HTML' });
      sent++;
    } catch (e) {
      console.warn(`[broadcast] failed chatId=${userChatId}: ${e.message}`);
      failed++;
    }
  }

  const summary =
    `📢 <b>공지 발송 완료</b>\n` +
    `✅ 성공 ${sent}명` + (failed > 0 ? `  ❌ 실패 ${failed}명` : '') + `\n\n` +
    `<b>발송 내용</b>\n${escapeHtml(content)}`;

  await ctx.reply(summary, { parse_mode: 'HTML' });

  // 발송 확인 메시지 지우기 (선택)
  if (ack) ctx.api.deleteMessage(ctx.chat.id, ack.message_id).catch(() => {});
}

// HTML 특수문자 이스케이프 (요약 표시용)
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { broadcastCommand };
