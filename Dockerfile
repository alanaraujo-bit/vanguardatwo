# VANGUARDA realtime game server (co-op) — deploy na Railway.
# O bundle esbuild embute todo o código (src/game + server); só `pg` e `ws`
# ficam como deps de runtime dentro do bundle... na prática o bundle embute
# tudo que é JS puro; `pg` também é embutido (pg-native fica external e nunca
# é usado). Resultado: imagem = node + um arquivo.
#
# Envs necessárias no serviço Railway:
#   JWT_SECRET       — o MESMO da Vercel (valida os tokens de /api/realtime-token)
#   DATABASE_URL     — o Postgres já existente na Railway
#   ALLOWED_ORIGINS  — ex: https://vanguardatwo.vercel.app (separar por vírgula)
#   PORT             — injetada pela Railway automaticamente
#
# A Vercel, por sua vez, builda o cliente com WS_URL=wss://<este-serviço>.up.railway.app

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts/build-server.mjs scripts/
COPY src ./src
COPY api/_lib ./api/_lib
COPY server ./server
RUN node scripts/build-server.mjs

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/server/dist/index.js ./index.js
EXPOSE 8138
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8138}/healthz || exit 1
CMD ["node", "index.js"]
