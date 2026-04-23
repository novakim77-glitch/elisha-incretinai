#!/bin/bash
# IncretinA i Bot — Fly.io 배포 스크립트
# 실행: bash deploy.sh
# macOS + /opt/homebrew/bin/flyctl 필요

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BOT_DIR="$SCRIPT_DIR"
IMEM_SRC="$REPO_ROOT/packages/imem-core"
IMEM_BUNDLE="$BOT_DIR/imem-core-bundle"
PKG_BACKUP="$BOT_DIR/package.json.bak"

# ── 정리 함수 (항상 실행) ──
cleanup() {
  echo "🧹 임시 파일 정리..."
  # package.json 원복
  if [ -f "$PKG_BACKUP" ]; then
    cp "$PKG_BACKUP" "$BOT_DIR/package.json"
    rm -f "$PKG_BACKUP"
  fi
  # 임시 bundle / docker 파일 삭제
  rm -rf "$IMEM_BUNDLE"
  rm -f "$BOT_DIR/Dockerfile" "$BOT_DIR/.dockerignore" "$BOT_DIR/fly.toml"
  # resource fork 파일 정리
  find "$BOT_DIR" -name "._*" -exec rm -f {} \; 2>/dev/null || true
  echo "✅ 정리 완료"
}
trap cleanup EXIT

set -e

echo "🚀 IncretinA i Bot 배포 시작"
echo "   Bot dir : $BOT_DIR"
echo "   Repo root: $REPO_ROOT"

# 1. macOS 리소스 포크 파일 사전 정리
echo "🧹 ._* 리소스 포크 파일 사전 정리..."
find "$BOT_DIR"   -name "._*" -exec rm -f {} \; 2>/dev/null || true
find "$IMEM_SRC"  -name "._*" -exec rm -f {} \; 2>/dev/null || true
find "$REPO_ROOT/packages" -name "._*" -exec rm -f {} \; 2>/dev/null || true

# 2. imem-core 번들 복사
echo "📦 imem-core 번들 복사..."
rm -rf "$IMEM_BUNDLE"
cp -r "$IMEM_SRC" "$IMEM_BUNDLE"
rm -rf "$IMEM_BUNDLE/node_modules" 2>/dev/null || true
# resource fork from copy
find "$IMEM_BUNDLE" -name "._*" -exec rm -f {} \; 2>/dev/null || true

# 3. package.json 임시 수정 (imem-core 경로)
echo "✏️  package.json 경로 패치..."
cp "$BOT_DIR/package.json" "$PKG_BACKUP"
sed -i '' 's|file:../../packages/imem-core|file:./imem-core-bundle|g' "$BOT_DIR/package.json"

# 4. Dockerfile 생성 (XATTR 없이 — printf 사용)
echo "📄 Dockerfile 생성..."
printf 'FROM node:20-alpine\nWORKDIR /app\nCOPY package.json ./\nCOPY imem-core-bundle ./imem-core-bundle\nRUN npm install --omit=dev --ignore-scripts\nCOPY docker-entrypoint.sh ./\nRUN chmod +x docker-entrypoint.sh\nCOPY src ./src\nENV GOOGLE_APPLICATION_CREDENTIALS=/app/sa.json\nENTRYPOINT ["./docker-entrypoint.sh"]\nCMD ["node","src/index.js"]\n' > "$BOT_DIR/Dockerfile"

# 5. .dockerignore 생성
printf 'node_modules/\n.env\n.env.*\nfirebase-service-account.json\n.DS_Store\n._*\n*.log\npackage.json.bak\ndeploy.sh\nfly.toml\n' > "$BOT_DIR/.dockerignore"

# 6. fly.toml 생성
printf 'app = "incretina-bot"\nprimary_region = "nrt"\n\n[build]\n  dockerfile = "Dockerfile"\n\n[deploy]\n  strategy = "immediate"\n\n[env]\n  BOT_MODE = "polling"\n  FIREBASE_PROJECT_ID = "incretina-i-pro"\n  TZ = "Asia/Seoul"\n\n[[vm]]\n  size = "shared-cpu-1x"\n  memory = "256mb"\n' > "$BOT_DIR/fly.toml"

# 7. resource fork 재정리 (파일 생성 후)
find "$BOT_DIR" -name "._*" -exec rm -f {} \; 2>/dev/null || true

# 8. 배포
echo "🛫 flyctl deploy..."
cd "$BOT_DIR"
/opt/homebrew/bin/flyctl deploy --app incretina-bot --ha=false

echo "🎉 배포 성공!"
