const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { getOpenAIClient } = require('./utils');

// Функция для запроса к OpenRouter API с поддержкой нескольких ключей
async function getAISummary(articleUrl, apiKeys, currentKeyIndex) {
  const prompt = `
Проанализируй статью по ссылке: ${articleUrl}

Сначала оцени, будет ли эта новость интересна русскоязычной IT-аудитории в России и странах СНГ.
Если новость не представляет интереса для этой аудитории (например, касается только локальных событий в США, не имеет отношения к IT, или тема уже устарела для нашей аудитории), верни только "0".

Если новость интересна, создай информативную выжимку на русском языке (примерно 350 слов) для IT-канала в Telegram.

Ключевые требования к выжимке:
1. Стиль: неформальный, экспертный, прямой — как будто это пост администратора канала
2. Начинай сразу с сути, без вступлений и приветствий
3. Выдели главную идею и 2-3 самых важных момента из статьи
4. Добавь практические выводы или инсайты
5. Избегай маркдауна (*, _ и другого форматирования)
6. Не упоминай, что это анализ или выжимка — подавай как оригинальный контент

Формат выжимки:
- Яркий заголовок
- Основной текст с ключевыми тезисами
- Практический вывод

Пиши от первого лица, как владелец канала.
  `;

  let retries = 0;
  const maxRetries = apiKeys.length;
  
  while (retries < maxRetries) {
    try {
      const openaiClient = getOpenAIClient(apiKeys, currentKeyIndex);
      const completion = await openaiClient.chat.completions.create({
        model: "deepseek/deepseek-chat-v3.1:free",
        messages: [{ 
          role: "user", 
          content: prompt 
        }],
        temperature: 0.7,
        max_tokens: 1000
      });
      
      return completion.choices[0].message.content;
    } catch (error) {
      console.error(`Ошибка при использовании ключа #${currentKeyIndex + 1}:`, error);
      
      if (error.status === 402 || error.status === 429) {
        retries++;
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        
        if (retries < maxRetries) {
          console.log(`Переключаемся на следующий ключ (#${currentKeyIndex + 1}). Попытка ${retries + 1} из ${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          console.log('Все ключи исчерпаны. Не удалось получить ответ от API.');
          return null;
        }
      } else {
        console.error('Неизвестная ошибка OpenRouter API:', error);
        return null;
      }
    }
  }
  
  return null;
}

// Функция для проверки лучших новостей
async function checkBestStories(db, bot, CHANNEL_ID, apiKeys, MAX_ITEMS_PER_RUN) {
  let currentKeyIndex = 0;
  
  try {
    console.log('Проверяем лучшие новости...');
    
    const bestStoriesResponse = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json');
    if (!bestStoriesResponse.ok) {
      throw new Error(`Hacker News API error: ${bestStoriesResponse.status}`);
    }
    
    const bestStoriesIds = await bestStoriesResponse.json();
    
    if (!Array.isArray(bestStoriesIds)) {
      throw new Error('Invalid response from Hacker News API: expected array');
    }
    
    const topStoriesIds = bestStoriesIds.slice(0, 30);
    let newStoriesCount = 0;
    
    for (const storyId of topStoriesIds) {
      if (newStoriesCount >= MAX_ITEMS_PER_RUN) {
        console.log(`Достигнут лимит в ${MAX_ITEMS_PER_RUN} новости за один запуск`);
        break;
      }
      
      try {
        const alreadyPosted = await db.isStoryPosted(storyId);
        if (alreadyPosted) {
          console.log(`Новость #${storyId} уже была обработана, пропускаем`);
          continue;
        }
        
        const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`);
        if (!storyResponse.ok) {
          throw new Error(`Hacker News item API error: ${storyResponse.status}`);
        }
        
        const story = await storyResponse.json();
        
        if (story && story.type === 'story' && story.url && story.title) {
          console.log(`Обрабатываем новую лучшую новость #${storyId}: ${story.title}`);
          
          const aiSummary = await getAISummary(story.url, apiKeys, currentKeyIndex);
          
          if (aiSummary) {
            // Проверяем, не является ли ответ "0" (новость не интересна)
            if (aiSummary.trim() === "0") {
              console.log(`Новость #${storyId} не интересна для русскоязычной аудитории. Помечаем как обработанную, но не публикуем.`);
              await db.markStoryAsPosted(storyId, story.title);
              continue;
            }
            
            const domain = new URL(story.url).hostname.replace('www.', '');
            // Создаем сообщение с ссылками на "Источник" и "Обсуждение"
            const message = `📰 *${story.title}*\n\n${aiSummary}\n\n——\n\n[Источник](${story.url})\n[Обсуждение](https://news.ycombinator.com/item?id=${storyId})\n\n📝 Новости взяты с Hacker News и адаптированы для русскоязычной аудитории с сохранением оригинального смысла.\n\n[Подписаться на Hacker News](https://t.me/hackernewru)`;
            
            await bot.api.sendMessage(CHANNEL_ID, message, {
              parse_mode: "Markdown",
              disable_web_page_preview: false
            });
            
            console.log(`Новость #${storyId} отправлена в канал!`);
            await db.markStoryAsPosted(storyId, story.title);
            await db.updateStatistics(CHANNEL_ID);
            newStoriesCount++;
            
            // Увеличиваем паузу до 30 секунд между запросами
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
        }
      } catch (error) {
        console.error(`Ошибка при обработке новости #${storyId}:`, error);
      }
    }
    
    if (newStoriesCount > 0) {
      console.log(`Обработано новых новостей: ${newStoriesCount}`);
    } else {
      console.log('Новых лучших новостей не найдено');
    }
  } catch (error) {
    console.error('Ошибка при проверке лучших новостей:', error);
  }
}

module.exports = {
  checkBestStories
};