FROM node:24-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
EXPOSE 8787
# 启动前自动应用数据库迁移，然后启动服务
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
