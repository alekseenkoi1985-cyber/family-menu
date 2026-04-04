#!/bin/bash
set -e

echo "====================================="
echo "Семейное Меню - Deploy"
echo "====================================="

APP_DIR="/var/www/family-menu"

cd $APP_DIR

echo "[1/3] Pull latest changes..."
git clean -fd
git reset --hard HEAD
git pull origin main

echo "[2/3] Running install script..."
chmod +x install.sh
./install.sh

echo "[3/3] Restarting application..."
pm2 restart family-menu || pm2 start server/dist/index.js --name family-menu

echo "====================================="
echo "Деплой завершен! 🚀"
echo "Приложение: http://85.239.44.237"
echo "====================================="
