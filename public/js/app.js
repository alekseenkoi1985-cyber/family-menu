const state = { user: null };

const api = {
    async get(url) {
        const r = await fetch(url);
        return r.json();
    },
    async post(url, data) {
        const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        return r.json();
    }
};

const router = {
    go(page) {
        if (!state.user && page !== 'login') return this.go('login');
        const content = document.getElementById('content');
        const tpl = document.getElementById('tpl-' + page);
        if (!tpl) return;
        content.innerHTML = '';
        content.appendChild(tpl.content.cloneNode(true));
        const nav = document.getElementById('main-nav');
        nav.classList.toggle('hidden', page === 'login');
        const navAdmin = document.getElementById('nav-admin');
        if (navAdmin) navAdmin.classList.toggle('hidden', state.user && state.user.role !== 'admin');
        if (page === 'pantry') pantry.load();
        if (page === 'vote') vote.load();
        if (page === 'shopping') shopping.load();
        if (page === 'admin') admin.load();
        if (page === 'menu') menu.load();
    }
};

const auth = {
    select(name) {
        const pinArea = document.getElementById('pin-area');
        if (pinArea) pinArea.classList.remove('hidden');
        state.selectedUser = name;
    },
    async login(name) {
        const pinInput = document.getElementById('pin-input');
        const pin = pinInput ? pinInput.value : '';
        const res = await api.post('/api/login', { username: name, pin });
        if (res.success) {
            state.user = res.user;
            router.go('menu');
        } else {
            alert(res.error || 'Ошибка входа');
        }
    }
};

const menu = {
    async load() {
        const content = document.getElementById('content');
        const candidates = await api.get('/api/menu/candidates');
        const weekly = await api.get('/api/menu/weekly');
        let html = '<div class="page-menu"><h2>📅 Меню на неделю</h2>';
        if (weekly && weekly.id) {
            html += '<div class="alert-success">✅ Активное меню выбрано семьёй</div>';
            html += renderWeeklyMenu(JSON.parse(weekly.data || '{}'));
        } else if (candidates.length > 0) {
            html += '<div class="alert-info">Проголосуйте за один из <b>' + candidates.length + '</b> вариантов меню.</div>';
            html += '<button class="btn-main" onclick="router.go(\'vote\')">🗳️ Перейти к голосованию</button>';
        } else {
            html += '<div class="alert-warning">Меню ещё не сгенерировано.</div>';
            if (state.user && state.user.role === 'admin') {
                html += '<button class="btn-main" onclick="router.go(\'admin\')">⚙️ Сгенерировать меню</button>';
            }
        }
        html += '</div>';
        content.innerHTML = html;
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
            html += '<span>' + (day.breakfast.main ? (day.breakfast.main.name_ru || day.breakfast.main.name_en || day.breakfast.main) : '') + '</span><br>';
            html += '<small>☕ ' + (day.breakfast.drink || '') + '</small></div>';
        }
        if (day.lunch) {
            html += '<div class="meal"><b>☀️ Обед:</b><br>';
            html += '<small>🥗 ' + (day.lunch.salad ? (day.lunch.salad.name_ru || day.lunch.salad.name_en || '') : '') + '</small><br>';
            html += '<small>🍲 ' + (day.lunch.soup ? (day.lunch.soup.name_ru || day.lunch.soup.name_en || '') : '') + '</small><br>';
            html += '<small>🍮 ' + (day.lunch.dessert ? (day.lunch.dessert.name_ru || day.lunch.dessert.name_en || '') : '') + '</small><br>';
            html += '<small>🧃 ' + (day.lunch.drink || '') + '</small></div>';
        }
        if (day.dinner) {
            html += '<div class="meal"><b>🌙 Ужин:</b><br>';
            html += '<small>🥗 ' + (day.dinner.salad ? (day.dinner.salad.name_ru || day.dinner.salad.name_en || '') : '') + '</small><br>';
            html += '<small>🍚 ' + (day.dinner.side ? (day.dinner.side.name_ru || day.dinner.side.name_en || '') : '') + '</small><br>';
            html += '<small>🍗 ' + (day.dinner.main ? (day.dinner.main.name_ru || day.dinner.main.name_en || '') : '') + '</small><br>';
            html += '<small>🍮 ' + (day.dinner.dessert ? (day.dinner.dessert.name_ru || day.dinner.dessert.name_en || '') : '') + '</small><br>';
            html += '<small>🥤 ' + (day.dinner.drink || '') + '</small></div>';
        }
        html += '</div>';
    });
    html += '</div>';
    return html;
}

