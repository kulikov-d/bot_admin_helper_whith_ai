const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { translateWithGoogle, cleanHtml } = require('./translator');

// Функция для проверки новых вакансий через Jobicy API
async function checkNewJobs(db, bot, JOB_CHANNEL_ID, MAX_ITEMS_PER_RUN) {
  try {
    console.log('Проверяем новые вакансии через Jobicy API...');
    
    // Запрашиваем вакансии через Jobicy API
    const jobsResponse = await fetch('https://jobicy.com/api/v2/remote-jobs?count=20');
    
    if (!jobsResponse.ok) {
      throw new Error(`Jobicy API error: ${jobsResponse.status}`);
    }
    
    const contentType = jobsResponse.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const responseText = await jobsResponse.text();
      throw new Error(`Unexpected content type: ${contentType}. Response: ${responseText.substring(0, 200)}`);
    }
    
    const jobsData = await jobsResponse.json();
    
    if (!jobsData || !jobsData.jobs || !Array.isArray(jobsData.jobs)) {
      throw new Error('Invalid response structure from Jobicy API');
    }
    
    const newJobs = jobsData.jobs;
    let newJobsCount = 0;
    
    for (const job of newJobs) {
      try {
        const alreadyPosted = await db.isJobPosted(job.id);
        if (alreadyPosted) {
          continue;
        }
        
        console.log(`Обрабатываем новую вакансию #${job.id}: ${job.jobTitle}`);
        
        // Переводим основные поля с помощью Google Translate
        const translatedTitle = await translateWithGoogle(cleanHtml(job.jobTitle || 'Без названия'));
        const translatedCompany = await translateWithGoogle(cleanHtml(job.companyName || 'Компания не указана'));
        const translatedType = await translateWithGoogle(cleanHtml(job.jobType || 'Тип не указан'));
        const translatedIndustry = await translateWithGoogle(cleanHtml(job.industry || ''));
        
        // Формируем сообщение
        let message = `💼 *${translatedTitle}*\n`;
        message += `🏢 ${translatedCompany}\n`;
        message += `🕒 ${translatedType}\n`;
        message += `🌍 Удаленная работа\n`;
        
        if (translatedIndustry) {
          message += `🏭 ${translatedIndustry}\n`;
        }
        
        // Обрабатываем описание с проверкой на null/undefined и переводим
        let jobDescription = '';
        if (job.jobDescription && typeof job.jobDescription === 'string') {
          // Ограничиваем длину описания, очищаем HTML и переводим
          const cleanDescription = cleanHtml(job.jobDescription);
          const translatedDescription = await translateWithGoogle(cleanDescription);
          jobDescription = translatedDescription.substring(0,0);
        } else {
          jobDescription = 'Описание отсутствует';
        }
        
        message += `\n${jobDescription}...\n\n`;
        message += `——\n`;
        message += `[Подробнее](${job.url || 'Ссылка отсутствует'})\n`;
        message += `[Подписаться на вакансии](https://t.me/your_job_channel)`;
        
        if (JOB_CHANNEL_ID) {
          await bot.api.sendMessage(JOB_CHANNEL_ID, message, {
            parse_mode: "Markdown",
            disable_web_page_preview: true
          });
          
          console.log(`Вакансия #${job.id} отправлена в канал!`);
          await db.markJobAsPosted(job.id, job.jobTitle || 'Без названия');
          await db.updateStatistics(JOB_CHANNEL_ID);
          newJobsCount++;
          
          // Проверяем лимит после каждой отправки
          if (newJobsCount >= MAX_ITEMS_PER_RUN) {
            console.log(`Достигнут лимит в ${MAX_ITEMS_PER_RUN} вакансии за один запуск`);
            break;
          }
          
          // Пауза между отправкой сообщений (увеличена до 20 секунд)
          await new Promise(resolve => setTimeout(resolve, 20000));
        }
      } catch (error) {
        console.error(`Ошибка при обработке вакансии #${job.id}:`, error);
      }
    }
    
    if (newJobsCount > 0) {
      console.log(`Обработано новых вакансий: ${newJobsCount}`);
    } else {
      console.log('Новых вакансий не найдено');
    }
  } catch (error) {
    console.error('Ошибка при проверке новых вакансий:', error);
    
    // Отправляем уведомление владельцу бота о проблеме с API
    if (process.env.OWNER_ID) {
      try {
        await bot.api.sendMessage(process.env.OWNER_ID, `⚠️ Ошибка при проверке вакансий: ${error.message}`);
      } catch (sendError) {
        console.error('Не удалось отправить уведомление владельцу:', sendError);
      }
    }
  }
}

module.exports = {
  checkNewJobs
};