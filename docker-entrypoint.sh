#!/bin/bash
set -e

if [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && { [ -n "$R2_ENDPOINT" ] || [ -n "$R2_ACCOUNT_ID" ]; }; then
    BUCKET="${R2_BUCKET_NAME:-cadence-data}"
    ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
    echo "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" > /root/.passwd-s3fs
    chmod 600 /root/.passwd-s3fs
    mkdir -p /app/backend/data
    s3fs "$BUCKET" /app/backend/data \
        -o url="$ENDPOINT" \
        -o use_path_request_style \
        -o passwd_file=/root/.passwd-s3fs
    echo "Mounted bucket '$BUCKET' from $ENDPOINT at /app/backend/data"
fi

# Mock Jira: run the app's own backend corpus as a stand-in Jira API on a local
# port, so the Sync pipeline has something to fetch without real Jira access.
# JIRA_URL is pointed at this by wrangler.toml [vars] when USE_MOCK_JIRA=1.
if [ "$USE_MOCK_JIRA" = "1" ]; then
    echo "Starting mock Jira on 127.0.0.1:9876"
    python3 -m uvicorn tools.mock_jira:app --app-dir backend --host 127.0.0.1 --port 9876 &
fi

exec uvicorn server:app --app-dir backend --host 0.0.0.0 --port 8000
