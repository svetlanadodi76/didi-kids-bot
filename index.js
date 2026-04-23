const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

process.on('unhandledRejection', () => {});
process.on('uncaughtException', (err) => { console.error('err:', err.message); });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CATALOG = {
  fete: {
    ro: '👧 *Colecție Fete*\n\n' +
        '1. Costum denim Mickey Mouse – 850 lei | mărimi: 110-150 cm\n' +
        '2. Costum 2 piese pantaloni denim + maletă roz – 650 lei | mărimi: 80-120 cm\n' +
        '3. Rochie gri cu flori premium – 650 lei | mărimi: 110-160 cm\n' +
        '4. Rochie elegantă bej cu sclipici – 650 lei | mărimi: 110-160 cm\n' +
        '5. Rochie bumbac cu ursuleț – 590 lei | mărimi: 90-130 cm\n' +
        '6. Costum denim roz – 650 lei | mărimi: 80-120 cm\n' +
        '7. Costum Chanel pantaloni sclipici + maiou negru – 650 lei | mărimi: 90-130 cm\n\n' +
        '📦 Livrare GRATUITĂ în toată Moldova\n' +
        '📩 Comandă: @didikidsmd_bot',
    ru: '👧 *Коллекция для девочек*\n\n' +
        '1. Костюм деним Mickey Mouse – 850 лей | размеры: 110-150 см\n' +
        '2. Костюм 2 предмета джинсы + розовая майка – 650 лей | размеры: 80-120 см\n' +
        '3. Платье серое с цветами премиум – 650 лей | размеры: 110-160 см\n' +
        '4. Элегантное платье бежевое с блёстками – 650 лей | размеры: 110-160 см\n' +
        '5. Платье хлопок с медвежонком – 590 лей | размеры: 90-130 см\n' +
        '6. Костюм деним розовый – 650 лей | размеры: 80-120 см\n' +
        '7. Костюм Chanel брюки с блёстками + чёрная майка – 650 лей | размеры: 90-130 см\n\n' +
        '📦 Доставка БЕСПЛАТНАЯ по всей Молдове\n' +
        '📩 Заказ: @didikidsmd_bot',
  },
  baieti: {
    ro: '👦 *Colecție Băieți*\n\n' +
        '1. Costum denim Louis Vuitton 3 piese – 850 lei | mărimi: 80-120 cm\n' +
        '2. Costum 3 piese pantaloni + maiou + cămașă – 650 lei | mărimi: 80-120 cm\n\n' +
        '📦 Livrare GRATUITĂ în toată Moldova\n' +
        '📩 Comandă: @didikidsmd_bot',
    ru: '👦 *Коллекция для мальчиков*\n\n' +
        '1. Костюм деним Louis Vuitton 3 предмета – 850 лей | размеры: 80-120 см\n' +
        '2. Костюм 3 предмета брюки + майка + рубашка – 650 лей | размеры: 80-120 см\n\n' +
        '📦 Доставка БЕСПЛАТНАЯ по всей Молдове\n' +
        '📩 Заказ: @didikidsmd_bot',
  },
};

const ORDER_INFO = {
  ro: '🛍 *Cum să faci o comandă la Didi Kids MD?*\n\n' +
      '1. Alege modelul dorit din catalog\n' +
      '2. Trimite-ne poza cu modelul + mărimea pentru copilul tău\n' +
      '3. Noi confirmăm comanda și o pregătim pentru tine\n\n' +
      '📋 *Pentru înregistrarea comenzii scrieți-ne:*\n' +
      '— Numele, Prenumele\n' +
      '— Nr. de telefon\n' +
      '— Adresa de livrare\n' +
      '— Cod poștal\n\n' +
      '🚚 *Opțiuni de livrare:*\n' +
      '📮 Prin poștă — livrare în 2-4 zile lucrătoare\n' +
      '🏃 Prin curier — livrare în 1-2 zile lucrătoare\n\n' +
      '📦 *Livrarea este GRATUITĂ* pe tot teritoriul Republicii Moldova!\n\n' +
      '📩 Scrie-ne direct: @didikidsmd_bot',
  ru: '🛍 *Как сделать заказ в Didi Kids MD?*\n\n' +
      '1. Выберите понравившуюся модель из каталога\n' +
      '2. Отправьте нам фото модели + размер для вашего ребёнка\n' +
      '3. Мы подтвердим заказ и подготовим его для вас\n\n' +
      '📋 *Для оформления заказа напишите нам:*\n' +
      '— Имя, Фамилия\n' +
      '— Номер телефона\n' +
      '— Адрес доставки\n' +
      '— Почтовый индекс\n\n' +
      '🚚 *Варианты доставки:*\n' +
      '📮 Почтой — доставка 2-4 рабочих дня\n' +
      '🏃 Курьером — доставка 1-2 рабочих дня\n\n' +
      '📦 *Доставка БЕСПЛАТНАЯ* по всей территории Молдовы!\n\n' +
      '📩 Пишите нам: @didikidsmd_bot',
};

