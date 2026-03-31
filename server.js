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

// Предзаполнение пользователей
const users = [
  { username: 'Ирина', role: 'admin', pin: '205858' },
  { username: 'Илья', role: 'member' },
  { username: 'Ульяна', role: 'member' },
  { username: 'Николай', role: 'member' }
];

users.forEach(u => {
  const hash = u.pin ? crypto.createHash('sha256').update(u.pin).digest('hex') : null;
  db.prepare('INSERT OR IGNORE INTO users (username, role, pin_hash) VALUES (?, ?, ?)').run(u.username, u.role, hash);
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({ dir: dataDir, db: 'sessions.db' }),
  secret: 'family-menu-secret-888',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true }
}));

// Auth
app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') {
    const hash = crypto.createHash('sha256').update(pin || '').digest('hex');
    if (hash !== user.pin_hash) return res.status(401).json({ error: 'Неверный PIN' });
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

// Pantry
app.get('/api/pantry', (req, res) => {
  res.json(db.prepare('SELECT * FROM pantry').all());
});

app.post('/api/pantry', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).send();
  const { product, quantity, unit } = req.body;
  db.prepare('INSERT OR REPLACE INTO pantry (product, quantity, unit) VALUES (?, ?, ?)').run(product, quantity, unit);
  res.json({ success: true });
});

// Recipes Import (TheMealDB)
async function importRecipes() {
  const count = db.prepare('SELECT COUNT(*) as c FROM recipes').get().c;
  if (count >= 300) return;
  console.log('Импорт рецептов...');
  const categories = ['Beef', 'Chicken', 'Dessert', 'Lamb', 'Pork', 'Seafood', 'Side', 'Starter', 'Vegetarian', 'Breakfast'];
  for (const cat of categories) {
    try {
      const res = await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?c=${cat}`);
      const data = await res.json();
      if (!data.meals) continue;
      for (const m of data.meals.slice(0, 40)) {
        const detailRes = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${m.idMeal}`);
        const detail = await detailRes.json();
        const meal = detail.meals[0];
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
          if (meal[`strIngredient${i}`]) {
            ingredients.push({ name: meal[`strIngredient${i}`], amount: meal[`strMeasure${i}`] });
          }
        }
        db.prepare('INSERT OR IGNORE INTO recipes (name_en, category, ingredients, instructions, image_url, health_score) VALUES (?, ?, ?, ?, ?, ?)')
          .run(meal.strMeal, cat, JSON.stringify(ingredients), meal.strInstructions, meal.strMealThumb, Math.floor(Math.random() * 10) + 1);
      }
    } catch (e) { console.error(e); }
  }
}
importRecipes();

// Menu Generation Algorithm
app.post('/api/menu/generate', async (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).send();
  
  // Погода
  let temp = 20;
  try {
    const weather = await fetch('https://api.open-meteo.com/v1/forecast?latitude=59.93&longitude=30.31&current_weather=true');
    const wData = await weather.json();
    temp = wData.current_weather.temperature;
  } catch (e) {}

  const allRecipes = db.prepare('SELECT * FROM recipes').all();
  const options = [];
  
  for (let opt = 0; opt < 4; opt++) {
    const menu = {
      days: []
    };
    
    for (let d = 0; d < 7; d++) {
      const isWeekend = d >= 5;
      const day = {
        breakfast: { main: getRandom(allRecipes, 'Breakfast'), drink: 'Чай/Кофе' },
        dinner: { 
          salad: getRandom(allRecipes, temp > 20 ? 'Vegetarian' : 'Starter'),
          side: getRandom(allRecipes, 'Side'),
          main: getRandom(allRecipes, ['Beef', 'Chicken', 'Seafood', 'Pork']),
          dessert: getRandom(allRecipes, 'Dessert'),
          drink: 'Компот'
        }
      };
      if (isWeekend) {
        day.lunch = {
          salad: getRandom(allRecipes, 'Starter'),
          soup: getRandom(allRecipes, temp < 15 ? 'Beef' : 'Vegetarian'),
          dessert: getRandom(allRecipes, 'Dessert'),
          drink: 'Сок'
        };
      }
      menu.days.push(day);
    }
    options.push(menu);
  }

  db.prepare('DELETE FROM menu_candidates').run();
  options.forEach((opt, i) => {
    db.prepare('INSERT INTO menu_candidates (option_index, data) VALUES (?, ?)').run(i, JSON.stringify(opt));
  });
  
  res.json({ success: true });
});

function getRandom(list, cats) {
  if (!Array.isArray(cats)) cats = [cats];
  const filtered = list.filter(r => cats.includes(r.category));
  return filtered[Math.floor(Math.random() * filtered.length)] || list[0];
}

app.get('/api/menu/candidates', (req, res) => {
  const data = db.prepare('SELECT * FROM menu_candidates').all();
  res.json(data.map(d => ({ ...d, data: JSON.parse(d.data) })));
});

app.post('/api/menu/vote', (req, res) => {
  if (!req.session.userId) return res.status(401).send();
  const { option_index } = req.body;
  db.prepare('INSERT OR REPLACE INTO votes (user_id, option_index, week_id) VALUES (?, ?, 1)').run(req.session.userId, option_index);
  
  // Проверка завершения голосования
  const totalVotes = db.prepare('SELECT COUNT(*) as c FROM votes WHERE week_id = 1').get().c;
  if (totalVotes >= 4) {
    const winner = db.prepare('SELECT option_index, COUNT(*) as c FROM votes WHERE week_id = 1 GROUP BY option_index ORDER BY c DESC LIMIT 1').get();
    const winData = db.prepare('SELECT data FROM menu_candidates WHERE option_index = ?').get(winner.option_index).data;
    db.prepare('INSERT INTO weekly_menu (start_date, data) VALUES (?, ?)').run(new Date().toISOString(), winData);
    db.prepare('UPDATE menu_candidates SET status = "approved" WHERE option_index = ?').run(winner.option_index);
    
    // Генерация списка покупок
    const menu = JSON.parse(winData);
    db.prepare('DELETE FROM shopping_list').run();
    const pantry = db.prepare('SELECT product FROM pantry').all().map(p => p.product.toLowerCase());
    
    // Плоская выборка всех ингредиентов
    menu.days.forEach(day => {
      [day.breakfast, day.lunch, day.dinner].forEach(meal => {
        if (!meal) return;
        Object.values(meal).forEach(recipe => {
          if (recipe && recipe.ingredients) {
            const ings = JSON.parse(recipe.ingredients);
            ings.forEach(i => {
              const inHome = pantry.includes(i.name.toLowerCase()) ? 1 : 0;
              db.prepare('INSERT INTO shopping_list (product, quantity, unit, in_pantry) VALUES (?, ?, ?, ?)').run(i.name, 1, i.amount, inHome);
            });
          }
        });
      });
    });
  }
  res.json({ success: true });
});

app.get('/api/shopping', (req, res) => {
  res.json(db.prepare('SELECT * FROM shopping_list').all());
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
