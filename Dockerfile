FROM node:22-alpine
WORKDIR /app
COPY server ./server
COPY web ./web
COPY data ./data
ENV PORT=8080 DATA_DIR=/app/data WEB_DIR=/app/web
EXPOSE 8080
CMD ["node", "server/server.js"]