const userLang = {};

function detectLang(text) {
  if (!text) return 'ro';
  const ruChars = (text.match(/[а-яёА-ЯЁ]/g) || []).length;
  const roChars = (text.match(/[a-zA-ZăîâșțĂÎÂȘȚ]/g) || []).length;
  return ruChars > roChars ? 'ru' : 'ro';
}

function getLang(chatId) {
  return userLang[chatId] || 'ro';
}

function mainMenu(lang) {
  return {
    reply_markup: {
      keyboard: [
        [
          { text: lang === 'ru' ? '👧 Девочки' : '👧 Fete' },
          { text: lang === 'ru' ? '👦 Мальчики' : '👦 Băieți' },
        ],
        [
          { text: lang === 'ru' ? '🛍 Как заказать' : '🛍 Cum sa comand' },
        ],
      ],
      resize_keyboard: true,
    },
    parse_mode: 'Markdown',
  };
}

function welcomeText(lang) {
  return lang === 'ru'
    ? '👋 Добро пожаловать в *Didi Kids MD*!\n\nКрасивая одежда для детей. Выберите категорию 👇'
    : '👋 Bun venit la *Didi Kids MD*!\n\nHaine frumoase pentru copii. Alege o categorie 👇';
}

function systemPrompt(lang) {
  return lang === 'ru'
    ? 'Ты помощник магазина Didi Kids MD (Молдова). Отвечай только о одежде, ценах, размерах и доставке. Для девочек: костюм деним Mickey Mouse 850 лей, костюм 2 предмета 650 лей, платья 590-650 лей. Для мальчиков: костюм деним Louis Vuitton 850 лей, костюм 3 предмета 650 лей. Размеры: 80-160 см. Доставка БЕСПЛАТНАЯ по всей Молдове (почтой 2-4 дня или курьером 1-2 дня). Будь кратким и дружелюбным. Отвечай на русском.'
    : 'Esti asistentul Didi Kids MD (Moldova). Raspunde doar despre haine, preturi, marimi si livrare. Pentru fete: costum denim Mickey Mouse 850 lei, costum 2 piese 650 lei, rochite 590-650 lei. Pentru baieti: costum denim Louis Vuitton 850 lei, costum 3 piese 650 lei. Marimi: 80-160 cm. Livrare GRATUITA in toata Moldova (prin posta 2-4 zile sau prin curier 1-2 zile). Fii scurt si prietenos. Raspunde in romana.';
}

function isGroup(msg) {
  return msg.chat.type === 'group' || msg.chat.type === 'supergroup';
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const botUsername = process.env.BOT_USERNAME || '';

  if (isGroup(msg)) {
    const isMentioned = botUsername && text.includes('@' + botUsername);
    const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot;
    if (!isMentioned && !isReplyToBot && text !== '/start') return;
  }

  if (!userLang[chatId] || text === '/start') {
    userLang[chatId] = detectLang(text === '/start' ? '' : text);
  }

  const lang = getLang(chatId);
  const cleanText = text.replace(/@\w+/g, '').trim();

  if (cleanText === '/start' || text === '/start') {
    return bot.sendMessage(chatId, welcomeText(lang), mainMenu(lang));
  }

  if (['👧 Fete', '👧 Девочки'].includes(cleanText)) {
    return bot.sendMessage(chatId, CATALOG.fete[lang], { parse_mode: 'Markdown', reply_markup: mainMenu(lang).reply_markup });
  }

  if (['👦 Băieți', '👦 Мальчики'].includes(cleanText)) {
    return bot.sendMessage(chatId, CATALOG.baieti[lang], { parse_mode: 'Markdown', reply_markup: mainMenu(lang).reply_markup });
  }

  if (['🛍 Cum sa comand', '🛍 Как заказать'].includes(cleanText)) {
    return bot.sendMessage(chatId, ORDER_INFO[lang], { parse_mode: 'Markdown', reply_markup: mainMenu(lang).reply_markup });
  }

  userLang[chatId] = detectLang(cleanText || text);
  const updatedLang = getLang(chatId);

  try {
    await bot.sendChatAction(chatId, 'typing');
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt(updatedLang),
      messages: [{ role: 'user', content: cleanText || text }],
    });
    bot.sendMessage(chatId, response.content[0].text, { reply_markup: mainMenu(updatedLang).reply_markup });
  } catch (error) {
    console.error('AI error:', error.message);
    bot.sendMessage(chatId, updatedLang === 'ru' ? 'Произошла ошибка. Попробуйте ещё раз.' : 'A aparut o eroare. Incercati din nou.');
  }
});

bot.on('polling_error', (error) => {
  const msg = error.message || '';
  if (msg.includes('409')) {
    process.exit(1);
  }
  // suprima alte erori de polling ca sa nu depasim rate limit-ul
});

console.log('Didi Kids Bot pornit...');
