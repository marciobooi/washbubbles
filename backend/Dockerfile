FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run prisma:generate || true

EXPOSE 3000
CMD ["npm", "start"]
