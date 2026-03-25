#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/security-ops-dashboard}"

echo "[1/7] Installing system packages"
sudo apt-get update
sudo apt-get install -y curl git nginx apache2-utils rsync

if ! command -v node >/dev/null 2>&1; then
  echo "[2/7] Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "[3/7] Installing PM2"
sudo npm install -g pm2

echo "[4/7] Preparing application directory"
sudo mkdir -p "${APP_DIR}"
sudo chown -R "$USER":"$USER" "${APP_DIR}"

echo "[5/7] Copy project files"
rsync -av --delete ./ "${APP_DIR}/" --exclude node_modules

cd "${APP_DIR}"

echo "[6/7] Installing Node.js dependencies"
npm install --omit=dev

echo "[7/7] Creating runtime directories"
sudo mkdir -p /etc/nginx/snippets /var/www/html
sudo touch /var/log/nginx/security_dashboard_access.log
sudo chown www-data:adm /var/log/nginx/security_dashboard_access.log

echo "Setup complete. Next: configure .env, install Nginx config, then start with PM2."
