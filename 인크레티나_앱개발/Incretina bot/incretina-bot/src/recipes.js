// Preload recipe DB — 30 recipes for /preload command
// Source: Synca_MiniApp_Prototype.jsx (converted to bot format)
// situations: office | home | outdoor | quick
// timeSlots: morning | lunch | dinner (which meals this suits)

const RECIPES = [
  // 🥚 계란 기반 (5종)
  { id:1, cat:'egg', name:'클래식 천연 위고비', sub:'삶은 계란 + EVOO', time:'10분', cal:200, p:13, glp:4, emoji:'🥚🫒',
    situations:['home','office'], timeSlots:['morning','lunch','dinner'],
    ing:'삶은 계란 2개, EVOO 1큰술, 후추, 소금',
    steps:'반숙(7분)~완숙(10분)으로 삶아 반으로 가르고 EVOO 듬뿍. 후추 톡톡. 식전 15~30분 천천히 섭취.',
    sci:'계란 단백질 13g → L-세포 GLP-1 선제 분비. EVOO 폴리페놀이 포만감 2~3h 연장. SNS "천연 위고비" 트렌드의 원조.' },
  { id:2, cat:'egg', name:'계란 아보카도 보트', sub:'아보카도 + 계란 + 레몬', time:'5분', cal:230, p:10, glp:5, emoji:'🥑🥚',
    situations:['home'], timeSlots:['morning','lunch'],
    ing:'아보카도 1/2개, 삶은 계란 1개, 레몬즙 1작은술, EVOO, 소금·후추',
    steps:'아보카도를 반으로 갈라 씨 제거. 으깬 삶은 계란을 올리고 레몬즙+EVOO를 뿌려 완성.',
    sci:'트리플 자극: 아보카도 식이섬유 5g+불포화지방+계란 단백질 → 세 경로 동시 GLP-1. 본 컬렉션 최고 GLP-1 유도력.' },
  { id:3, cat:'egg', name:'한국형 천연 위고비', sub:'삶은 계란 + 들기름 + 참깨', time:'10분', cal:190, p:13, glp:4, emoji:'🥚🇰🇷',
    situations:['home','office'], timeSlots:['morning','lunch','dinner'],
    ing:'삶은 계란 2개, 들기름 1큰술, 참깨, 후추',
    steps:'삶은 계란에 들기름+참깨+후추. 심플하게.',
    sci:'들기름은 오메가-3(ALA)가 올리브유보다 7배. 한국인 입맛에 최적화된 버전.' },
  { id:4, cat:'egg', name:'스크램블 에그 올리브유', sub:'부드러운 스크램블 + EVOO 마무리', time:'5분', cal:210, p:14, glp:4, emoji:'🍳🫒',
    situations:['home'], timeSlots:['morning','lunch'],
    ing:'계란 2개, EVOO 2작은술, 소금·후추',
    steps:'약불에서 계란을 부드럽게 스크램블(2분). 불 끈 후 생 EVOO 1작은술 뿌려 마무리.',
    sci:'가열 계란 단백질 소화흡수율 91%(생란 51% 대비). 조리 후 생 EVOO 추가하면 폴리페놀 보존.' },
  { id:5, cat:'egg', name:'계란 양배추 롤', sub:'삶은 계란 + 양배추 + 쌈장', time:'5분', cal:150, p:10, glp:4, emoji:'🥚🥬',
    situations:['home'], timeSlots:['morning','lunch','dinner'],
    ing:'삶은 계란 1~2개, 양배추 잎 2~3장, 들기름, 쌈장 약간',
    steps:'삶은 계란을 4등분하여 양배추 잎에 올리고 들기름+쌈장 넣어 싸서 먹기.',
    sci:'양배추 식이섬유 3g + 비타민U(위 점막 보호). 계란+들기름+양배추 = 프리로드+위장 보호 동시.' },

  // 🥛 유제품 기반 (4종)
  { id:6, cat:'dairy', name:'그릭요거트 너트볼', sub:'요거트 + 호두·아몬드 + 꿀', time:'3분', cal:200, p:15, glp:4, emoji:'🥛🥜',
    situations:['home','office','outdoor'], timeSlots:['morning','lunch'],
    ing:'그릭요거트(무가당) 150g, 호두 3~4개, 아몬드 5~6개, 꿀 1작은술',
    steps:'요거트에 견과류 손으로 부셔 올리고 꿀 살짝. 식전 15분에 섭취.',
    sci:'유청+카세인 15g → GLP-1. 칼슘이 GLP-1 추가 촉진(PMC 2022). 반드시 무가당 선택.' },
  { id:7, cat:'dairy', name:'코티지 치즈 플레이트', sub:'코티지치즈 + 토마토 + EVOO', time:'3분', cal:160, p:14, glp:4, emoji:'🧀🍅',
    situations:['home','office'], timeSlots:['morning','lunch','dinner'],
    ing:'코티지치즈 100g, 방울토마토 5개, EVOO, 바질, 후추',
    steps:'치즈에 토마토+EVOO+바질+후추.',
    sci:'카세인 중심 → 3시간+ 포만감. 토마토 리코펜 항산화. 160kcal 저칼로리 프리로드.' },
  { id:8, cat:'dairy', name:'골든 라씨', sub:'요거트 + 강황 + 생강 + 후추', time:'2분', cal:110, p:8, glp:3, emoji:'🥛✨',
    situations:['home','office'], timeSlots:['morning','lunch','dinner'],
    ing:'플레인 요거트 150ml, 강황 가루 1/4작은술, 생강 가루 약간, 후추 한 꼬집, 꿀, 물 50ml',
    steps:'모든 재료를 컵에 넣고 잘 저어 마시기. 따뜻하게 마시면 더 좋음.',
    sci:'커큐민(강황) 항염증 → 장 환경 개선 → GLP-1 기저 수준 향상. 피페린(후추)이 커큐민 흡수율 2000% 증가. 반드시 후추 추가!' },
  { id:9, cat:'dairy', name:'치즈 + 올리브', sub:'체다 + 올리브 + EVOO', time:'1분', cal:150, p:8, glp:3, emoji:'🧀🫒',
    situations:['home','office','outdoor'], timeSlots:['lunch','dinner'],
    ing:'체다 또는 고다 치즈 2조각(30g), 올리브 5~6개, EVOO 약간(선택)',
    steps:'치즈와 올리브를 작은 접시에 담아 식전에 천천히 먹기.',
    sci:'치즈 카세인+칼슘 → GLP-1 분비 촉진. 올리브 올레산+폴리페놀이 L-세포 자극. 레스토랑에서도 실천 가능.' },

  // 🥜 견과류 기반 (4종)
  { id:10, cat:'nut', name:'견과류 에너지 볼', sub:'아몬드 + 호두 + 다크초콜릿', time:'1분', cal:190, p:6, glp:3, emoji:'🥜🍫',
    situations:['office','outdoor','quick'], timeSlots:['morning','lunch','dinner'],
    ing:'아몬드 10개, 호두 5개, 다크초콜릿(70%+) 2조각',
    steps:'셋을 함께 먹기. 지퍼백 소분 추천.',
    sci:'불포화지방+단백질+섬유 삼중 포만감. 다크초콜릿 카카오 폴리페놀이 장내 유익균 증식 → GLP-1 기저 수준 향상.' },
  { id:11, cat:'nut', name:'아몬드버터 바나나 스틱', sub:'아몬드버터 + 바나나 + 시나몬', time:'2분', cal:180, p:7, glp:3, emoji:'🥜🍌',
    situations:['home','office'], timeSlots:['morning','lunch'],
    ing:'아몬드버터 1큰술, 바나나 1/2개, 시나몬 가루 약간',
    steps:'바나나를 슬라이스하고 아몬드버터를 올린 후 시나몬을 뿌려 완성.',
    sci:'덜 익은 바나나 저항성 전분 → 프리바이오틱 → 장내 유익균 → SCFA → GLP-1 간접 촉진.' },
  { id:12, cat:'nut', name:'피칸 메이플 요거트볼', sub:'피칸 + 그릭요거트 + 메이플', time:'3분', cal:220, p:13, glp:4, emoji:'🥜🍁',
    situations:['home'], timeSlots:['morning','lunch'],
    ing:'그릭요거트 100g, 피칸 5~6개, 퓨어 메이플시럽 1/2작은술, 시나몬 약간',
    steps:'그릭요거트에 피칸을 올리고 메이플시럽을 살짝 뿌려 완성.',
    sci:'피칸은 견과류 중 항산화 능력(ORAC) 최고. 그릭요거트 유청 단백질 → GLP-1 즉시 분비.' },
  { id:13, cat:'nut', name:'트레일 믹스 배치팩', sub:'아몬드 + 호박씨 + 건크랜베리', time:'0분', cal:170, p:6, glp:3, emoji:'🥜🎒',
    situations:['office','outdoor','quick'], timeSlots:['morning','lunch','dinner'],
    ing:'아몬드 7개, 호박씨 1큰술, 건크랜베리(무가당) 1큰술, 해바라기씨 1작은술',
    steps:'주말에 10팩을 지퍼백에 미리 소분. 매일 가방에 1팩 넣고 출근.',
    sci:'호박씨 마그네슘(1큰술=37mg) → 인슐린 감수성 지원. 건크랜베리 폴리페놀 → L-세포 자극.' },

  // 🫘 두부/콩 기반 (4종)
  { id:14, cat:'tofu', name:'연두부 들기름 한 그릇', sub:'연두부 + 들기름 + 깨소금', time:'2분', cal:130, p:8, glp:3, emoji:'🫘',
    situations:['home','office'], timeSlots:['morning','lunch','dinner'],
    ing:'연두부 1팩(150g), 들기름 1큰술, 깨소금, 간장 약간',
    steps:'연두부에 들기름+깨소금+간장. 전자레인지 30초 데우면 고소함 상승.',
    sci:'대두 단백 8g + 들기름 오메가-3 + 이소플라본 대사 건강 지원. 편의점 연두부로 어디서든.' },
  { id:15, cat:'tofu', name:'낫또 에그 드롭', sub:'낫또 + 계란 노른자 + 김', time:'3분', cal:170, p:14, glp:4, emoji:'🫘🥚',
    situations:['home'], timeSlots:['morning','lunch'],
    ing:'낫또 1팩(45g), 달걀 노른자 1개, 김 2장, 간장, 겨자 약간',
    steps:'낫또에 달걀 노른자, 간장, 겨자를 넣고 잘 섞은 후 김에 싸서 섭취.',
    sci:'낫또 발효 대두 단백 14g → GLP-1 자극. 프로바이오틱 → 장내 유익균 직접 공급으로 인크레틴 반응을 돕습니다.' },
  { id:16, cat:'tofu', name:'에다마메 올리브유 샐러드', sub:'풋콩 + EVOO + 레몬 + 고춧가루', time:'5분', cal:160, p:11, glp:4, emoji:'🫘🍋',
    situations:['home','office'], timeSlots:['lunch','dinner'],
    ing:'냉동 에다마메 100g, EVOO 1큰술, 레몬즙, 소금·후추, 고춧가루 약간',
    steps:'에다마메 전자레인지 2분 해동 후 EVOO+레몬즙+소금+후추 버무리기.',
    sci:'식물성 단백질 11g + 식이섬유 4g → 이중 GLP-1 자극. EVOO 폴리페놀 L-세포 추가 활성화.' },
  { id:17, cat:'tofu', name:'두부김치 프리로드', sub:'두부 + 김치 + 들기름', time:'3분', cal:140, p:10, glp:4, emoji:'🫘🌶️',
    situations:['home'], timeSlots:['lunch','dinner'],
    ing:'부드러운 두부 100g, 김치 50g, 들기름, 참깨 약간',
    steps:'두부에 잘 익은 김치를 올리고 들기름+참깨. 두부를 살짝 데우면 더 맛있음.',
    sci:'두부 단백질+김치 프로바이오틱+김치 식이섬유 = 단백질+프로바이오틱+프리바이오틱 삼중 GLP-1. 한국형 Triple Pathway.' },

  // 🥤 쉐이크/음료 (4종)
  { id:18, cat:'shake', name:'IMEM 프리로드 쉐이크', sub:'유청 + PHGG + EVOO (Triple Pathway)', time:'2분', cal:150, p:20, glp:5, emoji:'🥤⚡',
    situations:['home','office'], timeSlots:['morning','lunch','dinner'],
    ing:'WPI 1스쿱(25g), PHGG 파우더 5g, EVOO 1작은술, 물 200ml',
    steps:'쉐이커에 넣고 30초 흔들기. 식전 15분에 섭취.',
    sci:'유청 WPI 20g → GLP-1 +141%(Am J Clin Nutr 2023). PHGG 5g → SCFA → GLP-1(경로2). EVOO 폴리페놀(경로3). 세 경로 동시.' },
  { id:19, cat:'shake', name:'그린 프리로드 스무디', sub:'시금치 + 바나나 + 유청 + 두유', time:'3분', cal:170, p:18, glp:4, emoji:'🥤🥬',
    situations:['home'], timeSlots:['morning','lunch'],
    ing:'유청 단백질 1/2스쿱(12g), 시금치 한 줌(30g), 바나나 1/2개, 두유 200ml',
    steps:'블렌더에 모든 재료를 넣고 30초 갈아 마시기.',
    sci:'시금치 틸라코이드가 식욕 억제 호르몬 추가 자극. 유청 단백질 GLP-1 선제 분비.' },
  { id:20, cat:'shake', name:'예르바 마테 프로틴 라떼', sub:'마테차 + 두유 + 유청', time:'5분', cal:130, p:15, glp:4, emoji:'🥤🌿',
    situations:['home','office'], timeSlots:['morning','lunch'],
    ing:'예르바 마테 티백 1개, 두유 100ml, 유청 단백질 1/2스쿱(12g), 꿀 약간(선택)',
    steps:'마테를 뜨거운 물 100ml에 3분 우린 후, 따뜻한 두유+유청 단백질 넣어 저어 마시기.',
    sci:'예르바 마테 클로로겐산+페룰산 → GLP-1 증가. 유청+두유 이중 단백질 → 강력 GLP-1 자극.' },
  { id:21, cat:'shake', name:'골든 밀크 프리로드', sub:'두유 + 강황 + 생강 + 시나몬', time:'5분', cal:100, p:7, glp:3, emoji:'🥤🌙',
    situations:['home'], timeSlots:['dinner'],
    ing:'두유 200ml, 강황 가루 1/2작은술, 생강 가루, 후추 한 꼬집, 꿀, 시나몬 약간',
    steps:'두유를 약불에서 데우면서 강황+생강+후추+시나몬을 넣고 저어줌. 꿀을 넣어 마무리.',
    sci:'커큐민(강황) 항염증 → 장 환경 개선 → GLP-1 기저 수준 향상. 피페린(후추) 커큐민 흡수율 2000% 증가.' },

  // ⚡ 초간단/편의점 (5종)
  { id:22, cat:'quick', name:'편의점 프리로드 세트', sub:'반숙란 2개 + 스트링치즈', time:'0분', cal:160, p:18, glp:4, emoji:'🏪',
    situations:['office','outdoor','quick'], timeSlots:['morning','lunch','dinner'],
    ing:'편의점 반숙란 2개, 스트링치즈 1개',
    steps:'사서 뜯어 바로 먹기. 조리 제로. 점심 약속 15분 전 로비에서 섭취.',
    sci:'반숙란 단백질 12g + 스트링치즈 카세인 6g = 총 18g → 유의미한 GLP-1 분비. 칼슘 GLP-1 추가 촉진.' },
  { id:23, cat:'quick', name:'프로틴 바 + EVOO 포션팩', sub:'단백질바 + 올리브유 소포장', time:'1분', cal:230, p:20, glp:4, emoji:'🍫🫒',
    situations:['office','outdoor','quick'], timeSlots:['morning','lunch','dinner'],
    ing:'프로틴 바 1개(단백질 20g+, 당류 5g 이하), EVOO 포션팩 1개(10ml)',
    steps:'프로틴 바를 먹으면서 EVOO 포션팩을 함께 마시기.',
    sci:'프로틴 바 유청/카세인 20g → 강력 GLP-1. EVOO 폴리페놀 L-세포 추가 활성화. 가방 상비로 언제든 프리로드 가능.' },
  { id:24, cat:'quick', name:'삶은 계란 + 김', sub:'최소 버전 프리로드', time:'0분', cal:80, p:6, glp:2, emoji:'🥚🍙',
    situations:['office','outdoor','quick'], timeSlots:['morning','lunch','dinner'],
    ing:'삶은 계란 1개, 김 2~3장',
    steps:'김에 싸서 먹기. 가장 미니멀한 프리로드.',
    sci:'계란 1개(6g)만으로도 식전 단백질 반응 활성화. 최소 유효 용량. 80kcal 부담 제로.' },
  { id:25, cat:'quick', name:'그릭요거트 한 컵', sub:'편의점 무가당 그릭요거트', time:'0분', cal:100, p:10, glp:3, emoji:'🥛🏪',
    situations:['office','outdoor','quick'], timeSlots:['morning','lunch','dinner'],
    ing:'편의점 무가당 그릭요거트 1컵(100~150g)',
    steps:'편의점에서 구매하여 그대로 먹기. 스푼 내장 제품 선택.',
    sci:'단백질 10g + 칼슘 → GLP-1 유의미한 자극. 무가당 선택이 핵심. 견과류 추가 시 효과 1.5배.' },
  { id:26, cat:'quick', name:'참치 캔 + 통밀 크래커', sub:'참치 단백질 + 통밀 크래커', time:'1분', cal:170, p:15, glp:3, emoji:'🐟🍘',
    situations:['office','quick'], timeSlots:['lunch','dinner'],
    ing:'참치 캔(100g), 통밀 크래커 3~4장, 후추 약간',
    steps:'참치 캔을 열어 크래커에 올려 먹기. 후추 살짝 뿌리면 풍미 상승.',
    sci:'참치 동물성 단백질 15g → L-세포 직접 자극. 오메가-3 DHA/EPA 항염증+포만감.' },

  // 🍲 한식 스페셜 (4종)
  { id:27, cat:'korean', name:'소고기 장조림', sub:'장조림 + 메추리알 + 깻잎', time:'0분', cal:160, p:18, glp:4, emoji:'🥩',
    situations:['home'], timeSlots:['lunch','dinner'],
    ing:'소고기 장조림 3~4조각, 메추리알 장조림 3개, 깻잎 2장',
    steps:'냉장고에서 꺼내 깻잎에 싸 먹기. 일요일 대량 조리 → 1주일 사용.',
    sci:'소고기 동물성 단백질 18g → 강력 GLP-1. 동물성이 식물성보다 L-세포 자극 효율 높음.' },
  { id:28, cat:'korean', name:'콩나물 들깨 프리로드 국', sub:'콩나물 + 두부 + 들깨가루', time:'7분', cal:120, p:10, glp:4, emoji:'🍲🌿',
    situations:['home'], timeSlots:['morning','lunch','dinner'],
    ing:'콩나물 한 줌, 두부 50g, 들깨가루 1큰술, 국간장, 다진 마늘, 물 200ml',
    steps:'물에 콩나물+두부 5분 끓인 후 들깨가루+국간장으로 간. 따뜻하게 마시기.',
    sci:'콩나물 아스파라긴산 대사 촉진+식이섬유 프리바이오틱. 두부 단백질 10g → GLP-1.' },
  { id:29, cat:'korean', name:'청국장 계란 한 그릇', sub:'청국장 + 계란 + 두부', time:'5분', cal:180, p:16, glp:5, emoji:'🍲🥚',
    situations:['home'], timeSlots:['lunch','dinner'],
    ing:'청국장 2큰술, 계란 1개, 두부 50g, 호박 약간, 대파, 고춧가루, 물 200ml',
    steps:'청국장 풀고 두부+호박 끓인 후 계란 풀기. 대파+고춧가루로 마무리.',
    sci:'Bacillus subtilis 발효 프로바이오틱+대두·계란 단백 16g+식이섬유 4g = 한식 Triple Pathway.' },
  { id:30, cat:'korean', name:'오트밀 달걀죽', sub:'귀리 + 계란 + 참기름 + 김가루', time:'7분', cal:200, p:14, glp:4, emoji:'🍲🌾',
    situations:['home'], timeSlots:['morning'],
    ing:'즉석 오트밀 30g, 계란 1개, 참기름, 김가루, 소금 약간, 물 250ml',
    steps:'물에 오트밀 약불 3분 끓임. 계란 풀어 넣고 1분 더. 참기름+김가루로 마무리.',
    sci:'귀리 베타글루칸(수용성 섬유 4g) → SCFA 생산 → GLP-1 간접 촉진. 위장에 부담 없는 따뜻한 프리로드.' },
];

