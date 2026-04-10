# IncretinA i Bot — Phase 0 Setup Guide

이 가이드는 봇을 처음으로 로컬에서 실행해 `/start`와 `/link`를 검증하기 위한 단계입니다.
소요 시간: 약 30분.

---

## 1. 텔레그램 봇 생성 (5분)

1. 텔레그램에서 [@BotFather](https://t.me/BotFather) 검색
2. `/newbot` 입력
3. 봇 이름: `IncretinA i Coach` (원하는 이름)
4. 봇 핸들: `incretina_coach_bot` (전 세계에서 유일해야 함, 다른 이름이 필요할 수 있음)
5. **HTTP API token 복사** — `7234567890:AAH...` 형태. 절대 공유 금지.

---

## 2. Firebase 서비스 계정 키 발급 (5분)

1. [Firebase Console](https://console.firebase.google.com/) → 프로젝트 `incretina-i-pro`
2. ⚙️ 톱니바퀴 → **Project Settings**
3. **Service accounts** 탭
4. **Generate new private key** 클릭 → JSON 파일 다운로드
5. 다운로드한 파일을 `apps/incretina-bot/firebase-service-account.json` 으로 저장
6. **이 파일은 git에 절대 커밋하지 말 것** (`.gitignore`에 이미 포함)

---

## 3. 환경 변수 설정 (2분)

```bash
cd apps/incretina-bot
cp .env.example .env
```

`.env` 파일을 열고 다음을 채웁니다:

```
TELEGRAM_BOT_TOKEN=7234567890:AAH...     # 1번에서 받은 토큰
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
FIREBASE_PROJECT_ID=incretina-i-pro
BOT_MODE=polling
```

---

## 4. 의존성 설치 (3분)

```bash
cd apps/incretina-bot
npm install
```

만약 `imem-core` 의존성 오류가 나면:

```bash
cd ../../packages/imem-core
npm link
cd ../../apps/incretina-bot
npm link imem-core
```

---

## 5. 첫 실행 (1분)

```bash
npm start
```

성공 시 출력:
```
🤖 IncretinA i Bot — polling mode (dev)
```

---

## 6. 텔레그램에서 검증

1. 텔레그램에서 본인의 봇(`@incretina_coach_bot`) 검색
2. **`/start`** 입력 → 환영 메시지 + 명령어 안내가 와야 함
3. Firestore Console에서 다음 문서가 생성되었는지 확인:
   - `users/tg_{본인chatId}` — standalone 사용자 doc
   - `users/tg_{본인chatId}/integrations/telegram` — 텔레그램 연결 doc
   - `tgChatIndex/{chatId}` — 역인덱스
4. **`/link 482917`** (아무 코드) → "코드를 찾을 수 없어요" 응답이 와야 정상

---

## 7. 검증 체크리스트

- [ ] `/start` 응답이 정상적으로 옴
- [ ] Firestore에 standalone user 문서가 생성됨
- [ ] `_meta.schemaVersion = 2` 가 모든 새 문서에 존재
- [ ] `_meta.source = 'telegram_bot'` 가 모든 새 문서에 존재
- [ ] `/link` 잘못된 코드 입력 시 친절한 오류 메시지가 옴
- [ ] 콘솔에 에러 로그가 없음

---

## 8. Phase 1 으로 넘어가는 시점

위 체크리스트가 모두 통과하면 Phase 1 (`/check`, `/weight`, `/score`, `/golden`)을 시작합니다.
Phase 1 시작 전 결정 사항:
- 앱 측에서 `/link` 코드를 발급하는 UI 자리 (`설정 → 텔레그램 연결`) 추가 필요

---

## 9. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| `TELEGRAM_BOT_TOKEN missing` | `.env` 파일 누락 또는 토큰 미입력 |
| Firebase `permission-denied` | 서비스 계정 키가 올바른 프로젝트가 아님. 키 재발급 |
| `Cannot find module 'imem-core'` | `npm link` 또는 `file:` 의존성 문제. 4번 단계 재시도 |
| 봇이 응답하지 않음 | 다른 인스턴스가 polling 중. 모든 `node` 프로세스 종료 후 재시작 |
