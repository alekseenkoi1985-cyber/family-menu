'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_PATH     = path.join(__dirname, 'family-menu.db');
const ZIP_URL     = 'https://github.com/chipslays/russian-recipes-parser/archive/refs/heads/master.zip';
const ZIP_FILE    = '/tmp/recipes-src.zip';
const EXTRACT_DIR = '/tmp/recipes-src';
const RECIPES_DIR = `${EXTRACT_DIR}/russian-recipes-parser-master/storage/recipes`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
    get(url);
  });
}

function parseTime(str) {
  if (!str) return 30;
  const h = str.match(/(\d+)\s*час/);
  const m = str.match(/(\d+)\s*мин/);
  return ((h ? +h[1] : 0) * 60) + (m ? +m[1] : 30);
}

function calcHealthScore(recipe) {
  let score = 5;
  if (recipe.vegan) score += 2;
  if (recipe.difficulty === 'Низкая') score += 1;
  const cat = (recipe.category || '').toLowerCase();
  if (cat.includes('салат') || cat.includes('суп')) score += 1;
  if (cat.includes('выпечка') || cat.includes('торт') || cat.includes('десерт')) score -= 1;
  return Math.min(10, Math.max(1, score));
}

function buildIngredients(raw) {
  const result = [];
  if (!Array.isArray(raw)) return JSON.stringify(result);
  for (const group of raw) {
    for (const item of (group.list || [])) {
      if (!item.name) continue;
      let amount = '';
      if (item.value && item.type) amount = item.value + ' ' + item.type;
      else if (item.amount) amount = item.amount;
      result.push({ name: item.name, amount });
    }
  }
  return JSON.stringify(result);
}

function buildInstructions(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((s, i) => (i+1) + '. ' + (s.text || '')).filter(s => s.length > 3).join('\n');
}

async function main() {
  const Database = require('better-sqlite3');

  if (!fs.existsSync(DB_PATH)) {
    console.error('БД не найдена: ' + DB_PATH);
    process.exit(1);
  }

  if (!fs.existsSync(ZIP_FILE)) {
    console.log('Скачиваем архив рецептов (~25 МБ)...');
    await download(ZIP_URL, ZIP_FILE);
    console.log('Архив скачан.');
  } else {
    console.log('Архив уже есть, пропускаем загрузку.');
  }

  if (!fs.existsSync(EXTRACT_DIR)) {
    console.log('Распаковываем...');
    execSync('unzip -q "' + ZIP_FILE + '" -d "' + EXTRACT_DIR + '"');
    console.log('Готово.');
  }

  console.log('Читаем файлы рецептов...');
  const allFiles = [];
  for (const batch of fs.readdirSync(RECIPES_DIR)) {
    const batchPath = path.join(RECIPES_DIR, batch);
    if (!fs.statSync(batchPath).isDirectory()) continue;
    for (const file of fs.readdirSync(batchPath)) {
      if (file.endsWith('.json')) allFiles.push(path.join(batchPath, file));
    }
  }
  console.log('Найдено файлов: ' + allFiles.length);

  const db = new Database(DB_PATH);
  try { db.exec('ALTER TABLE recipes ADD COLUMN instructions TEXT'); } catch {}
  try { db.exec('ALTER TABLE recipes ADD COLUMN cookingtime INTEGER DEFAULT 30'); } catch {}
  try { db.exec('ALTER TABLE recipes ADD COLUMN calories INTEGER DEFAULT 0'); } catch {}
  db.exec('CREATE INDEX IF NOT EXISTS idx_recipes_nameru ON recipes(nameru)');

  const existing = new Set(
    db.prepare('SELECT nameru FROM recipes').all().map(r => r.nameru)
  );
  console.log('Уже в БД: ' + existing.size + ' рецептов');

  const insert = db.prepare(
    'INSERT INTO recipes (nameru, nameen, category, ingredients, instructions, imageurl, healthscore, rating, cookingtime, calories) ' +
    'VALUES (@nameru, @nameen, @category, @ingredients, @instructions, @imageurl, @healthscore, @rating, @cookingtime, @calories)'
  );
  const insertMany = db.transaction((rows) => { for (const row of rows) insert.run(row); });

  let added = 0, skipped = 0, batch = [];

  const flush = () => {
    if (!batch.length) return;
    insertMany(batch); added += batch.length; batch = [];
  };

  for (const filePath of allFiles) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { skipped++; continue; }
    const nameru = (raw.title || '').trim();
    if (!nameru || !raw.ingredients || !raw.ingredients.length) { skipped++; continue; }
    if (existing.has(nameru)) { skipped++; continue; }
    existing.add(nameru);
    batch.push({
      nameru, nameen: nameru,
      category:     raw.category || 'Прочее',
      ingredients:  buildIngredients(raw.ingredients),
      instructions: buildInstructions(raw.instruction),
      imageurl:     raw.poster || '',
      healthscore:  calcHealthScore(raw),
      rating:       5.0,
      cookingtime:  parseTime(raw.cooktime),
      calories:     0,
    });
    if (batch.length >= 500) {
      flush();
      process.stdout.write('\rДобавлено: ' + added + ' | Пропущено: ' + skipped + '   ');
    }
  }
  flush();

  const total = db.prepare('SELECT count(*) as c FROM recipes').get().c;
  console.log('\n\nГотово!');
  console.log('  Добавлено новых рецептов: ' + added);
  console.log('  Пропущено (дубли/пустые): ' + skipped);
  console.log('  Итого в базе:             ' + total);
  db.close();

  execSync('rm -rf "' + EXTRACT_DIR + '" "' + ZIP_FILE + '"');
  console.log('Временные файлы удалены.');
}

main().catch(err => { console.error('Ошибка:', err.message); process.exit(1); });
