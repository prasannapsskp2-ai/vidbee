FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV YTDLP_PATH=/usr/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

RUN apk add --no-cache yt-dlp ffmpeg python3 make g++

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/downloader-core/package.json packages/downloader-core/package.json
COPY packages/task-queue/package.json packages/task-queue/package.json
COPY packages/subscriptions-core/package.json packages/subscriptions-core/package.json

RUN pnpm install --filter "{./apps/api}..." --frozen-lockfile

COPY apps/api apps/api
COPY apps/desktop/resources/drizzle apps/desktop/resources/drizzle
COPY packages/db packages/db
COPY packages/downloader-core packages/downloader-core
COPY packages/task-queue packages/task-queue
COPY packages/subscriptions-core packages/subscriptions-core

EXPOSE 3100

ENV VIDBEE_API_HOST=0.0.0.0
ENV VIDBEE_API_PORT=3100
ENV VIDBEE_DOWNLOAD_DIR=/data/downloads
# Persistence is enabled by default so the `before-start` history migration
# (legacy download_history → tasks) is actually visible at runtime, and so
# crash-recovery works across container restarts. Mount /data/downloads as
# a persistent volume in production (the Dockerfile already declares it).
# To revert to the old stateless behavior set VIDBEE_PERSIST_QUEUE=0.
ENV VIDBEE_PERSIST_QUEUE=1

VOLUME ["/data/downloads"]

# `before-start` runs migrate-history.ts (legacy download_history → tasks)
# and then boots the API. The script is idempotent so re-runs are safe.
CMD ["pnpm", "--filter", "./apps/api", "run", "before-start"]
