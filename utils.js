const { OpenAI } = require("openai");

// Функция для получения текущего клиента OpenAI
function getOpenAIClient(apiKeys, currentKeyIndex) {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKeys[currentKeyIndex],
    defaultHeaders: {
      "HTTP-Referer": "https://your-telegram-bot.com",
      "X-Title": "Hacker News Digest Bot"
    }
  });
}

// Функция для получения температуры CPU (только для Linux)
function getCpuTemperature() {
  return new Promise((resolve) => {
    // Для Linux систем
    const exec = require('child_process').exec;
    exec('cat /sys/class/thermal/thermal_zone*/temp', (error, stdout) => {
      if (error) {
        // Для Windows систем
        exec('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature', (error2, stdout2) => {
          if (error2) {
            resolve('N/A');
          } else {
            const lines = stdout2.trim().split('\n');
            if (lines.length > 1) {
              const tempLine = lines[1].trim();
              if (tempLine && !isNaN(tempLine)) {
                // Преобразуем из десятых градусов Кельвина в градусы Цельсия
                const tempK = parseInt(tempLine) / 10;
                const tempC = tempK - 273.15;
                resolve(`${tempC.toFixed(1)}°C`);
              } else {
                resolve('N/A');
              }
            } else {
              resolve('N/A');
            }
          }
        });
      } else {
        const temps = stdout.trim().split('\n');
        if (temps.length > 0) {
          // Преобразуем из тысячных градусов Цельсия
          const temp = parseInt(temps[0]) / 1000;
          resolve(`${temp.toFixed(1)}°C`);
        } else {
          resolve('N/A');
        }
      }
    });
  });
}

module.exports = {
  getOpenAIClient,
  getCpuTemperature
};