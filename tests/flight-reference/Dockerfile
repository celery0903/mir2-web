FROM node:22-bookworm-slim
RUN apt-get update
RUN apt-get install -y --no-install-recommends fp-compiler
ENTRYPOINT ["fpc"]
