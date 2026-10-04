FROM node:22-bookworm-slim AS web-build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci
COPY web web
COPY shared shared
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS server-build
WORKDIR /src
COPY upstream/crystal/Shared upstream/crystal/Shared
COPY upstream/crystal/Server upstream/crystal/Server
COPY server server
COPY shared shared
RUN dotnet publish server/MirHost/MirHost.csproj -c Release -o /out/game
RUN dotnet publish server/WebGateway/WebGateway.csproj -c Release -o /out/web

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS game
WORKDIR /app
COPY --from=server-build /out/game .
RUN mkdir /data && chown app:app /data
USER app
WORKDIR /data
EXPOSE 7000 7001
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s CMD ["dotnet", "/app/MirHost.dll", "--health"]
ENTRYPOINT ["dotnet", "/app/MirHost.dll"]

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS web
WORKDIR /app
COPY --from=server-build /out/web .
COPY --from=web-build /src/web/dist wwwroot
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=6s --start-period=20s CMD ["dotnet", "WebGateway.dll", "--health"]
ENTRYPOINT ["dotnet", "WebGateway.dll"]
