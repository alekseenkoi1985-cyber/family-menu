// Семейное Меню - основной JS
// Версия: fix-2 (13 апреля 2026)

const state = { user: null };

// ─── API helpers ────────────────────────────────────────────────
const api = {
    async get(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    },
    async post(url, data) {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return r.json();
    },
    async del(url) {
        const r = await fetch(url, { method: 'DELETE' });
        return r.json();
    }
};

// ─── UI helpers ─────────────────────────────────────────────────
function showToast(msg, type = 'error') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = type === 'success' ? 'success' : '';
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

// ─── Router ─────────────────────────────────────────────────────
const router = {
    go(page) {
        if (!state.user && page !== 'login') return this.go('login');
        const content = document.getElementById('content');
        const tpl = document.getElementById('tpl-' + page);
        if (!tpl) return;
        content.innerHTML = '';
        content.appendChild(tpl.content.cloneNode(true));

        const nav = document.getElementById('main-nav');
        if (nav) nav.classList.toggle('hidden', page === 'login');

        const navAdmin = document.getElementById('nav-admin');
        if (navAdmin) navAdmin.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));

        if (page === 'pantry')  pantry.load();
        if (page === 'vote')    vote.load();
        if (page === 'shopping') shopping.load();
        if (page === 'admin')   admin.load();
        if (page === 'menu')    menu.load();
    }
};

// ─── Auth ────────────────────────────────────────────────────────
const auth = {
    showPin(name) {
        const modal = document.getElementById('pin-modal');
        if (modal) modal.classList.remove('hidden');
        const input = document.getElementById('pin-input');
        if (input) { input.value = ''; input.focus(); }
        state._pendingPin = name;
    },
    hidePin() {
        const modal = document.getElementById('pin-modal');
        if (modal) modal.classList.add('hidden');
    },
    async loginWithPin() {
        const input = document.getElementById('pin-input');
        const pin = input ? input.value : '';
        await this._doLogin(state._pendingPin || 'Ирина', pin);
    },
    async loginDirect(name) {
        await this._doLogin(name, '');
    },
    async _doLogin(username, pin) {
        const res = await api.post('/api/login', { username, pin });
        if (res.success) {
            state.user = res.user;
            this.hidePin();
            router.go('menu');
        } else {
            showToast(res.error || 'Ошибка входа');
        }
    },
    async logout() {
        await api.post('/api/logout', {});
        state.user = null;
        router.go('login');
    }
};

// ─── Menu ────────────────────────────────────────────────────────
const menu = {
    async load() {
        const container = document.getElementById('active-menu');
        if (!container) return;

        try {
            const [candidates, weekly] = await Promise.all([
                api.get('/api/menu/candidates'),
                api.get('/api/menu/weekly')
            ]);

            let html = '';
            if (weekly && weekly.id) {
                html += '<div class="alert-success">✅ Активное меню выбрано семьёй</div>';
                html += renderWeeklyMenu(JSON.parse(weekly.data || '{}'));
            } else if (candidates.length > 0) {
                html += '<div class="alert-info">Меню ещё не выбрано. Проголосуйте за один из <b>' + candidates.length + '</b> вариантов.</div>';
                html += '<button class="btn-main" onclick="router.go(\'vote\')">🗳️ Перейти к голосованию</button>';
            } else {
                html += '<div class="alert-warning">⚠️ Меню ещё не сгенерировано.</div>';
                if (state.user && state.user.role === 'admin') {
                    html += '<button class="btn-main" onclick="router.go(\'admin\')">⚙️ Сгенерировать меню</button>';
                } else {
                    html += '<p style="color:#888;margin-top:10px">Попросите Ирину сгенерировать меню в админ-панели.</p>';
                }
            }
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = '<div class="alert-error">❌ Ошибка загрузки меню</div>';
        }
    }
};

