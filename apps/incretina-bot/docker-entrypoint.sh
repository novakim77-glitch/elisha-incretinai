#!/bin/sh
set -e

# Materialize Firebase service account JSON from env into a file.
if [ -n "$GOOGLE_SA_JSON" ]; then
  echo "$GOOGLE_SA_JSON" > /app/sa.json
  chmod 600 /app/sa.json
else
  echo "⚠️  GOOGLE_SA_JSON env not set — Firebase Admin will fail"
fi

exec "$@"
