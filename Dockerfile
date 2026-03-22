FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    ffmpeg \
    unzip \
    imagemagick \
    libheif-examples \
    libde265-0 \
    libheif1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
