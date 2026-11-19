FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY ceremony.js server.js ./
COPY public ./public
COPY data ./data
ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173
CMD ["node", "server.js"]
