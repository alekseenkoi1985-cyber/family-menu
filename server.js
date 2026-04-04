const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'family_menu.db'));

// Инициализация БД
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    role TEXT,
    pin_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ru TEXT,
    name_en TEXT,
    category TEXT,
    ingredients TEXT,
    instructions TEXT,
    image_url TEXT,
    health_score INTEGER,
    rating REAL DEFAULT 5.0
  );
  CREATE TABLE IF NOT EXISTS pantry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product TEXT UNIQUE,
    quantity REAL,
    unit TEXT
  );
  CREATE TABLE IF NOT EXISTS menu_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gen_date TEXT,
    option_index INTEGER,
    data TEXT,
    status TEXT DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS weekly_menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT,
    data TEXT,
    status TEXT DEFAULT 'approved'
  );
  CREATE TABLE IF NOT EXISTS votes (
    user_id INTEGER,
    option_index INTEGER,
    week_id INTEGER,
    PRIMARY KEY(user_id, week_id)
  );
  CREATE TABLE IF NOT EXISTS shopping_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product TEXT,
    quantity REAL,
    unit TEXT,
    in_pantry INTEGER DEFAULT 0
  );
`);

// Пользователи
const USERS = [
  { username: 'Ирина', role: 'admin', pin: '205858' },
  { username: 'Илья', role: 'member' },
  { username: 'Ульяна', role: 'member' },
  { username: 'Николай', role: 'member' }
];

USERS.forEach(u => {
  const hash = u.pin ? crypto.createHash('sha256').update(u.pin).digest('hex') : null;
  db.prepare('INSERT OR IGNORE INTO users (username, role, pin_hash) VALUES (?, ?, ?)').run(u.username, u.role, hash);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({ dir: dataDir, db: 'sessions.db' }),
  secret: 'family-menu-secret-888',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true }
}));

// API: Auth
app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') {
    const hash = crypto.createHash('sha256').update(pin || '').digest('hex');
    if (hash !== user.pin_hash) return res.status(401).json({ error: 'Неверный PIN-код' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ success: true, user: { username: user.username, role: user.role } });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ username: req.session.username, role: req.session.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API: Pantry (Кладовая)
app.get('/api/pantry', (req, res) => {
  res.json(db.prepare('SELECT * FROM pantry ORDER BY product').all());
});

app.post('/api/pantry', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  const { product, quantity, unit } = req.body;
  if (!product) return res.status(400).json({ error: 'Укажите продукт' });
  db.prepare('INSERT OR REPLACE INTO pantry (product, quantity, unit) VALUES (?, ?, ?)').run(product.trim(), quantity || 0, unit || 'шт');
  res.json({ success: true });
});

app.delete('/api/pantry/:id', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  db.prepare('DELETE FROM pantry WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// API: Recipes
app.get('/api/recipes/count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM recipes').get();
  res.json(count);
});

// Улучшенная генерация меню (Шаг 2)
app.post('/api/menu/generate', async (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  
  let temp = 15;
  try {
    const wr = await fetch('https://api.open-meteo.com/v1/forecast?latitude=59.93&longitude=30.31&current_weather=true');
    const wd = await wr.json();
    temp = wd.current_weather.temperature;
  } catch(e) { console.log('Weather fallback'); }

  const pantryItems = db.prepare('SELECT product FROM pantry').all().map(p => p.product.toLowerCase());
  const allRecipes = db.prepare('SELECT * FROM recipes').all();
  if (allRecipes.length < 50) return res.status(400).json({ error: 'Недостаточно рецептов в базе (нужно >50)' });

  const scoreRecipe = (r) => {
    let score = 50;
    // Погода
    if (temp < 10 && ['Beef','Lamb','Pork'].includes(r.category)) score += 20;
    if (temp > 22 && ['Vegetarian','Starter','Dessert'].includes(r.category)) score += 20;
    // Кладовая
    try {
      const ings = JSON.parse(r.ingredients || '[]');
      const match = ings.filter(i => pantryItems.some(p => i.name.toLowerCase().includes(p))).length;
      score += (match * 10);
    } catch(e) {}
    return score + (Math.random() * 20);
  };

  const getBest = (cats, count=1) => {
    if (!Array.isArray(cats)) cats = [cats];
    let filtered = allRecipes.filter(r => cats.includes(r.category));
    if (!filtered.length) filtered = allRecipes;
    return filtered.sort((a,b) => scoreRecipe(b) - scoreRecipe(a)).slice(0, count + 5).sort(() => Math.random() - 0.5)[0];
  };

  db.prepare('DELETE FROM menu_candidates').run();
  db.prepare('DELETE FROM votes').run();

  for (let opt = 0; opt < 4; opt++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const isWeekend = d >= 5;
      const day = {
        breakfast: { main: getBest('Breakfast'), drink: temp > 18 ? 'Холодный сок' : 'Горячий чай' },
        dinner: { 
          salad: getBest(temp > 20 ? ['Vegetarian','Starter'] : 'Starter'),
          side: getBest('Side'),
          main: getBest(['Beef','Chicken','Seafood','Pork','Lamb']),
          dessert: getBest('Dessert'),
          drink: temp > 20 ? 'Морс' : 'Чай с лимоном'
        }
      };
      if (isWeekend) {
        day.lunch = {
          salad: getBest(['Starter','Vegetarian']),
          soup: getBest(temp < 15 ? ['Beef','Lamb','Pork'] : ['Vegetarian','Chicken']),
          dessert: getBest('Dessert'),
          drink: 'Компот'
        };
      }
      days.push(day);
    }
    db.prepare('INSERT INTO menu_candidates (option_index, gen_date, data) VALUES (?, ?, ?)').run(opt, new Date().toISOString(), JSON.stringify({ days }));
  }
  res.json({ success: true });
});

app.get('/api/menu/candidates', (req, res) => {
  const rows = db.prepare('SELECT * FROM menu_candidates ORDER BY option_index').all();
  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

app.get('/api/menu/weekly', (req, res) => {
  const row = db.prepare('SELECT * FROM weekly_menu ORDER BY id DESC LIMIT 1').get();
  res.json(row || {});
});

app.post('/api/menu/vote', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  const { option_index } = req.body;
  db.prepare('INSERT OR REPLACE INTO votes (user_id, option_index, week_id) VALUES (?, ?, 1)').run(req.session.userId, option_index);
  
  const totalVotes = db.prepare('SELECT COUNT(*) as c FROM votes WHERE week_id = 1').get().c;
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  
  if (totalVotes >= totalUsers) {
    const winner = db.prepare('SELECT option_index, COUNT(*) as c FROM votes WHERE week_id = 1 GROUP BY option_index ORDER BY c DESC LIMIT 1').get();
    const winRow = db.prepare('SELECT data FROM menu_candidates WHERE option_index = ?').get(winner.option_index);
    if (winRow) {
      db.prepare('INSERT INTO weekly_menu (start_date, data, status) VALUES (?, ?, ?)').run(new Date().toISOString(), winRow.data, 'approved');
      const menu = JSON.parse(winRow.data);
      db.prepare('DELETE FROM shopping_list').run();
      const pantryItems = db.prepare('SELECT product FROM pantry').all().map(p => p.product.toLowerCase().trim());
      const added = new Set();
      menu.days.forEach(day => {
        [day.breakfast, day.lunch, day.dinner].filter(Boolean).forEach(meal => {
          Object.values(meal).forEach(recipe => {
            if (recipe && recipe.ingredients) {
              try {
                const ings = JSON.parse(recipe.ingredients);
                ings.forEach(ing => {
                  const name = ing.name.trim();
                  if (!added.has(name.toLowerCase())) {
                    added.add(name.toLowerCase());
                    const inP = pantryItems.some(p => name.toLowerCase().includes(p)) ? 1 : 0;
                    db.prepare('INSERT INTO shopping_list (product, quantity, unit, in_pantry) VALUES (?, ?, ?, ?)').run(name, 1, ing.amount || '', inP);
                  }
                });
              } catch(e) {}
            }
          });
        });
      });
    }
  }
  res.json({ success: true });
});

app.get('/api/shopping', (req, res) => {
  res.json(db.prepare('SELECT * FROM shopping_list ORDER BY in_pantry, product').all());
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
