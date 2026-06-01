# Multi-stage build for the Prequel app.
#
# Build context MUST be the repo root (so the whole pnpm workspace is visible):
#   docker build -f backend/Dockerfile -t <ecr>:latest .
#
# Stage 1 builds the frontend (Vite SPA) and backend (tsup bundle) and prunes a
# production-only backend deployment. Stage 2 is the runtime: a Node image with
# terraform + AWS CLI v2 + Session Manager plugin baked in (required by
# lib/terraform.ts and the file-extraction flow), serving the SPA from ./public.

# ---------- Stage 1: build ----------
FROM node:26-bullseye-slim AS build
# ca-certificates is required by the vite-plus (`vp`) Rust binary, which
# initializes an HTTPS client at startup and aborts if the system CA store is empty.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# Install deps first (cache-friendly): copy manifests + lockfile only.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile

# Build both packages.
COPY . .
RUN pnpm run build

# Produce a self-contained, production-only backend (package.json + prod node_modules).
RUN pnpm --filter @prequel/backend deploy --prod --legacy /app/out

# ---------- Stage 2: runtime ----------
FROM node:26-bullseye-slim AS runtime
WORKDIR /app

# terraform + AWS CLI v2 + Session Manager plugin (arch-detected), carried over
# verbatim from the original portal image — lib/terraform.ts shells these out.
RUN apt-get update && apt-get install -y wget unzip curl && rm -rf /var/lib/apt/lists/*
RUN ARCH=$(case "$(uname -m)" in x86_64) echo "amd64" ;; aarch64) echo "arm64" ;; *) echo "amd64" ;; esac) && \
    SSM_ARCH=$(case "$(uname -m)" in x86_64) echo "64bit" ;; aarch64) echo "arm64" ;; *) echo "64bit" ;; esac) && \
    AWS_ARCH=$(case "$(uname -m)" in x86_64) echo "x86_64" ;; aarch64) echo "aarch64" ;; *) echo "x86_64" ;; esac) && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip \
    && wget https://releases.hashicorp.com/terraform/1.5.7/terraform_1.5.7_linux_${ARCH}.zip \
    && unzip terraform_1.5.7_linux_${ARCH}.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform_1.5.7_linux_${ARCH}.zip \
    && curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_${SSM_ARCH}/session-manager-plugin.deb" -o "session-manager-plugin.deb" \
    && dpkg -i session-manager-plugin.deb \
    && rm session-manager-plugin.deb

ENV NODE_ENV=production
ENV PORT=3000
ENV PUBLIC_DIR=./public

# Production deps + compiled backend bundle + built SPA.
COPY --from=build /app/out/node_modules ./node_modules
COPY --from=build /repo/backend/dist ./dist
COPY --from=build /repo/frontend/dist ./public

EXPOSE 3000
CMD ["node", "dist/server.js"]