function renderWeeklyMenu(data) {
    if (!data || !data.days) return '<div class="alert-warning">Нет данных</div>';
    const dayNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
    let html = '<div class="weekly-menu">';
    data.days.forEach((day, i) => {
        html += '<div class="day-card"><h4>' + dayNames[i] + '</h4>';

        if (day.breakfast) {
            html += '<div class="meal"><b>🌅 Завтрак:</b><br>';
            html += renderRecipe(day.breakfast.main);
            html += '<small>☕ ' + (day.breakfast.drink || '') + '</small></div>';
        }
        if (day.lunch) {
            html += '<div class="meal"><b>☀️ Обед:</b><br>';
            html += '<small>🥗 ' + recipeName(day.lunch.salad) + '</small><br>';
            html += '<small>🍲 ' + recipeName(day.lunch.soup) + '</small><br>';
            html += '<small>🍮 ' + recipeName(day.lunch.dessert) + '</small><br>';
            html += '<small>🧃 ' + (day.lunch.drink || '') + '</small></div>';
        }
        if (day.dinner) {
            html += '<div class="meal"><b>🌙 Ужин:</b><br>';
            html += '<small>🥗 ' + recipeName(day.dinner.salad) + '</small><br>';
            html += '<small>🍚 ' + recipeName(day.dinner.side) + '</small><br>';
            html += renderRecipe(day.dinner.main);
            html += '<small>🍮 ' + recipeName(day.dinner.dessert) + '</small><br>';
            html += '<small>🥤 ' + (day.dinner.drink || '') + '</small></div>';
        }
        html += '</div>';
    });
    html += '</div>';
    return html;
}

function recipeName(r) {
    if (!r) return '';
    if (typeof r === 'string') return r;
    return r.name_ru || r.name_en || '';
}

// ─── Pantry ──────────────────────────────────────────────────────
const pantry = {
    async load() {
        const list = document.getElementById('pantry-list');
        const controls = document.getElementById('admin-pantry-controls');
        if (controls) controls.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));
        if (!list) return;

        try {
            const items = await api.get('/api/pantry');
            if (!items.length) {
                list.innerHTML = '<div class="alert-info">Кладовая пуста</div>';
                return;
            }
            let html = '<div class="pantry-items">';
            items.forEach(i => {
                html += '<div class="pantry-item"><span>' + i.product + '</span> <b>' + i.quantity + '</b> ' + i.unit;
                if (state.user && state.user.role === 'admin') {
                    html += ' <button class="btn-delete" onclick="pantry.remove(' + i.id + ')">❌</button>';
                }
                html += '</div>';
            });
            html += '</div>';
            list.innerHTML = html;
        } catch (e) {
            list.innerHTML = '<div class="alert-error">Ошибка загрузки кладовой</div>';
        }
    },
    async add() {
        const p = document.getElementById('p-name').value.trim();
        const q = document.getElementById('p-qty').value;
        const u = document.getElementById('p-unit').value.trim();
        if (!p) return showToast('Введите название продукта');
        const res = await api.post('/api/pantry', { product: p, quantity: q || 0, unit: u || 'шт' });
        if (res.success) {
            document.getElementById('p-name').value = '';
            document.getElementById('p-qty').value = '';
            document.getElementById('p-unit').value = '';
            this.load();
        } else {
            showToast(res.error || 'Ошибка');
        }
    },
    async remove(id) {
        if (!confirm('Удалить продукт из кладовой?')) return;
        await api.del('/api/pantry/' + id);
        this.load();
    }
};

