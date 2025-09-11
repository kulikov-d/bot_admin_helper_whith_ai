require('dotenv').config();
const { Bot } = require("grammy");
const { OpenAI } = require("openai");
const sqlite3 = require('sqlite3').verbose();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const bot = new Bot(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OWNER_ID = process.env.OWNER_ID;

// Ограничиваем количество обрабатываемых новостей за один раз
const MAX_STORIES_PER_RUN = 3;

// Инициализируем OpenAI клиент для OpenRouter
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://your-telegram-bot.com",
    "X-Title": "Hacker News Digest Bot"
  }
});

// Функция проверки прав доступа
function isOwner(ctx) {
  return ctx.from && ctx.from.id === parseInt(OWNER_ID);
}

// Middleware для проверки прав доступа
bot.use(async (ctx, next) => {
  if (ctx.message && !isOwner(ctx)) {
    console.log(`Попытка доступа от неавторизованного пользователя: ${ctx.from.id}`);
    return ctx.reply("❌ У вас нет доступа к этому боту.");
  }
  await next();
});

// Подключаемся к базе данных SQLite
let db = new sqlite3.Database('./hn_bot.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err);
  } else {
    console.log('Подключен к SQLite DB.');
    // Создаем таблицу для отслеживания уже отправленных новостей
    db.run(`CREATE TABLE IF NOT EXISTS posted_stories (
      id INTEGER PRIMARY KEY,
      story_id INTEGER NOT NULL UNIQUE,
      title TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Ошибка при создании таблицы:', err);
      } else {
        console.log('Таблица posted_stories создана/проверена');
      }
    });
  }
});

// Команда для очистки базы данных
bot.command("clear_db", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  try {
    db.run("DELETE FROM posted_stories", function(err) {
      if (err) {
        console.error('Ошибка при очистке БД:', err);
        ctx.reply("❌ Ошибка при очистке базы данных");
      } else {
        console.log('База данных очищена. Удалено записей:', this.changes);
        ctx.reply("✅ База данных успешно очищена! Все новости будут обработаны заново.");
      }
    });
  } catch (error) {
    console.error('Ошибка при выполнении команды clear_db:', error);
    ctx.reply("❌ Произошла ошибка при очистке базы данных");
  }
});

// Команда для показа всех команд
bot.command("help", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  const helpText = `
🤖 Доступные команды:

/start - Запустить бота и показать информацию
/help - Показать это сообщение со списком команд
/force_check - Принудительно проверить новые новости
/clear_db - Очистить базу данных (удалить историю обработанных новостей)
/stop - Остановить автоматическую проверку новостей
/start_auto - Запустить автоматическую проверку новостей

Бот автоматически проверяет лучшие новости с Hacker News каждые 30 минут и публикует их в канал.
  `;
  
  await ctx.reply(helpText);
});

// Функция для проверки, была ли новость уже отправлена
function isStoryPosted(storyId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT story_id FROM posted_stories WHERE story_id = ?", [storyId], (err, row) => {
      if (err) reject(err);
      resolve(!!row);
    });
  });
}

// Функция для отметки новости как отправленной
function markStoryAsPosted(storyId, title) {
  return new Promise((resolve, reject) => {
    db.run("INSERT INTO posted_stories (story_id, title) VALUES (?, ?)", [storyId, title], function(err) {
      if (err) {
        console.error('Ошибка при сохранении новости в БД:', err);
        reject(err);
      } else {
        console.log(`Новость #${storyId} сохранена в БД`);
        resolve();
      }
    });
  });
}

