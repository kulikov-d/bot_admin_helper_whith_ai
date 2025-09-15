require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,
  JOB_CHANNEL_ID: process.env.JOB_CHANNEL_ID,
  OWNER_ID: process.env.OWNER_ID,
  
  // OpenRouter API keys
  OPENROUTER_API_KEYS: (() => {
    const keys = [];
    let keyIndex = 1;
    while (process.env[`OPENROUTER_API_KEY${keyIndex}`]) {
      keys.push(process.env[`OPENROUTER_API_KEY${keyIndex}`]);
      keyIndex++;
    }
    
    // Если основной ключ указан, добавляем его как первый
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (OPENROUTER_API_KEY) {
      keys.unshift(OPENROUTER_API_KEY);
    }
    
    return keys;
  })(),
  
  // Константы
  MAX_ITEMS_PER_RUN: 3,
  CHECK_INTERVAL: 30 * 60 * 1000 // 30 минут
};