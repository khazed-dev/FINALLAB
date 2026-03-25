#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing Nginx configuration files"
sudo mkdir -p /etc/nginx/conf.d /etc/nginx/snippets /var/www/html
sudo cp "${ROOT_DIR}/config/nginx/conf.d/security-dashboard-log-format.conf" /etc/nginx/conf.d/security-dashboard-log-format.conf
sudo cp "${ROOT_DIR}/config/nginx/conf.d/security-dashboard-rate-zone.conf" /etc/nginx/conf.d/security-dashboard-rate-zone.conf
sudo cp "${ROOT_DIR}/config/nginx/conf.d/security-dashboard-conn-zone.conf" /etc/nginx/conf.d/security-dashboard-conn-zone.conf
sudo cp "${ROOT_DIR}/config/nginx/snippets/security-dashboard-defense.conf" /etc/nginx/snippets/security-dashboard-defense.conf
sudo cp "${ROOT_DIR}/config/nginx/emergency.html" /var/www/html/security-dashboard-emergency.html
sudo cp "${ROOT_DIR}/config/nginx/security-dashboard-site.conf" /etc/nginx/sites-available/security-dashboard.conf
sudo ln -sf /etc/nginx/sites-available/security-dashboard.conf /etc/nginx/sites-enabled/security-dashboard.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "Nginx configuration installed successfully."
