#!/bin/bash
cd /var/app/family-menu
git pull origin main
npm install
pm2 restart family-menu
