#!/bin/bash

# Update and install dependencies
sudo apt-get update
sudo apt-get install -y nodejs npm nginx sqlite3 curl

# Install PM2 globally
sudo npm install -g pm2

# Create app directory
sudo mkdir -p /var/app/family-menu
sudo chown -R $USER:$USER /var/app/family-menu
cd /var/app/family-menu

# Create backend files
cat <<EOF > server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const db = new sqlite3.Database('./data.db');

app.use(express.json());
app.use(express.static('public'));

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY, title TEXT, ingredients TEXT, instructions TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY, item TEXT, quantity TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS menu (id INTEGER PRIMARY KEY, day TEXT, recipe_id INTEGER)");
});

app.get('/api/recipes', (req, res) => {
  db.all("SELECT * FROM recipes", [], (err, rows) => {
    res.json(rows);
  });
});

app.listen(3000, () => console.log('Server running on port 3000'));
EOF

cat <<EOF > package.json
{
  "name": "family-menu",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6"
  }
}
EOF

npm install

# Build/Create frontend (static)
mkdir public
cat <<EOF > public/index.html
<!DOCTYPE html>
<html>
<head>
    <title>Семейное Меню</title>
    <script src=\"https://cdn.tailwindcss.com\"></script>
</head>
<body class=\"bg-gray-100\">
    <div class=\"max-w-4xl mx-auto p-8\">
        <h1 class=\"text-3xl font-bold mb-4\">Семейное Меню</h1>
        <div id=\"app\">Загрузка...</div>
    </div>
    <script>
        fetch('/api/recipes').then(r => r.json()).then(data => {
            document.getElementById('app').innerHTML = \`<p>Рецептов в базе: \${data.length}</p>\`;
        });
    </script>
</body>
</html>
EOF

# Nginx config
sudo cat <<EOF > /etc/nginx/sites-available/family-menu
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_cache_bypass \\\$http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/family-menu /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

# Start app with PM2
pm2 start server.js --name \"family-menu\"
pm2 save
pm2 startup
