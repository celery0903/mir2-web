FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY upstream/mir2-client/package.json upstream/mir2-client/package-lock.json ./
RUN npm ci
COPY upstream/mir2-client/apps apps
COPY upstream/mir2-client/content content
COPY shared/classic-magic.json content/classic-176/magic-effects.json
COPY upstream/mir2-client/tsconfig.json tsconfig.json
COPY upstream/mir2-client/tests/frontend_regression.mjs tests/frontend_regression.mjs
COPY server/source-client.patch /tmp/source-client.patch
COPY server/source-tests.patch /tmp/source-tests.patch
COPY server/source-magic.patch /tmp/source-magic.patch
COPY tests/source-magic.test.mjs tests/source-magic.test.mjs
RUN git apply /tmp/source-client.patch && git apply /tmp/source-magic.patch && git apply --include=tests/frontend_regression.mjs /tmp/source-tests.patch && MIR_MAGIC_CLIENT_ROOT=/src node --test tests/source-magic.test.mjs && npm run test:web && npm run build

FROM nginx:1.28-alpine
COPY --from=build /src/dist/web /usr/share/nginx/html
COPY server/SourceClient/nginx.conf /etc/nginx/nginx.conf
LABEL org.opencontainers.image.source="https://github.com/leiniaozl229/mir2" org.opencontainers.image.revision="77e3ff7506b1ca55cac15df247cb2fcedd69c535"
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=4s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
