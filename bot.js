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
let intervalId, jobIntervalId;

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
  intervalId = setInterval(() => {
    checkBestStories(db, bot, config.CHANNEL_ID, config.OPENROUTER_API_KEYS, config.MAX_ITEMS_PER_RUN);
  }, config.CHECK_INTERVAL);
}

// Запускаем проверку новых вакансий каждые 30 минут
function startJobChecker() {
  jobIntervalId = setInterval(() => {
    checkNewJobs(db, bot, config.JOB_CHANNEL_ID, config.MAX_ITEMS_PER_RUN);
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
  await ctx.reply("Принудительная проверка лучших новостей (макс. 3)...");
  await checkBestStories(db, bot, config.CHANNEL_ID, config.OPENROUTER_API_KEYS, config.MAX_ITEMS_PER_RUN);
  await ctx.reply("Проверка новостей завершена!");
});

bot.command("force_jobs", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply("Принудительная проверка новых вакансий (макс. 3)...");
  await checkNewJobs(db, bot, config.JOB_CHANNEL_ID, config.MAX_ITEMS_PER_RUN);
  await ctx.reply("Проверка вакансий завершена!");
});

bot.command("stop", async (ctx) => {
  if (!isOwner(ctx)) return;
  clearInterval(intervalId);
  clearInterval(jobIntervalId);
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
    
    // Получаем температуру CPU
    const cpuTemp = await getCpuTemperature();
    
    // Получаем информацию о памяти
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = Math.round((usedMem / totalMem) * 100);
    
    // Получаем информацию о диске
    const osType = os.type();
    let diskUsage = "N/A";
    
    if (osType === 'Linux' || osType === 'Darwin') {
      try {
        const { execSync } = require('child_process');
        const dfOutput = execSync('df -h /').toString().split('\n')[1];
        diskUsage = dfOutput.split(/\s+/)[4];
      } catch (e) {
        console.error('Ошибка при получении информации о диске:', e);
      }
    }
    
    // Формируем сообщение
    let serverInfo = "🖥️ Информация о сервере:\n\n";
    serverInfo += `CPU: ${avgCpuLoad.toFixed(1)}% загрузка\n`;
    if (cpuTemp !== 'N/A') {
      serverInfo += `🌡 Температура CPU: ${cpuTemp}\n`;
    }
    serverInfo += `Память: ${memUsage}% использовано\n`;
    serverInfo += `Диск: ${diskUsage}\n`;
    serverInfo += `Платформа: ${os.platform()} ${os.arch()}\n`;
    serverInfo += `Версия Node.js: ${process.version}\n\n`;
    serverInfo += `Всего памяти: ${(totalMem / (1024 * 1024 * 1024)).toFixed(2)} ГБ\n`;
    serverInfo += `Свободно памяти: ${(freeMem / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
    
    await ctx.reply(serverInfo);
  } catch (error) {
    console.error('Ошибка при получении информации о сервере:', error);
    ctx.reply("❌ Произошла ошибка при получении информации о сервере");
  }
});

bot.start().then(() => {
  console.log('🤖 Бот запущен!');
  // Выполняем первую проверку при старте
  setTimeout(() => {
    checkBestStories(db, bot, config.CHANNEL_ID, config.OPENROUTER_API_KEYS, config.MAX_ITEMS_PER_RUN);
  }, 5000);
  
  setTimeout(() => {
    checkNewJobs(db, bot, config.JOB_CHANNEL_ID, config.MAX_ITEMS_PER_RUN);
  }, 15000);
  
  // Запускаем автоматическую проверку
  startNewsChecker();
  startJobChecker();
});

bot.catch((err) => {
  console.error('Ошибка бота:', err);
});