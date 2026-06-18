// commands/crew.js — 크루 시스템 Phase 1A (관리자 셋업 + 닉네임 + 본인 조회)
// 발송 없음(리더보드/어워드는 1B+). flag(active)는 셋업 시 false로 시작.
//   /crew_setup YYYY-MM-DD YYYY-MM-DD [크루명]  — 관리자, 크루 그룹챗 안에서 실행
//   /nickname <표시이름>                         — 멤버 본인
//   /crew                                        — 본인 크루 정보 조회

const {
  CREW_ID, getCrew, saveCrewConfig, setNickname,
  getProfile, listActiveTelegramUsers,
} = require('../store');
const { resolveUser } = require('./_shared');
const { resolveNickname, parseSetupArgs, validateNickname, isMember } = require('../crew');

const ADMIN_IDS = (process.env.ADMIN_CHAT_ID || '')
  .split(',').map((s) => Number(s.trim())).filter(Boolean);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function isAdmin(ctx) {
  const id = ctx.from?.id;
  return ADMIN_IDS.length === 0 || ADMIN_IDS.includes(id);
}

// ── /crew_setup — 관리자 전용, 크루 그룹챗에서 실행 권장 ──
async function crewSetupCommand(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('⛔ 관리자 전용 명령어입니다.');

  const parsed = parseSetupArgs(ctx.match);
  if (!parsed.ok) {
    return ctx.reply(
      '사용법: <code>/crew_setup 2026-07-01 2026-08-26 미라클 크루</code>\n' +
      '※ 크루 그룹챗 <b>안에서</b> 실행하면 그룹이 자동 등록됩니다.',
      { parse_mode: 'HTML' },
    );
  }

  const chatType = ctx.chat?.type;
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const groupChatId = isGroup ? ctx.chat.id : null;

  // 테스트 단계(단일 크루): 현재 텔레그램 연결된 전체 사용자를 멤버로 등록
  let memberUids = [];
  try {
    const users = await listActiveTelegramUsers();
    memberUids = users.map((u) => u.uid);
  } catch (e) {
    console.warn('[crew_setup] member fetch failed:', e.message);
  }

  try {
    await saveCrewConfig(CREW_ID, {
      name: parsed.name,
      groupChatId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      active: false, // 검증 후 활성화 (Firestore에서 active:true 또는 향후 /crew_on)
      memberUids,
      createdBy: String(ctx.from?.id || ''),
    });
  } catch (e) {
    console.error('[crew_setup] save failed:', e.message);
    return ctx.reply('⚠️ 크루 설정 저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }

  await ctx.reply(
    [
      `✅ <b>크루 설정 완료</b>`,
      ``,
      `이름: ${escapeHtml(parsed.name)}`,
      `기간: ${parsed.startDate} ~ ${parsed.endDate}`,
      `멤버: ${memberUids.length}명 (현재 연결된 전체)`,
      `그룹: ${isGroup ? `등록됨 (${groupChatId})` : '⚠️ 그룹 아님 — 그룹챗에서 다시 실행하면 자동 등록'}`,
      ``,
      `상태: <b>비활성</b> (active:false) — 검증 후 활성화하세요.`,
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
}

// ── /nickname — 멤버 본인 표시 이름 변경 ──
async function nicknameCommand(ctx) {
  const arg = (ctx.match || '').trim();
  if (!arg) {
    return ctx.reply('사용법: <code>/nickname 표시이름</code>\n그룹 리더보드에 보일 이름이에요 (1~20자).', { parse_mode: 'HTML' });
  }
  const v = validateNickname(arg);
  if (!v.ok) return ctx.reply(`⚠️ ${v.error}`);

  try {
    const { uid } = await resolveUser(ctx);
    await setNickname(uid, v.nickname);
    await ctx.reply(`✅ 닉네임을 <b>${escapeHtml(v.nickname)}</b> (으)로 바꿨어요.`, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('[nickname] failed:', e.message);
    await ctx.reply('⚠️ 닉네임 변경에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
}

// ── /crew — 본인 크루 정보 조회 ──
async function crewCommand(ctx) {
  try {
    const crew = await getCrew();
    if (!crew) {
      return ctx.reply('아직 크루가 설정되지 않았어요. 관리자가 /crew_setup 으로 만들 수 있어요.');
    }
    const { uid, profile } = await resolveUser(ctx);
    const member = isMember(crew, uid);
    const lines = [
      `🏃 <b>${escapeHtml(crew.name || '미라클 크루')}</b>`,
      `기간: ${crew.startDate || '-'} ~ ${crew.endDate || '-'}`,
      `멤버: ${(crew.memberUids || []).length}명`,
      `상태: ${crew.active ? '진행 중 🟢' : '준비 중 ⚪'}`,
      ``,
      member
        ? `내 표시 이름: <b>${escapeHtml(resolveNickname(profile))}</b>  (/nickname 으로 변경)`
        : `아직 이 크루의 멤버가 아니에요.`,
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  } catch (e) {
    console.error('[crew] failed:', e.message);
    await ctx.reply('⚠️ 크루 정보를 불러오지 못했어요.');
  }
}

// ── /crew_on — 크루 활성화 (관리자) ──
async function crewOnCommand(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('⛔ 관리자 전용 명령어입니다.');
  const crew = await getCrew();
  if (!crew) return ctx.reply('먼저 /crew_setup 으로 크루를 만들어 주세요.');
  if (!crew.groupChatId) {
    return ctx.reply('⚠️ 그룹챗이 등록되지 않았어요.\n크루 그룹챗 안에서 /crew_setup 을 먼저 실행해 주세요.');
  }
  try {
    await saveCrewConfig(CREW_ID, { active: true });
  } catch (e) {
    return ctx.reply('⚠️ 활성화에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
  await ctx.reply(
    '✅ <b>크루 활성화!</b>\n매일 22:30 리더보드 · 22:35 마일스톤 · 월요일 어워드가 그룹에 발송돼요.\n(중지: /crew_off)',
    { parse_mode: 'HTML' },
  );
}

// ── /crew_off — 크루 발송 중지 (관리자) ──
async function crewOffCommand(ctx) {
  if (!isAdmin(ctx)) return ctx.reply('⛔ 관리자 전용 명령어입니다.');
  try {
    await saveCrewConfig(CREW_ID, { active: false });
  } catch (e) {
    return ctx.reply('⚠️ 중지에 실패했어요. 잠시 후 다시 시도해 주세요.');
  }
  await ctx.reply('⏸️ 크루 자동 발송을 중지했어요. (재개: /crew_on)');
}

module.exports = { crewSetupCommand, nicknameCommand, crewCommand, crewOnCommand, crewOffCommand };
