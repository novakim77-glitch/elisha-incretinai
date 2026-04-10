// IMEM Core — shared constants
// Extracted 1:1 from IncretinAi_v7.0.html (lines 1324-1370)

const routine = [
  { t:"07:00", title:"생체 리듬 리셋",            icon:"🌅", pts:8,  imem:"α",     action:"기상 10분 내 직사광선 5분 + 물 300ml" },
  { t:"08:30", title:"커피 대사 부스트",          icon:"☕", pts:5,  imem:"α",     action:"무가당 블랙커피 1잔" },
  { t:"09:00", title:"14h 단식 해제",             icon:"🍳", pts:7,  imem:"α",     action:"첫 음식 섭취 + 14시간 공복 달성" },
  { t:"11:00", title:"호르몬 프리로드",           icon:"🥜", pts:12, imem:"β_pre", action:"점심 30분 전 단백질 15g + 식이섬유 5g", crit:true },
  { t:"12:00", title:"인크레틴 시퀀스",           icon:"🥗", pts:13, imem:"β_seq", action:"채소 → 단백질 → 탄수화물 순서 고수",   crit:true },
  { t:"12:50", title:"글루코스 클리어런스",       icon:"🚶", pts:13, imem:"β_seq", action:"식후 40분 내 빠른 걷기 30~40분",       crit:true },
  { t:"19:00", title:"저녁 마감 (Metabolic Switch)", icon:"⏰", pts:17, imem:"α", action:"19시 이전 마지막 식사 완료",          crit:true },
  { t:"20:30", title:"근육 방어 보호막",          icon:"💪", pts:10, imem:"γ",     action:"스쿼트 등 대근육 중심 근력운동 30분" },
  { t:"22:00", title:"멜라토닌 세이프가드",       icon:"🌙", pts:8,  imem:"α",     action:"블루라이트 차단 및 실내 조도 낮추기" },
  { t:"23:00", title:"심층 대사 복구",            icon:"😴", pts:7,  imem:"α",     action:"완전 암막 환경에서 7~8시간 숙면" },
];

const risks = [
  { id:"R-01", title:"늦잠 / 기상 지연",       penalty:-5,  recPts:5, coeff:"α", recovery:"광자 샤워: 즉시 10분간 햇빛 쬐기" },
  { id:"R-02", title:"가당 음료 / 믹스커피",   penalty:-8,  recPts:4, coeff:"β", recovery:"계단 5층 오르기" },
  { id:"R-03", title:"프리로드 건너뜀",        penalty:-6,  recPts:3, coeff:"β", recovery:"물 500ml 원샷" },
  { id:"R-04", title:"식사 순서 위반",         penalty:-10, recPts:6, coeff:"β", recovery:"채소 긴급 투입: 채소 5분 먼저 씹기" },
  { id:"R-05", title:"1시간+ 연속 좌식",       penalty:-4,  recPts:4, coeff:"γ", recovery:"스쿼트 10회" },
  { id:"R-06", title:"19시 이후 늦은 식사",    penalty:-12, recPts:8, coeff:"α", recovery:"내일 아침 단식 1시간 연장" },
  { id:"R-07", title:"야식 섭취",              penalty:-20, recPts:8, coeff:"α", recovery:"즉시 양치질 + 20분 스트레칭" },
  { id:"R-08", title:"블루라이트 노출",        penalty:-6,  recPts:3, coeff:"α", recovery:"폰 끄기 + 5분 명상" },
];

// v7.0 Progressive Unlocking
const UNLOCK_SCHEDULE = {
  1: [3, 4, 5],
  2: [6, 0],
  3: [1, 2, 7],
  4: [8, 9],
};
const RISK_UNLOCK_WEEK = 3;

module.exports = { routine, risks, UNLOCK_SCHEDULE, RISK_UNLOCK_WEEK };
