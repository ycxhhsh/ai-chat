FROM node:18-alpine
WORKDIR /app
RUN npm init -y && npm install y-websocket@^1.0.0 ws lib0
EXPOSE 1234
ENV HOST=0.0.0.0 PORT=1234
CMD ["node", "./node_modules/y-websocket/bin/server.js"]
