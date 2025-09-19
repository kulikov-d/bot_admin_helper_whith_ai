require('dotenv').config();
const { Bot } = require("grammy");
const os = require('os');
const { exec } = require('child_process');

// Импортируем наши модули
const config = require('./config');
const Database = require('./database');
const { checkBestStories } = require('./hnChecker');
const { checkNewJobs } = require('./jobChecker');
const { getCpuTemperature } = require('./utils');

const bot = new Bot(config.BOT_TOKEN);
const db = new Database();

let currentKeyIndex = 0;
let newsCheckerInterval, jobCheckerInterval;
let isNewsChecking = false;
let isJobsChecking = false;

// Функция проверки прав доступа
function isOwner(ctx) {
  return ctx.from && ctx.from.id === parseInt(config.OWNER_ID);
}

// Middleware для проверки прав доступа
bot.use(async (ctx, next) => {
  if (ctx.message && !isOwner(ctx)) {
    console.log(`Попытка доступа от неавторизованного пользователя: ${ctx.from.id}`);
    return ctx.reply("❌ У вас нет доступа к этому боту.");
  }
  await next();
});

// Команда для очистки базы данных
bot.command("clear_db", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  try {
    db.db.run("DELETE FROM posted_stories", function(err) {
      if (err) {
        console.error('Ошибка при очистке БД новостей:', err);
        ctx.reply("❌ Ошибка при очистке базы данных новостей");
      } else {
        console.log('База данных новостей очищена. Удалено записей:', this.changes);
        ctx.reply(`✅ База данных новостей успешно очищена! Удалено записей: ${this.changes}`);
      }
    });
    
    db.db.run("DELETE FROM posted_jobs", function(err) {
      if (err) {
        console.error('Ошибка при очистке БД вакансий:', err);
      } else {
        console.log('База данных вакансий очищена. Удалено записей:', this.changes);
        ctx.reply(`✅ База данных вакансий успешно очищена! Удалено записей: ${this.changes}`);
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
/force_check - Принудительно проверить новые новости (макс. 3)
/force_jobs - Принудительно проверить новые вакансии (макс. 3)
/clear_db - Очистить базу данных (удалить историю обработанных новостей и вакансий)
/stop - Остановить автоматическую проверку новостей и вакансий
/start_auto - Запустить автоматическую проверку новостей и вакансий
/stats - Показать статистику публикаций за сегодня
/server - Показать информацию о состоянии сервера
  `;
  
  await ctx.reply(helpText);
});

// Запускаем проверку лучших новостей каждые 30 минут
function startNewsChecker() {
  if (newsCheckerInterval) {
    clearInterval(newsCheckerInterval);
  }
  
  newsCheckerInterval = setInterval(async () => {
    if (isNewsChecking) {
      console.log('Проверка новостей уже выполняется, пропускаем...');
      return;
    }
    
    isNewsChecking = true;
    try {
      await checkBestStories(db, bot, config.CHANNEL_ID, config.OPENROUTER_API_KEYS, config.MAX_ITEMS_PER_RUN);
    } catch (error) {
      console.error('Ошибка при проверке новостей:', error);
    } finally {
      isNewsChecking = false;
    }
  }, config.CHECK_INTERVAL);
}

// Запускаем проверку новых вакансий каждые 30 минут
function startJobChecker() {
  if (jobCheckerInterval) {
    clearInterval(jobCheckerInterval);
  }
  
  jobCheckerInterval = setInterval(async () => {
    if (isJobsChecking) {
      console.log('Проверка вакансий уже выполняется, пропускаем...');
      return;
    }
    
    isJobsChecking = true;
    try {
      await checkNewJobs(db, bot, config.JOB_CHANNEL_ID, config.MAX_ITEMS_PER_RUN);
    } catch (error) {
      console.error('Ошибка при проверке вакансий:', error);
    } finally {
      isJobsChecking = false;
    }
  }, config.CHECK_INTERVAL);
}

console.log('🤖 Бот запущен! Проверка новостей и вакансий каждые 30 минут.');

// Базовые команды бота
bot.command("start", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply("🤖 Бот запущен и автоматически проверяет лучшие новости на Hacker News и вакансии каждые 30 минут. Используйте /help для просмотра всех команд.");
});

bot.command("force_check", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  if (isNewsChecking) {
    return ctx.reply("⏳ Проверка новостей уже выполняется, подождите окончания.");
  }
  
  await ctx.reply("Принудительная проверка лучших новостей (макс. 3)...");
  isNewsChecking = true;
  try {
    await checkBestStories(db, bot, config.CHANNEL_ID, config.OPENROUTER_API_KEYS, config.MAX_ITEMS_PER_RUN);
    await ctx.reply("Проверка новостей завершена!");
  } catch (error) {
    console.error('Ошибка при проверке новостей:', error);
    await ctx.reply("❌ Произошла ошибка при проверке новостей");
  } finally {
    isNewsChecking = false;
  }
});

bot.command("force_jobs", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  if (isJobsChecking) {
    return ctx.reply("⏳ Проверка вакансий уже выполняется, подождите окончания.");
  }
  
  await ctx.reply("Принудительная проверка новых вакансий (макс. 3)...");
  isJobsChecking = true;
  try {
    await checkNewJobs(db, bot, config.JOB_CHANNEL_ID, config.MAX_ITEMS_PER_RUN);
    await ctx.reply("Проверка вакансий завершена!");
  } catch (error) {
    console.error('Ошибка при проверке вакансий:', error);
    await ctx.reply("❌ Произошла ошибка при проверке вакансий");
  } finally {
    isJobsChecking = false;
  }
});

bot.command("stop", async (ctx) => {
  if (!isOwner(ctx)) return;
  clearInterval(newsCheckerInterval);
  clearInterval(jobCheckerInterval);
  newsCheckerInterval = null;
  jobCheckerInterval = null;
  await ctx.reply("🛑 Автоматическая проверка новостей и вакансий остановлена.");
});

bot.command("start_auto", async (ctx) => {
  if (!isOwner(ctx)) return;
  startNewsChecker();
  startJobChecker();
  await ctx.reply("✅ Автоматическая проверка новостей и вакансий запущена.");
});

bot.command("stats", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const stats = await new Promise((resolve, reject) => {
      db.db.all(`
        SELECT channel_id, posts_count 
        FROM statistics 
        WHERE date = ?
      `, [today], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    let statsText = "📊 Статистика за сегодня:\n\n";
    
    if (stats.length === 0) {
      statsText += "Нет данных о публикациях за сегодня.";
    } else {
      for (const stat of stats) {
        const channelName = stat.channel_id === config.CHANNEL_ID ? "Hacker News" : 
                           (stat.channel_id === config.JOB_CHANNEL_ID ? "Вакансии" : stat.channel_id);
        statsText += `• ${channelName}: ${stat.posts_count} публикаций\n`;
      }
    }
    
    await ctx.reply(statsText);
  } catch (error) {
    console.error('Ошибка при получении статистики:', error);
    ctx.reply("❌ Произошла ошибка при получении статистики");
  }
});

bot.command("server", async (ctx) => {
  if (!isOwner(ctx)) return;
  
  try {
    // Получаем информацию о CPU
    const cpus = os.cpus();
    const cpuLoad = cpus.map(cpu => {
      const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
      const usage = total - cpu.times.idle;
      return Math.round(usage / total * 100);
    });
    
    const avgCpuLoad = cpuLoad.reduce((acc, load) => acc + load, 0) / cpuLoad.length;
    
    // Получаем информацию о памяти
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = Math.round((usedMem / totalMem) * 100);
    
    // Формируем сообщение
    let serverInfo = "🖥️ Информация о сервере:\n\n";
    serverInfo += `CPU: ${avgCpuLoad.toFixed(1)}% загрузка\n`;
    
    // Пытаемся получить температуру CPU
    try {
      const cpuTemp = await getCpuTemperature();
      if (cpuTemp !== 'N/A') {
        serverInfo += `🌡 Температура CPU: ${cpuTemp}\n`;
      }
    } catch (e) {
      console.error('Не удалось получить температуру CPU:', e);
    }
    
    serverInfo += `Память: ${memUsage}% использовано\n`;
    
    await ctx.reply(serverInfo);
  } catch (error) {
    console.error('Ошибка при получении информации о сервере:', error);
    ctx.reply("❌ Произошла ошибка при получении информации о сервере");
  }
});

bot.start().then(() => {
  console.log('🤖 Бот запущен!');
  
  // Запускаем автоматическую проверку
  startNewsChecker();
  startJobChecker();
  
  // Выполняем первую проверку при старте с задержкой
  setTimeout(() => {
    if (!isNewsChecking) {
      isNewsChecking = true;
      checkBestStories(db, bot, config.CHANNEL_ID, config.OPENROUTER_API_KEYS, config.MAX_ITEMS_PER_RUN)
        .finally(() => {
          isNewsChecking = false;
        });
    }
  }, 5000);
  
  setTimeout(() => {
    if (!isJobsChecking) {
      isJobsChecking = true;
      checkNewJobs(db, bot, config.JOB_CHANNEL_ID, config.MAX_ITEMS_PER_RUN)
        .finally(() => {
          isJobsChecking = false;
        });
    }
  }, 15000);
});

bot.catch((err) => {
  console.error('Ошибка бота:', err);
});