const pantry = {
    async load() {
        const items = await api.get('/api/pantry');
        const list = document.getElementById('pantry-list');
        const controls = document.getElementById('admin-pantry-controls');
        if (controls) controls.classList.toggle('hidden', state.user && state.user.role !== 'admin');
        if (!list) return;
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
    },
    async add() {
        const p = document.getElementById('p-name').value;
        const q = document.getElementById('p-qty').value;
        const u = document.getElementById('p-unit').value;
        if (!p) return alert('Введите название продукта');
        await api.post('/api/pantry', { product: p, quantity: q, unit: u });
        document.getElementById('p-name').value = '';
        document.getElementById('p-qty').value = '';
        document.getElementById('p-unit').value = '';
        this.load();
    },
    async remove(id) {
        if (!confirm('Удалить продукт из кладовой?')) return;
        await fetch('/api/pantry/' + id, { method: 'DELETE' });
        this.load();
    }
};

const vote = {
    async load() {
        const items = await api.get('/api/menu/candidates');
        const container = document.getElementById('vote-options');
        if (!container) return;
        if (!items.length) {
            container.innerHTML = '<div class="alert-warning">Варианты меню ещё не сгенерированы. Обратитесь к администратору.</div>';
            return;
        }
        const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
        container.innerHTML = items.map(opt => {
            const d = opt.data;
            const preview = d.days ? d.days.slice(0,3).map((day, i) => {
                const main = day.dinner && day.dinner.main ? (day.dinner.main.name_ru || day.dinner.main.name_en || 'блюдо') : '';
                return '<div><b>' + dayNames[i] + ':</b> ' + main + '</div>';
            }).join('') : '';
            return '<div class="vote-card"><h3>🍽 Вариант №' + (opt.option_index + 1) + '</h3><div class="vote-preview">' + preview + '</div>' +
                '<button class="btn-main" onclick="vote.submit(' + opt.option_index + ')">✅ Выбрать этот вариант</button></div>';
        }).join('');
    },
    async submit(idx) {
        if (!confirm('Проголосовать за Вариант №' + (idx + 1) + '?')) return;
        const res = await api.post('/api/menu/vote', { option_index: idx });
        if (res.success) {
            alert('✅ Ваш голос принят!');
            router.go('menu');
        }
    }
};

const shopping = {
    async load() {
        const items = await api.get('/api/shopping');
        const list = document.getElementById('shopping-list');
        if (!list) return;
        if (!items.length) {
            list.innerHTML = '<div class="alert-info">Список покупок пуст</div>';
            return;
        }
        const need = items.filter(i => !i.in_pantry);
        const have = items.filter(i => i.in_pantry);
        let html = '';
        if (need.length) {
            html += '<div class="shopping-section"><h3>🛒 Нужно купить (' + need.length + ')</h3>';
            html += need.map(i => '<div class="shopping-item"><span>🛒</span> <b>' + i.product + '</b> ' + (i.quantity||'') + ' ' + (i.unit||'') + '</div>').join('');
            html += '</div>';
        }
        if (have.length) {
            html += '<div class="shopping-section"><h3>✅ Уже есть в кладовой (' + have.length + ')</h3>';
            html += have.map(i => '<div class="shopping-item"><span>✅</span> <b>' + i.product + '</b> ' + (i.quantity||'') + ' ' + (i.unit||'') + '</div>').join('');
            html += '</div>';
        }
        list.innerHTML = html;
    }
};

const admin = {
    async load() {
        const recipes = await api.get('/api/recipes/count');
        const el = document.getElementById('stat-recipes');
        if (el) el.textContent = recipes.count || '...';
        try {
            const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=59.93&longitude=30.31&current_weather=true');
            const wd = await w.json();
            const wel = document.getElementById('stat-weather');
            if (wel) wel.textContent = wd.current_weather.temperature + '°C';
        } catch(e) {}
    },
    async generateMenu() {
        const btn = document.querySelector('.btn-main');
        const status = document.getElementById('admin-status');
        if (btn) btn.disabled = true;
        if (status) status.innerHTML = '<div class="alert-info">⏳ Генерация меню с учётом погоды и кладовой...</div>';
        const res = await api.post('/api/menu/generate', {});
        if (res.success) {
            if (status) status.innerHTML = '<div class="alert-success">✅ Готово! 4 варианта меню сгенерированы. Попросите семью проголосовать.</div>';
            setTimeout(() => router.go('vote'), 2000);
        } else {
            if (status) status.innerHTML = '<div class="alert-error">❌ Ошибка: ' + (res.error || 'Неизвестная ошибка') + '</div>';
        }
        if (btn) btn.disabled = false;
    }
};

window.onload = async () => {
    const user = await api.get('/api/me');
    if (user && user.username) {
        state.user = user;
        router.go('menu');
    } else {
        router.go('login');
    }
};
