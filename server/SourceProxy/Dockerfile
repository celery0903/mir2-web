FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:e1ffd2a92ae84c1291bc1b6887501f8af98e6331e7af6d4c8d37168c5e87a64c AS build
WORKDIR /src/services/web-gateway
COPY upstream/mir2-client/services/web-gateway .
COPY server/source-proxy.patch /tmp/source-proxy.patch
COPY server/source-minimap-proxy.patch /tmp/source-minimap-proxy.patch
COPY server/source-npc-receipt.patch /tmp/source-npc-receipt.patch
RUN git apply /tmp/source-proxy.patch && git apply /tmp/source-minimap-proxy.patch && git apply /tmp/source-npc-receipt.patch
COPY upstream/mir2-client/tests/GatewayRegression /src/tests/GatewayRegression
COPY upstream/mir2-client/tests/fixtures /src/tests/fixtures
COPY server/source-tests.patch /tmp/source-tests.patch
COPY tests/minimap-proxy /src/tests/minimap-proxy
RUN --mount=type=cache,target=/root/.nuget/packages cd /src && git apply --include=tests/GatewayRegression/Program.cs /tmp/source-tests.patch && dotnet run --project tests/GatewayRegression -c Release --nologo
RUN --mount=type=cache,target=/root/.nuget/packages dotnet run --project /src/tests/minimap-proxy -c Release --nologo
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish -c Release -o /proxy --nologo

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
WORKDIR /app
COPY --from=build /proxy .
USER app
LABEL org.opencontainers.image.source="https://github.com/leiniaozl229/mir2" org.opencontainers.image.revision="77e3ff7506b1ca55cac15df247cb2fcedd69c535"
EXPOSE 8800
HEALTHCHECK --interval=5s --timeout=4s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:8800/health || exit 1
ENTRYPOINT ["dotnet", "WebGateway.dll"]
