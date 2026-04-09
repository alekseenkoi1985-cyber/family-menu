// Модуль для отображения рецептов в меню

// Функция для отображения рецепта в виде карточки
function renderRecipe(recipe, label) {
  if (!recipe || typeof recipe === 'string') {
    return '<span>' + (recipe || label || '') + '</span>';
  }
  const name = recipe.name_ru || recipe.name_en || 'Блюдо';
  const img = recipe.image_url || 'https://via.placeholder.com/150?text=No+Image';
  const category = recipe.category || '';
  const id = recipe.id || 0;
  
  return `<div class="recipe-card" onclick="recipeDetail.show(${id})">
    <img src="${img}" alt="${name}" class="recipe-img" onerror="this.src='https://via.placeholder.com/150?text=No+Image'">
    <div class="recipe-info">
      <div class="recipe-name">${name}</div>
      <div class="recipe-category">${category}</div>
    </div>
  </div>`;
}

// Объект для работы с детальным просмотром рецепта
const recipeDetail = {
  async show(id) {
    if (!id) return;
    try {
      const recipe = await api.get('/api/recipes/' + id);
      const content = document.getElementById('content');
      
      let html = '<div class="recipe-detail">';
      html += '<button class="btn-back" onclick="router.go(\'menu\')">◀ Назад к меню</button>';
      html += '<h2>' + (recipe.name_ru || recipe.name_en) + '</h2>';
      
      if (recipe.image_url) {
        html += '<img src="' + recipe.image_url + '" alt="' + (recipe.name_ru || recipe.name_en) + '" class="recipe-detail-img">';
      }
      
      html += '<div class="recipe-meta">';
      if (recipe.category) html += '<span class="meta-item">📂 ' + recipe.category + '</span>';
      if (recipe.cooking_time) html += '<span class="meta-item">⏱️ ' + recipe.cooking_time + ' мин</span>';
      if (recipe.calories) html += '<span class="meta-item">🔥 ' + recipe.calories + ' ккал</span>';
      html += '</div>';
      
      if (recipe.ingredients && recipe.ingredients.length > 0) {
        html += '<h3>🛒 Ингредиенты:</h3><ul class="ingredients-list">';
        recipe.ingredients.forEach(ing => {
          html += '<li>' + ing.name + (ing.amount ? ' - ' + ing.amount : '') + '</li>';
        });
        html += '</ul>';
      }
      
      if (recipe.instructions) {
        html += '<h3>👨‍🍳 Инструкция приготовления:</h3>';
        html += '<div class="instructions">' + recipe.instructions.replace(/\n/g, '<br>') + '</div>';
      }
      
      html += '</div>';
      content.innerHTML = html;
    } catch (e) {
      alert('Ошибка загрузки рецепта');
      console.error(e);
    }
  }
};
