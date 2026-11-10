FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Explicit file list: nothing else (no .env, no .git) can end up in the image, even if .dockerignore is changed.
COPY package.json index.js map.html ./

# no runtime dependencies, so no npm install; run as the unprivileged "node" user from the base image
USER node
EXPOSE 3000

# Config comes only from the environment at runtime: docker run --env-file .env / compose env_file
CMD ["node", "index.js"]
