const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CATALOG = {
  rochii: {
    ro: '👗 *Rochii fete*\n\n1. Rochiță florală – 299 MDL | mărimi: 92, 98, 104, 110\n2. Rochie elegantă albă – 349 MDL | mărimi: 98, 104, 110, 116\n3. Rochie casual dungi – 249 MDL | mărimi: 86, 92, 98, 104\n4. Rochiță cu volane roz – 319 MDL | mărimi: 92, 98, 104\n\n📦 Livrare GRATUITĂ în toată Moldova',
    ru: '👗 *Платья для девочек*\n\n1. Платье с цветами – 299 MDL | размеры: 92, 98, 104, 110\n2. Элегантное белое платье – 349 MDL | размеры: 98, 104, 110, 116\n3. Платье в полоску – 249 MDL | размеры: 86, 92, 98, 104\n4. Платье с воланами розовое – 319 MDL | размеры: 92, 98, 104\n\n📦 Доставка БЕСПЛАТНАЯ по всей Молдове',
  },
  seturi_fuste: {
    ro: '👚 *Seturi cu fuste*\n\n1. Set floral (bluză + fustă) – 399 MDL | mărimi: 92, 98, 104, 110\n2. Set elegant alb-roz – 449 MDL | mărimi: 98, 104, 110, 116\n3. Set casual (tricou + fustă dungată) – 349 MDL | mărimi: 86, 92, 98\n4. Set festiv cu paiete – 499 MDL | mărimi: 104, 110, 116\n\n📦 Livrare GRATUITĂ în toată Moldova',
    ru: '👚 *Комплекты с юбками*\n\n1. Цветочный комплект (блузка + юбка) – 399 MDL | размеры: 92, 98, 104, 110\n2. Элегантный бело-розовый – 449 MDL | размеры: 98, 104, 110, 116\n3. Casual (футболка + юбка в полоску) – 349 MDL | размеры: 86, 92, 98\n4. Праздничный с пайетками – 499 MDL | размеры: 104, 110, 116\n\n📦 Доставка БЕСПЛАТНАЯ по всей Молдове',
  },
  seturi_pantaloni: {
    ro: '👕 *Seturi cu pantaloni*\n\n1. Set sport (hanorac + pantaloni) – 379 MDL | mărimi: 92, 98, 104, 110, 116\n2. Set casual dungi – 329 MDL | mărimi: 86, 92, 98, 104\n3. Set elegant (cămașă + pantaloni) – 429 MDL | mărimi: 98, 104, 110, 116\n4. Set jeans + bluză – 459 MDL | mărimi: 92, 98, 104, 110\n\n📦 Livrare GRATUITĂ în toată Moldova',
    ru: '👕 *Комплекты с брюками*\n\n1. Спортивный (худи + брюки) – 379 MDL | размеры: 92, 98, 104, 110, 116\n2. Casual в полоску – 329 MDL | размеры: 86, 92, 98, 104\n3. Элегантный (рубашка + брюки) – 429 MDL | размеры: 98, 104, 110, 116\n4. Джинсы + блузка – 459 MDL | размеры: 92, 98, 104, 110\n\n📦 Доставка БЕСПЛАТНАЯ по всей Молдове',
  },
};

const ORDER_INFO = {
  ro: '🛍 *Cum să faci o comandă la Didi Kids MD?*\n\n' +
      '1. Alege modelul dorit din catalogul nostru\n' +
      '2. Trimite-ne poza cu modelul + mărimea pentru fetița ta\n' +
      '3. Noi confirmăm comanda și o pregătim pentru tine\n\n' +
      '📋 *Pentru înregistrarea comenzii scrieți-ne:*\n' +
      '— Numele, Prenumele\n' +
      '— Nr. de telefon\n' +
      '— Adresa de livrare\n' +
      '— Cod poștal\n\n' +
      '📦 *Livrarea este GRATUITĂ* pe tot teritoriul Republicii Moldova!\n\n' +
      '📩 Scrie-ne direct: @didikidsmd\\_bot',
  ru: '🛍 *Как сделать заказ в Didi Kids MD?*\n\n' +
      '1. Выберите понравившуюся модель из каталога\n' +
      '2. Отправьте нам фото модели + размер для вашей девочки\n' +
      '3. Мы подтвердим заказ и подготовим его для вас\n\n' +
      '📋 *Для оформления заказа напишите нам:*\n' +
      '— Имя, Фамилия\n' +
      '— Номер телефона\n' +
      '— Адрес доставки\n' +
      '— Почтовый индекс\n\n' +
      '📦 *Доставка БЕСПЛАТНАЯ* по всей территории Молдовы!\n\n' +
      '📩 Пишите нам: @didikidsmd\\_bot',
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
          { text: lang === 'ru' ? '👗 Платья' : '👗 Rochii' },
          { text: lang === 'ru' ? '👚 Комплекты с юбками' : '👚 Seturi cu fuste' },
        ],
        [
          { text: lang === 'ru' ? '👕 Комплекты с брюками' : '👕 Seturi cu pantaloni' },
          { text: lang === 'ru' ? '🛍 Cum sa comand' : '🛍 Cum sa comand' },
        ],
      ],
      resize_keyboard: true,
    },
    parse_mode: 'Markdown',
  };
}

function welcomeText(lang) {
  return lang === 'ru'
    ? '👋 Добро пожаловать в *Didi Kids MD*!\n\nМы предлагаем красивую одежду для девочек. Выберите категорию 👇'
    : '👋 Bun venit la *Didi Kids MD*!\n\nOferim haine frumoase pentru fetițe. Alege o categorie 👇';
}

function systemPrompt(lang) {
  return lang === 'ru'
    ? 'Ты помощник магазина Didi Kids MD (Молдова). Отвечай только о одежде, ценах, размерах и доставке. Каталог: платья (249-349 MDL), комплекты с юбками (349-499 MDL), комплекты с брюками (329-459 MDL). Размеры: 86-116. Доставка БЕСПЛАТНАЯ по всей Молдове. Будь кратким и дружелюбным. Отвечай на русском.'
    : 'Esti asistentul Didi Kids MD (Moldova). Raspunde doar despre haine, preturi, marimi si livrare. Catalog: rochii (249-349 MDL), seturi cu fuste (349-499 MDL), seturi cu pantaloni (329-459 MDL). Marimi: 86-116. Livrare GRATUITA in toata Moldova. Fii scurt si prietenos. Raspunde in romana.';
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

  if (['👗 Rochii', '👗 Платья'].includes(cleanText)) {
    return bot.sendMessage(chatId, CATALOG.rochii[lang], { parse_mode: 'Markdown', reply_markup: mainMenu(lang).reply_markup });
  }

  if (['👚 Seturi cu fuste', '👚 Комплекты с юбками'].includes(cleanText)) {
    return bot.sendMessage(chatId, CATALOG.seturi_fuste[lang], { parse_mode: 'Markdown', reply_markup: mainMenu(lang).reply_markup });
  }

  if (['👕 Seturi cu pantaloni', '👕 Комплекты с брюками'].includes(cleanText)) {
    return bot.sendMessage(chatId, CATALOG.seturi_pantaloni[lang], { parse_mode: 'Markdown', reply_markup: mainMenu(lang).reply_markup });
  }

  if (['🛍 Cum sa comand'].includes(cleanText)) {
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
    console.error(error);
    bot.sendMessage(chatId, updatedLang === 'ru' ? 'Произошла ошибка. Попробуйте ещё раз.' : 'A aparut o eroare. Incercati din nou.');
  }
});

console.log('Didi Kids Bot pornit...');