// Situation labels for inline keyboard
const SITUATIONS = [
  { id:'office',  label:'🏢 사무실' },
  { id:'home',    label:'🏠 집' },
  { id:'outdoor', label:'✈️ 외출' },
  { id:'quick',   label:'⚡ 초간단' },
];

/**
 * Recommend a recipe for a given situation, current hour, and recent history.
 * @param {string} situation - office|home|outdoor|quick
 * @param {number} hour - 0~23 (current local hour)
 * @param {string[]} recentIds - recipe IDs used in last 3 days (to avoid repeats)
 * @returns {Object} recipe
 */
function recommendRecipe(situation, hour, recentIds = []) {
  const timeSlot = hour < 11 ? 'morning' : hour < 16 ? 'lunch' : 'dinner';

  let candidates = RECIPES.filter(r => r.situations.includes(situation));
  const byTime = candidates.filter(r => r.timeSlots.includes(timeSlot));
  if (byTime.length > 0) candidates = byTime;

  // Exclude recently used
  const fresh = candidates.filter(r => !recentIds.includes(String(r.id)));
  if (fresh.length > 0) candidates = fresh;

  // Sort by GLP-1 score desc, pick top
  candidates.sort((a, b) => b.glp - a.glp);
  return candidates[0] || RECIPES[0];
}

