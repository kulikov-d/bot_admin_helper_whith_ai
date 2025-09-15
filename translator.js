const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Функция для перевода текста через Google Translate API
async function translateWithGoogle(text) {
  if (!text || typeof text !== 'string') return text || '';
  
  try {
    // Используем Google Translate API через translate.googleapis.com
    const encodedText = encodeURIComponent(text);
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodedText}`
    );
    
    if (!response.ok) {
      throw new Error(`Google Translate API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Извлекаем переведенный текст из ответа
    if (data && data[0] && Array.isArray(data[0])) {
      let translated = '';
      for (const item of data[0]) {
        if (item && item[0]) {
          translated += item[0];
        }
      }
      return translated;
    }
    
    return text; // Возвращаем оригинальный текст, если не удалось перевести
  } catch (error) {
    console.error('Ошибка при переводе через Google Translate:', error);
    return text; // Возвращаем оригинальный текст в случае ошибки
  }
}

// Функция для очистки HTML из текста
function cleanHtml(text) {
  if (typeof text !== 'string') return '';
  
  // Удаляем HTML-теги
  let cleanText = text.replace(/<[^>]*>/g, '');
  
  // Заменяем HTML-сущности
  cleanText = cleanText.replace(/&amp;/g, '&');
  cleanText = cleanText.replace(/</g, '<');
  cleanText = cleanText.replace(/>/g, '>');
  cleanText = cleanText.replace(/&quot;/g, '"');
  cleanText = cleanText.replace(/&#039;/g, "'");
  cleanText = cleanText.replace(/&nbsp;/g, ' ');
  
  return cleanText.trim();
}

module.exports = {
  translateWithGoogle,
  cleanHtml
};