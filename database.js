const sqlite3 = require('sqlite3').verbose();
const { DATABASE_PATH = './hn_bot.db' } = process.env;

class Database {
  constructor() {
    this.db = new sqlite3.Database(DATABASE_PATH, (err) => {
      if (err) {
        console.error('Ошибка подключения к БД:', err);
      } else {
        console.log('Подключен к SQLite DB.');
        this.initTables();
      }
    });
  }
  
  initTables() {
    // Создаем таблицу для отслеживания уже отправленных новостей
    this.db.run(`CREATE TABLE IF NOT EXISTS posted_stories (
      id INTEGER PRIMARY KEY,
      story_id INTEGER NOT NULL UNIQUE,
      title TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Ошибка при создании таблицы новостей:', err);
      } else {
        console.log('Таблица posted_stories создана/проверена');
      }
    });
    
    // Создаем таблицу для отслеживания уже отправленных вакансий
    this.db.run(`CREATE TABLE IF NOT EXISTS posted_jobs (
      id INTEGER PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      title TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Ошибка при создании таблицы вакансий:', err);
      } else {
        console.log('Таблица posted_jobs создана/проверена');
      }
    });
    
    // Создаем таблицу для статистики
    this.db.run(`CREATE TABLE IF NOT EXISTS statistics (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      posts_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, channel_id)
    )`, (err) => {
      if (err) {
        console.error('Ошибка при создании таблицы статистики:', err);
      } else {
        console.log('Таблица statistics создана/проверена');
      }
    });
  }
  
  // Функция для проверки, была ли новость уже отправлена
  isStoryPosted(storyId) {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT story_id FROM posted_stories WHERE story_id = ?", [storyId], (err, row) => {
        if (err) reject(err);
        resolve(!!row);
      });
    });
  }
  
  // Функция для отметки новости как отправленной
  markStoryAsPosted(storyId, title) {
    return new Promise((resolve, reject) => {
      this.db.run("INSERT INTO posted_stories (story_id, title) VALUES (?, ?)", [storyId, title], function(err) {
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
  
  // Функция для проверки, была ли вакансия уже отправлена
  isJobPosted(jobId) {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT job_id FROM posted_jobs WHERE job_id = ?", [jobId], (err, row) => {
        if (err) reject(err);
        resolve(!!row);
      });
    });
  }
  
  // Функция для отметки вакансии как отправленной
  markJobAsPosted(jobId, title) {
    return new Promise((resolve, reject) => {
      this.db.run("INSERT INTO posted_jobs (job_id, title) VALUES (?, ?)", [jobId, title], function(err) {
        if (err) {
          console.error('Ошибка при сохранении вакансии в БД:', err);
          reject(err);
        } else {
          console.log(`Вакансия #${jobId} сохранена в БД`);
          resolve();
        }
      });
    });
  }
  
  // Функция для обновления статистики
  updateStatistics(channelId) {
    const today = new Date().toISOString().split('T')[0];
    
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO statistics (date, channel_id, posts_count) 
         VALUES (?, ?, 1) 
         ON CONFLICT(date, channel_id) DO UPDATE SET posts_count = posts_count + 1`,
        [today, channelId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }
  
  close() {
    this.db.close();
  }
}

module.exports = Database;