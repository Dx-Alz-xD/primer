# Primer on a host that runs containers (Railway, Fly.io, Render...). No dependencies to install: the
# server is plain Node 24. Keep data/ on a persistent volume mounted at /app/data (accounts, lessons,
# uploads); the AI keys come from the host's environment variables, never from a file in the image.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PRIMER_TRUST_PROXY=1
COPY package.json README.md ./
COPY server ./server
COPY assets ./assets
COPY *.html ./
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "server/index.mjs"]