// Функция для запроса к OpenRouter API
async function getAISummary(articleUrl) {
  const prompt = `
Проанализируй статью по ссылке: ${articleUrl}

Создай информативную выжимку на русском языке (примерно 350 слов) для IT-канала в Telegram.

Ключевые требования:
1. Стиль: неформальный, экспертный, прямой — как будто это пост администратора канала
2. Начинай сразу с сути, без вступлений и приветствий
3. Выдели главную идею и 2-3 самых важных момента из статьи
4. Добавь практические выводы или инсайты
5. Избегай маркдауна (*, _ и другого форматирования)
6. Не упоминай, что это анализ или выжимка — подавай как оригинальный контент


Формат:
- Яркий заголовок
- Основной текст с ключевыми тезисами
- Практический вывод
- Вопрос для обсуждения

Пиши от первого лица, как владелец канала.
`;

  try {
    const completion = await openai.chat.completions.create({
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
    console.error('OpenRouter API Error:', error);
    return null;
  }
}

// Функция для проверки лучших новостей
async function checkBestStories() {
  try {
    console.log('Проверяем лучшие новости...');
    
    // Получаем список лучших новостей
    const bestStoriesResponse = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json');
    const bestStoriesIds = await bestStoriesResponse.json();
    
    // Обрабатываем только топ-30 новостей
    const topStoriesIds = bestStoriesIds.slice(0, 30);
    let newStoriesCount = 0;
    
    for (const storyId of topStoriesIds) {
      // Ограничиваем количество обрабатываемых новостей за один запуск
      if (newStoriesCount >= MAX_STORIES_PER_RUN) {
        console.log(`Достигнут лимит в ${MAX_STORIES_PER_RUN} новости за один запуск`);
        break;
      }
      
      try {
        // Проверяем, не обрабатывали ли мы уже эту новость
        const alreadyPosted = await isStoryPosted(storyId);
        if (alreadyPosted) {
          console.log(`Новость #${storyId} уже была обработана, пропускаем`);
          continue;
        }
        
        // Получаем данные о новости
        const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`);
        const story = await storyResponse.json();
        
        // Проверяем, что это новость с URL
        if (story && story.type === 'story' && story.url && story.title) {
          console.log(`Обрабатываем новую лучшую новость #${storyId}: ${story.title}`);
          
          // Получаем AI-выжимку
          const aiSummary = await getAISummary(story.url);
          
          if (aiSummary) {
            // Извлекаем домен из URL
            const domain = new URL(story.url).hostname.replace('www.', '');
            
            // Форматируем сообщение с заголовком и кнопкой подписки
            const message = `📰 *${story.title}*\n\n${aiSummary}\n\n——\n\n🔗 [Источник](${story.url})\n💬 [Обсуждение](https://news.ycombinator.com/item?id=${storyId})\n[Подписаться на Hacker News](https://t.me/hackernewru)\n\n📝 Новости взяты с Hacker News и адаптированы для русскоязычной аудитории с сохранением оригинального смысла.`;
            
            // Отправляем сообщение с форматированием
            await bot.api.sendMessage(CHANNEL_ID, message, {
              parse_mode: "Markdown",
              disable_web_page_preview: false
            });
            
            console.log(`Новость #${storyId} отправлена в канал!`);
            
            // Отмечаем новость как обработанную
            await markStoryAsPosted(storyId, story.title);
            newStoriesCount++;
            
            // Пауза между сообщениями
            await new Promise(resolve => setTimeout(resolve, 10000));
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

// Запускаем проверку лучших новостей каждые 30 минут
const checkInterval = 30 * 60 * 1000; // 30 минут
let intervalId = setInterval(checkBestStories, checkInterval);

// Также запускаем сразу при старте
checkBestStories();

// Базовые команды бота
bot.command("start", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  await ctx.reply("🤖 Бот запущен и автоматически проверяет лучшие новости на Hacker News каждые 30 минут. Используйте /help для просмотра всех команд.");
});

bot.command("force_check", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  await ctx.reply("Принудительная проверка лучших новостей...");
  await checkBestStories();
  await ctx.reply("Проверка завершена!");
});

bot.command("stop", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  clearInterval(intervalId);
  await ctx.reply("🛑 Автоматическая проверка новостей остановлена.");
});

bot.command("start_auto", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  intervalId = setInterval(checkBestStories, checkInterval);
  await ctx.reply("✅ Автоматическая проверка новостей запущена.");
});

bot.start().then(() => {
  console.log('🤖 Бот запущен!');
});

bot.catch((err) => {
  console.error('Ошибка бота:', err);
});