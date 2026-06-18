FROM node:20-slim

ENV NODE_ENV=development

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install

COPY . /app

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
