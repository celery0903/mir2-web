FROM node:22-bookworm-slim AS assets
WORKDIR /src
COPY scripts/fetch-classic.mjs scripts/fetch-classic.mjs
COPY shared/classic-assets.lock.json shared/classic-assets.lock.json
RUN node scripts/fetch-classic.mjs /assets/classic

FROM node:22-bookworm-slim AS web-build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci
COPY web web
COPY shared shared
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS gateway-build
WORKDIR /src
COPY upstream/openmir2 upstream/openmir2
COPY server/WebGateway server/WebGateway
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish server/WebGateway/WebGateway.csproj -c Release -o /gateway --nologo -v quiet

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=gateway-build /gateway .
COPY --from=web-build /src/web/dist wwwroot
COPY --from=assets /assets/classic wwwroot/assets/classic
USER app
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=4s --start-period=20s CMD ["dotnet", "WebGateway.dll", "--health"]
ENTRYPOINT ["dotnet", "WebGateway.dll"]
