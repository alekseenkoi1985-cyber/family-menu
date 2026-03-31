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

app.get('/api/pantry', (req, res) => {
  res.json(db.prepare('SELECT * FROM pantry ORDER BY product').all());
});

app.post('/api/pantry', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  const { product, quantity, unit } = req.body;
  if (!product) return res.status(400).json({ error: 'Укажите продукт' });
  db.prepare('INSERT OR REPLACE INTO pantry (product, quantity, unit) VALUES (?, ?, ?)').run(product, quantity || 0, unit || 'шт');
  res.json({ success: true });
});

app.delete('/api/pantry/:id', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  db.prepare('DELETE FROM pantry WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/recipes/count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM recipes').get();
  res.json(count);
});

async function importRecipes() {
  const count = db.prepare('SELECT COUNT(*) as c FROM recipes').get().c;
  if (count >= 200) return console.log('Рецепты уже импортированы:', count);
  console.log('Начинаю импорт рецептов из TheMealDB...');
  const categories = ['Beef','Chicken','Dessert','Lamb','Pork','Seafood','Side','Starter','Vegetarian','Breakfast'];
  for (const cat of categories) {
    try {
      const r = await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?c=${cat}`);
      const data = await r.json();
      if (!data.meals) continue;
      for (const m of data.meals.slice(0, 35)) {
        try {
          const dr = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${m.idMeal}`);
          const dd = await dr.json();
          const meal = dd.meals[0];
          const ings = [];
          for (let i = 1; i <= 20; i++) {
            if (meal[`strIngredient${i}`] && meal[`strIngredient${i}`].trim()) {
              ings.push({ name: meal[`strIngredient${i}`].trim(), amount: (meal[`strMeasure${i}`] || '').trim() });
            }
          }
          db.prepare('INSERT OR IGNORE INTO recipes (name_en, category, ingredients, instructions, image_url, health_score) VALUES (?, ?, ?, ?, ?, ?)').run(
            meal.strMeal, cat, JSON.stringify(ings), meal.strInstructions || '', meal.strMealThumb || '',
            Math.floor(Math.random() * 5) + 5
          );
        } catch(e) {}
      }
    } catch(e) { console.error('Ошибка категории', cat, e.message); }
  }
  console.log('Импорт завершён. Итого:', db.prepare('SELECT COUNT(*) as c FROM recipes').get().c);
}

importRecipes();

app.post('/api/menu/generate', async (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  let temp = 15;
  try {
    const wr = await fetch('https://api.open-meteo.com/v1/forecast?latitude=59.93&longitude=30.31&current_weather=true');
    const wd = await wr.json();
    temp = wd.current_weather.temperature;
  } catch(e) { console.log('Погода недоступна, используем', temp); }

  const allRecipes = db.prepare('SELECT * FROM recipes').all();
  if (allRecipes.length < 10) return res.status(400).json({ error: 'Недостаточно рецептов. Дождитесь импорта.' });

  const getR = (cats) => {
    if (!Array.isArray(cats)) cats = [cats];
    const f = allRecipes.filter(r => cats.includes(r.category));
    return f.length ? f[Math.floor(Math.random() * f.length)] : allRecipes[Math.floor(Math.random() * allRecipes.length)];
  };

  db.prepare('DELETE FROM menu_candidates').run();
  db.prepare('DELETE FROM votes').run();

  for (let opt = 0; opt < 4; opt++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const isWeekend = d >= 5;
      const day = {
        breakfast: {
          main: getR('Breakfast'),
          drink: temp > 18 ? 'Сок / Смузи' : 'Чай / Кофе'
        },
        dinner: {
          salad: getR(temp > 20 ? ['Vegetarian','Starter'] : ['Starter']),
          side: getR('Side'),
          main: getR(['Beef','Chicken','Seafood','Pork','Lamb']),
          dessert: getR('Dessert'),
          drink: temp > 20 ? 'Компот / Морс' : 'Чай / Кофе'
        }
      };
      if (isWeekend) {
        day.lunch = {
          salad: getR(['Starter','Vegetarian']),
          soup: getR(temp < 12 ? ['Beef','Lamb'] : ['Vegetarian','Chicken']),
          dessert: getR('Dessert'),
          drink: 'Сок'
        };
      }
      days.push(day);
    }
    db.prepare('INSERT INTO menu_candidates (option_index, gen_date, data) VALUES (?, ?, ?)').run(opt, new Date().toISOString(), JSON.stringify({ days }));
  }
  res.json({ success: true, message: 'Сгенерировано 4 варианта меню' });
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

      const addedProducts = new Set();
      menu.days.forEach(day => {
        [day.breakfast, day.lunch, day.dinner].filter(Boolean).forEach(meal => {
          Object.values(meal).forEach(recipe => {
            if (recipe && typeof recipe === 'object' && recipe.ingredients) {
              try {
                const ings = JSON.parse(recipe.ingredients);
                ings.forEach(ing => {
                  const key = ing.name.toLowerCase().trim();
                  if (!addedProducts.has(key)) {
                    addedProducts.add(key);
                    const inP = pantryItems.includes(key) ? 1 : 0;
                    db.prepare('INSERT INTO shopping_list (product, quantity, unit, in_pantry) VALUES (?, ?, ?, ?)').run(ing.name, 1, ing.amount || '', inP);
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

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
