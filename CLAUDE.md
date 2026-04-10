# IncretinA i — 프로젝트 컨텍스트

> 새 대화를 시작할 때 Claude가 자동으로 읽는 파일입니다.
> 작업 후 "현재 진행 상태" 섹션을 업데이트해 주세요.

## 프로젝트 개요

**IncretinA i** — 인크레틴 호르몬 기반 대사 건강 관리 앱 + 텔레그램 AI 코치 봇.
IMEM(Incretin Metabolic Efficiency Model) v2.0의 α/β/γ 계수를 기반으로 10개 루틴 + 8개 위험 요인을 추적하고, 텔레그램 봇이 자연어 코칭·식사 기록·루틴 체크를 수행합니다.

## 아키텍처

### 앱 (PWA, GitHub Pages)
- **배포 파일**: `IncretinAi_v7.0_Adaptive.html` (루트) — 이것이 실제 사용자가 보는 파일
- **작업 사본**: `인크레티나_ELISHA/최신/IncretinAi_v7.0.html` — 변경 시 반드시 배포 파일과 동기화
- **GitHub Pages**: `novakim77-glitch/elisha-incretinai` 레포, master 브랜치
- Single-file HTML PWA (Firebase SDK inline, Chart.js inline)

### 텔레그램 봇 (Fly.io)
- **소스**: `.claude/worktrees/imem-core-extract/apps/incretina-bot/src/`
  - `index.js` — grammY bot 엔트리, 명령어 라우팅
  - `claude.js` — Claude Sonnet 4.5 API 연동, 페르소나 3종, 도구 호출
  - `store.js` — Firestore 읽기/쓰기 (paths, setRoutineChecks, saveMealLog 등)
  - `commands/chat.js` — 자연어 대화 핸들러 (get_today_status, log_meal 등)
  - `commands/check.js` — /check 명령어 (루틴 토글)
  - `commands/_shared.js` — resolveUser, checksObjToArray
  - `scheduler.js` — 시간대별 알림 스케줄
  - `notifiers.js` — 텔레그램 푸시 알림
- **배포**: `/opt/homebrew/bin/flyctl deploy --app incretina-bot --ha=false`
- **프레임워크**: grammY (Telegram Bot API)

### 공통 패키지
- `.claude/worktrees/imem-core-extract/packages/imem-core/`
  - `schema.js` — Firestore paths, EVENT enum, SOURCE enum, _meta 헬퍼
  - `constants.js` — routine[], risks[] 정의
  - `index.js` — getUserWeek, getUnlockedRoutineIndices, 점수 계산

### 데이터베이스 (Firestore)
- `users/{uid}` — 프로필, telegramChatId, notifyPrefs
- `users/{uid}/dailyRoutines/{YYYY-MM-DD}` — checks(map), riskChecks(map), recoveries(map), weight, meals[], score, imem 계수
- `users/{uid}/events/{auto-id}` — Schema v2 이벤트 로그 (append-only)
- `linkCodes/{6자리코드}` — 텔레그램 연결용 임시 코드

## 핵심 규칙 (반드시 준수)

### 데이터 동기화
- **checks/riskChecks/recoveries는 map `{0:true, 1:false, ...}` 형태**로 저장. 배열로 쓰면 봇 데이터 덮어씀
- **saveDailyToCloud는 touched-set 방식**: `_userTouchedRoutines` Set에 담긴 인덱스만 저장, 나머지는 `merge:true`가 클라우드 값 보존
- **`_normalizeMap()`**: array든 map이든 안전하게 boolean 배열로 변환하는 유틸 — loadDateData, saveDailyToCloud, checkBadges에서 사용
- **weight 필드**: 사용자가 실제 입력한 경우만 기록 (빈 값이면 기록 안 함 → 봇이 기록한 체중 보존)

### 파일 동기화
- `IncretinAi_v7.0_Adaptive.html` (배포)와 `인크레티나_ELISHA/최신/IncretinAi_v7.0.html` (작업 사본)은 **항상 동일하게 유지**
- 한쪽만 수정하면 사용자가 보는 앱과 작업 파일이 달라져서 혼란 발생

### 봇 배포
- 봇 코드 수정 후 반드시 Fly.io 재배포
- 로컬에서 `npm run dev` 돌리면 Fly.io 인스턴스와 **polling conflict** 발생 — 하나만 실행

### 코드 스타일
- 앱 HTML은 minified single-line JS (가독성보다 파일 크기 우선)
- 봇은 일반 Node.js 스타일

## 텔레그램 봇 페르소나 (3종)

1. **따뜻한 대사 코치** (`empathetic`) — 감정 공감 + 작은 실천 칭찬
2. **GLP-1 전문 임상의** (`clinical`) — IMEM 지표 + GLP-1 기전 + 과학적 식단 + 건기식 추천
3. **강인한 트레이너** (`driver`) — 짧고 강한 푸시 + 운동·식단 강조

변경: 텔레그램에서 "페르소나 변경" 입력 → InlineKeyboard 선택

## 주요 기능 목록

- 10개 루틴 체크 (Progressive Unlocking by week)
- 8개 위험 요인 + 회복 미션
- IMEM v2.0 실시간 계수 (α/β/γ)
- Bio-Sync Timer (골든타임 카운트다운)
- 체중 추이 차트 + 4주 예측
- 오늘의 식사 카드 (봇 사진 분석 + 채팅 텍스트 기록)
- 텔레그램 봇 연동 (코드 발급 → /link)
- 시간대별 텔레그램 알림 (06:30~22:00)
- 게이미피케이션 (XP, 레벨, 뱃지, 퀘스트)
- 대시보드 접기/펼치기 (차트·IMEM 상세)

## 과거 주요 버그 & 교훈

| 버그 | 원인 | 교훈 |
|------|------|------|
| 봇 루틴 체크가 앱에 안 보임 | app이 checks를 전체 map으로 덮어씀 → 봇 마크 삭제 | touched-set 방식 필수 |
| recoveries.forEach 터짐 | map으로 바꿨는데 .forEach 호출 남아있음 | _normalizeMap 통일 |
| checkBadges 무한루프 | .filter() on map object → TypeError → 반복 호출 | array/map 양쪽 처리 |
| 코드 발급 버튼 멈춤 | Firestore offline 큐잉, set() 미응답 | 8초 타임아웃 + enableNetwork |
| 앱 수정했는데 반영 안 됨 | 배포 파일이 아닌 작업 사본만 수정 | 두 파일 항상 동기화 |

## 현재 진행 상태

> 마지막 업데이트: 2026-04-10

- 대시보드 UX 개선 완료 (카드 재배치, 접기, 봇 상태 배너)
- saveDailyToCloud 클라우드 기반 병합 방식으로 최종 수정 완료
- 텔레그램 코드 발급 안정화 완료 (오프라인 차단, 토큰 갱신, 타임아웃)
- checkBadges 무한루프 + 회로 차단기 수정 완료
- 웹 브로셔 (brochure.html) 완료

### 다음 할 일 / 알려진 이슈
- 봇 응답 테스트 필요 (polling conflict 여부 확인)
- 앱 재설치 후 텔레그램 재연결 테스트 필요
- 최신/ 작업 사본과 배포 파일 간 diff 정리 필요