// ─── Vote ────────────────────────────────────────────────────────
const vote = {
    async load() {
        const container = document.getElementById('vote-options');
        if (!container) return;

        try {
            const items = await api.get('/api/menu/candidates');
            if (!items.length) {
                container.innerHTML = '<div class="alert-warning">⚠️ Варианты меню ещё не сгенерированы. Обратитесь к Ирине (Администратору).</div>';
                return;
            }
            const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
            container.innerHTML = items.map(opt => {
                const d = opt.data;
                const preview = d.days ? d.days.slice(0, 3).map((day, i) => {
                    const main = day.dinner && day.dinner.main ? recipeName(day.dinner.main) : '—';
                    return '<div><b>' + dayNames[i] + ':</b> ' + main + '</div>';
                }).join('') : '';
                return '<div class="vote-card"><h3>🍽 Вариант №' + (opt.option_index + 1) + '</h3>' +
                    '<div class="vote-preview">' + preview + '</div>' +
                    '<button class="btn-main" onclick="vote.submit(' + opt.option_index + ')">✅ Выбрать этот вариант</button></div>';
            }).join('');
        } catch (e) {
            container.innerHTML = '<div class="alert-error">Ошибка загрузки вариантов</div>';
        }
    },
    async submit(idx) {
        if (!confirm('Проголосовать за Вариант №' + (idx + 1) + '?')) return;
        const res = await api.post('/api/menu/vote', { option_index: idx });
        if (res.success) {
            showToast('✅ Ваш голос принят!', 'success');
            setTimeout(() => router.go('menu'), 1000);
        } else {
            showToast(res.error || 'Ошибка голосования');
        }
    }
};

// ─── Shopping ────────────────────────────────────────────────────
const shopping = {
    async load() {
        const list = document.getElementById('shopping-list');
        if (!list) return;

        try {
            const items = await api.get('/api/shopping');
            if (!items.length) {
                list.innerHTML = '<div class="alert-info">Список покупок пуст. Сначала нужно выбрать меню через голосование.</div>';
                return;
            }
            const need = items.filter(i => !i.in_pantry);
            const have = items.filter(i => i.in_pantry);
            let html = '';
            if (need.length) {
                html += '<div class="shopping-section"><h3>🛒 Нужно купить (' + need.length + ')</h3>';
                html += need.map(i => '<div class="shopping-item"><span>🛒</span> <b>' + i.product + '</b> ' + (i.quantity || '') + ' ' + (i.unit || '') + '</div>').join('');
                html += '</div>';
            }
            if (have.length) {
                html += '<div class="shopping-section"><h3>✅ Уже есть в кладовой (' + have.length + ')</h3>';
                html += have.map(i => '<div class="shopping-item"><span>✅</span> <b>' + i.product + '</b> ' + (i.quantity || '') + ' ' + (i.unit || '') + '</div>').join('');
                html += '</div>';
            }
            list.innerHTML = html;
        } catch (e) {
            list.innerHTML = '<div class="alert-error">Ошибка загрузки списка</div>';
        }
    }
};

// ─── Admin ───────────────────────────────────────────────────────
const admin = {
    async load() {
        try {
            const recipes = await api.get('/api/recipes/count');
            const el = document.getElementById('stat-recipes');
            if (el) el.textContent = recipes.count || '0';
        } catch (e) {}

        try {
            const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=54.68&longitude=25.28&current_weather=true');
            const wd = await w.json();
            const wel = document.getElementById('stat-weather');
            if (wel) wel.textContent = wd.current_weather.temperature + '°C';
        } catch (e) {
            const wel = document.getElementById('stat-weather');
            if (wel) wel.textContent = 'н/д';
        }
    },
    async generateMenu() {
        const btn = document.querySelector('.btn-large');
        const status = document.getElementById('admin-status');
        if (btn) btn.disabled = true;
        if (status) status.innerHTML = '<div class="alert-info">⏳ Генерация меню с учётом погоды и кладовой...</div>';

        try {
            const res = await api.post('/api/menu/generate', {});
            if (res.success) {
                if (status) status.innerHTML = '<div class="alert-success">✅ Готово! 4 варианта сгенерированы. Попросите семью проголосовать.</div>';
                setTimeout(() => router.go('vote'), 2000);
            } else {
                if (status) status.innerHTML = '<div class="alert-error">❌ Ошибка: ' + (res.error || 'Неизвестная') + '</div>';
            }
        } catch (e) {
            if (status) status.innerHTML = '<div class="alert-error">❌ Ошибка соединения</div>';
        }
        if (btn) btn.disabled = false;
    }
};

// ─── Init ────────────────────────────────────────────────────────
window.onload = async () => {
    try {
        const user = await api.get('/api/me');
        if (user && user.username) {
            state.user = user;
            router.go('menu');
        } else {
            router.go('login');
        }
    } catch (e) {
        router.go('login');
    }
};