/**
 * Format a recipe as a Telegram message card.
 */
function formatRecipeCard(recipe) {
  const stars = '★'.repeat(recipe.glp) + '☆'.repeat(5 - recipe.glp);
  return [
    `${recipe.emoji} <b>#${recipe.id} ${recipe.name}</b>`,
    `<i>${recipe.sub}</i>`,
    ``,
    `⏱ ${recipe.time} | 🔥 ${recipe.cal}kcal | 💪 단백질 ${recipe.p}g | GLP-1 ${stars}`,
    ``,
    `📝 <b>재료:</b> ${recipe.ing}`,
    ``,
    `👨‍🍳 <b>만들기:</b> ${recipe.steps}`,
    ``,
    `🔬 <b>과학:</b> ${recipe.sci}`,
  ].join('\n');
}

/**
 * Format a short recipe preview for the recommendation step (before detail).
 */
function formatRecipePreview(recipe) {
  const stars = '★'.repeat(recipe.glp) + '☆'.repeat(5 - recipe.glp);
  return [
    `${recipe.emoji} <b>#${recipe.id} ${recipe.name}</b>`,
    `<i>${recipe.sub}</i>`,
    `⏱ ${recipe.time} | 💪 ${recipe.p}g | GLP-1 ${stars}`,
  ].join('\n');
}

module.exports = { RECIPES, SITUATIONS, recommendRecipe, formatRecipeCard, formatRecipePreview };
