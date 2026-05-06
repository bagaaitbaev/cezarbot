#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt update
apt upgrade -y

apt install -y \
  curl git ca-certificates gnupg build-essential \
  libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 \
  libxss1 libxshmfence1 fonts-liberation unzip

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

npm install -g pm2

if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi

mkdir -p /opt
cd /opt

if [ ! -d cezarbot ]; then
  git clone https://github.com/bagaaitbaev/cezarbot.git cezarbot
fi

cd /opt/cezarbot
git pull origin main
npm install
mkdir -p data

cat > deploy.sh <<'EOF'
#!/usr/bin/env bash
set -e
cd /opt/cezarbot
git pull origin main
npm install
npm run export:data || true
pm2 restart cezar-telegram || true
pm2 restart cezar-whatsapp || true
pm2 save
EOF

chmod +x deploy.sh

node -v
npm -v
pm2 -v

echo "SERVER_READY"
