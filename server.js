const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Database setup
const db = new Database(path.join(dataDir, 'family_menu.db'));

// Init tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    ingredients TEXT,
    steps TEXT,
    category TEXT DEFAULT 'other',
    servings INTEGER DEFAULT 2,
    cook_time INTEGER DEFAULT 30,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS menu_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    recipe_id INTEGER,
    custom_meal TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  );
  CREATE TABLE IF NOT EXISTS shopping_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item TEXT NOT NULL,
    quantity TEXT,
    unit TEXT,
    checked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'family-menu-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
};

// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const hash = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password, name) VALUES (?, ?, ?)');
    const result = stmt.run(username, hash, name || username);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    req.session.name = name || username;
    res.json({ success: true, user: { id: result.lastInsertRowid, username, name: name || username } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.name = user.name;
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, name FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

// Recipes routes
app.get('/api/recipes', requireAuth, (req, res) => {
  const recipes = db.prepare('SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  res.json(recipes);
});

app.post('/api/recipes', requireAuth, (req, res) => {
  try {
    const { title, description, ingredients, steps, category, servings, cook_time } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const stmt = db.prepare('INSERT INTO recipes (user_id, title, description, ingredients, steps, category, servings, cook_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(req.session.userId, title, description || '', ingredients || '', steps || '', category || 'other', servings || 2, cook_time || 30);
    res.json({ id: result.lastInsertRowid, ...req.body, user_id: req.session.userId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/recipes/:id', requireAuth, (req, res) => {
  try {
    const { title, description, ingredients, steps, category, servings, cook_time } = req.body;
    const recipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    db.prepare('UPDATE recipes SET title=?, description=?, ingredients=?, steps=?, category=?, servings=?, cook_time=? WHERE id=?')
      .run(title, description, ingredients, steps, category, servings, cook_time, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/recipes/:id', requireAuth, (req, res) => {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Menu plans
app.get('/api/menu', requireAuth, (req, res) => {
  const { week } = req.query;
  const plans = db.prepare(`
    SELECT mp.*, r.title as recipe_title, r.description as recipe_desc
    FROM menu_plans mp
    LEFT JOIN recipes r ON mp.recipe_id = r.id
    WHERE mp.user_id = ? AND mp.date LIKE ?
    ORDER BY mp.date, mp.meal_type
  `).all(req.session.userId, week ? `${week}%` : '%');
  res.json(plans);
});

app.post('/api/menu', requireAuth, (req, res) => {
  try {
    const { date, meal_type, recipe_id, custom_meal } = req.body;
    const existing = db.prepare('SELECT id FROM menu_plans WHERE user_id=? AND date=? AND meal_type=?').get(req.session.userId, date, meal_type);
    if (existing) {
      db.prepare('UPDATE menu_plans SET recipe_id=?, custom_meal=? WHERE id=?').run(recipe_id || null, custom_meal || null, existing.id);
      res.json({ success: true, id: existing.id });
    } else {
      const result = db.prepare('INSERT INTO menu_plans (user_id, date, meal_type, recipe_id, custom_meal) VALUES (?, ?, ?, ?, ?)').run(req.session.userId, date, meal_type, recipe_id || null, custom_meal || null);
      res.json({ success: true, id: result.lastInsertRowid });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/menu/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM menu_plans WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// Shopping list
app.get('/api/shopping', requireAuth, (req, res) => {
  const items = db.prepare('SELECT * FROM shopping_list WHERE user_id=? ORDER BY checked, created_at DESC').all(req.session.userId);
  res.json(items);
});

app.post('/api/shopping', requireAuth, (req, res) => {
  try {
    const { item, quantity, unit } = req.body;
    if (!item) return res.status(400).json({ error: 'Item required' });
    const result = db.prepare('INSERT INTO shopping_list (user_id, item, quantity, unit) VALUES (?, ?, ?, ?)').run(req.session.userId, item, quantity || '', unit || '');
    res.json({ id: result.lastInsertRowid, item, quantity, unit, checked: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/shopping/:id', requireAuth, (req, res) => {
  const { checked } = req.body;
  db.prepare('UPDATE shopping_list SET checked=? WHERE id=? AND user_id=?').run(checked ? 1 : 0, req.params.id, req.session.userId);
  res.json({ success: true });
});

app.delete('/api/shopping/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM shopping_list WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

app.delete('/api/shopping', requireAuth, (req, res) => {
  db.prepare('DELETE FROM shopping_list WHERE user_id=? AND checked=1').run(req.session.userId);
  res.json({ success: true });
});

// Generate shopping list from menu
app.post('/api/shopping/generate', requireAuth, (req, res) => {
  try {
    const { week } = req.body;
    const plans = db.prepare(`
      SELECT r.ingredients FROM menu_plans mp
      JOIN recipes r ON mp.recipe_id = r.id
      WHERE mp.user_id=? AND mp.date LIKE ?
    `).all(req.session.userId, `${week}%`);
    const allIngredients = plans.map(p => p.ingredients).join('\n');
    const lines = allIngredients.split('\n').filter(l => l.trim());
    const added = [];
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[-*]\s*/, '');
      if (trimmed) {
        db.prepare('INSERT INTO shopping_list (user_id, item) VALUES (?, ?)').run(req.session.userId, trimmed);
        added.push(trimmed);
      }
    }
    res.json({ success: true, added: added.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Family Menu server running on port ${PORT}`);
});
