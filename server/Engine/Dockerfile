FROM node:22-bookworm-slim AS data
WORKDIR /src
COPY scripts/fetch-server-data.mjs scripts/fetch-server-data.mjs
COPY shared/server-data.lock.json shared/server-data.lock.json
RUN node scripts/fetch-server-data.mjs /seed

FROM node:22-bookworm-slim AS classic
WORKDIR /src
COPY scripts/fetch-classic.mjs scripts/fetch-classic.mjs
COPY shared/classic-assets.lock.json shared/classic-assets.lock.json
RUN node scripts/fetch-classic.mjs /assets/classic

FROM data AS profile
COPY --from=classic /assets/classic /classic
COPY scripts/native-map.mjs scripts/prepare-classic-world.mjs scripts/
COPY shared/classic-experience.json shared/classic-experience.json
COPY shared/classic-storage.json shared/classic-storage.json
COPY tests/native-map.test.mjs tests/native-map.test.mjs
RUN node --test tests/native-map.test.mjs && node scripts/prepare-classic-world.mjs /seed /classic /profile

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY upstream/openmir2 upstream/openmir2
COPY server/openmir2-linux.patch server/openmir2-linux.patch
RUN git -C upstream/openmir2 apply --ignore-space-change /src/server/openmir2-linux.patch
COPY server/openmir2-status.patch server/openmir2-status.patch
RUN git -C upstream/openmir2 apply /src/server/openmir2-status.patch
RUN --mount=type=cache,target=/root/.nuget/packages \
    for project in GameSrv DBSrv LoginSrv LoginGate SelGate GameGate Storeages/DBSvr.Storage.MySQL; do \
      dotnet publish upstream/openmir2/src/$project/${project##*/}.csproj \
        -c Release --nologo -v quiet -p:PublishTrimmed=false -p:PublishSingleFile=false -p:PublishAot=false \
        -o /engine/${project##*/} || exit 1; \
    done
COPY tests/native tests/native
RUN dotnet run --project tests/native/NativeChecks.csproj -c Release --nologo
COPY tests/status tests/status
RUN dotnet run --project tests/status/StatusChecks.csproj -c Release --nologo
COPY tests/login-channel tests/login-channel
RUN dotnet run --project tests/login-channel/LoginChannelChecks.csproj -c Release --nologo

FROM mcr.microsoft.com/dotnet/runtime:8.0
COPY --from=data /usr/local/bin/node /usr/local/bin/node
COPY --from=data /seed /seed
COPY --from=profile /profile /profile
COPY --from=build /engine /engine
WORKDIR /app
COPY server/Engine/run.mjs run.mjs
EXPOSE 7000 7100 7200 8081
HEALTHCHECK --interval=5s --timeout=3s --start-period=90s CMD ["node", "run.mjs", "--health"]
ENTRYPOINT ["node", "run.mjs"]
