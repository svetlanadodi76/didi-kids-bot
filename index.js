const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

process.on('unhandledRejection', () => {});
process.on('uncaughtException', (err) => { console.error('err:', err.message); });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 10 },
  },
});
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
        '📩 Scrie-ne pentru a comanda!',
    ru: '👧 *Коллекция для девочек*\n\n' +
        '1. Костюм деним Mickey Mouse – 850 лей | размеры: 110-150 см\n' +
        '2. Костюм 2 предмета джинсы + розовая майка – 650 лей | размеры: 80-120 см\n' +
        '3. Платье серое с цветами премиум – 650 лей | размеры: 110-160 см\n' +
        '4. Элегантное платье бежевое с блёстками – 650 лей | размеры: 110-160 см\n' +
        '5. Платье хлопок с медвежонком – 590 лей | размеры: 90-130 см\n' +
        '6. Костюм деним розовый – 650 лей | размеры: 80-120 см\n' +
        '7. Костюм Chanel брюки с блёстками + чёрная майка – 650 лей | размеры: 90-130 см\n\n' +
        '📦 Доставка БЕСПЛАТНАЯ по всей Молдове\n' +
        '📩 Напишите нам для заказа!',
  },
  baieti: {
    ro: '👦 *Colecție Băieți*\n\n' +
        '1. Costum denim Louis Vuitton 3 piese – 850 lei | mărimi: 80-120 cm\n' +
        '2. Costum 3 piese pantaloni + maiou + cămașă – 650 lei | mărimi: 80-120 cm\n\n' +
        '📦 Livrare GRATUITĂ în toată Moldova\n' +
        '📩 Scrie-ne pentru a comanda!',
    ru: '👦 *Коллекция для мальчиков*\n\n' +
        '1. Костюм деним Louis Vuitton 3 предмета – 850 лей | размеры: 80-120 см\n' +
        '2. Костюм 3 предмета брюки + майка + рубашка – 650 лей | размеры: 80-120 см\n\n' +
        '📦 Доставка БЕСПЛАТНАЯ по всей Молдове\n' +
        '📩 Напишите нам для заказа!',
  },
};

const ORDER_INFO = {
  ro: '🛍 Cum sa faci o comanda la Didi Kids MD?\n\n' +
      '1. Alege modelul dorit din catalog\n' +
      '2. Trimite-ne poza cu modelul + marimea pentru copilul tau\n' +
      '3. Noi confirmam comanda si o pregatim pentru tine\n\n' +
      '📋 Pentru inregistrarea comenzii scrieti-ne:\n' +
      '— Numele, Prenumele\n' +
      '— Nr. de telefon\n' +
      '— Adresa de livrare\n' +
      '— Cod postal\n\n' +
      '🚚 Optiuni de livrare:\n' +
      '📮 Prin posta — 2-3 zile lucratoare\n' +
      '🏃 Prin curier — 2-3 zile lucratoare\n\n' +
      '📦 Livrarea este GRATUITA pe tot teritoriul Republicii Moldova!',
  ru: '🛍 Как сделать заказ в Didi Kids MD?\n\n' +
      '1. Выберите понравившуюся модель из каталога\n' +
      '2. Отправьте нам фото модели + размер для вашего ребёнка\n' +
      '3. Мы подтвердим заказ и подготовим его для вас\n\n' +
      '📋 Для оформления заказа напишите нам:\n' +
      '— Имя, Фамилия\n' +
      '— Номер телефона\n' +
      '— Адрес доставки\n' +
      '— Почтовый индекс\n\n' +
      '🚚 Варианты доставки:\n' +
      '📮 Почтой — 2-3 рабочих дня\n' +
      '🏃 Курьером — 2-3 рабочих дня\n\n' +
      '📦 Доставка БЕСПЛАТНАЯ по всей территории Молдовы!',
};

const userLang = {};
const userHistory = {};
const MAX_HISTORY = 6;

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
          { text: lang === 'ru' ? '🛍 Как заказать' : '🛍 Cum sa comand' },
          { text: lang === 'ru' ? '❓ Задать вопрос' : '❓ Intreaba Didi' },
        ],
      ],
      resize_keyboard: true,
    },
    parse_mode: 'Markdown',
  };
}

function welcomeText(lang) {
  return lang === 'ru'
    ? '👋 Добро пожаловать в Didi Kids MD!\n\nКрасивая одежда для детей из Молдовы.\n\n📸 Смотрите наш каталог в канале: @didikidsmd\n\nВыберите действие 👇'
    : '👋 Bun venit la Didi Kids MD!\n\nHaine frumoase pentru copii din Moldova.\n\n📸 Vezi catalogul nostru in canal: @didikidsmd\n\nAlege o optiune 👇';
}

function systemPrompt(lang) {
  return lang === 'ru'
    ? `Ты помощник магазина детской одежды Didi Kids MD (Молдова).

КАТАЛОГ:
- Девочки: костюм деним Mickey Mouse 850 лей (110-150 см), костюм 2 предмета джинсы+майка 650 лей (80-120 см), платье серое с цветами 650 лей (110-160 см), платье бежевое с блёстками 650 лей (110-160 см), платье хлопок с медвежонком 590 лей (90-130 см), костюм деним розовый 650 лей (80-120 см), костюм Chanel 650 лей (90-130 см).
- Мальчики: костюм деним Louis Vuitton 3 предмета 850 лей (80-120 см), костюм 3 предмета брюки+майка+рубашка 650 лей (80-120 см).
- Доставка БЕСПЛАТНАЯ, 2-3 рабочих дня (почта или курьер).

ПРАВИЛА:
1. НЕ придумывай продукты или цены — только из каталога выше.
2. НЕ упоминай другие магазины или бренды.
3. Давай советы ТОЛЬКО по уходу за одеждой (стирка, глажка) по типу ткани.
4. Отвечай КОРОТКО: максимум 2-3 предложения.
5. Если не знаешь ответа, скажи: "Не имею этой информации, но вы можете спросить нас напрямую через кнопку Задать вопрос."
6. Оставайся на теме детской одежды — если спрашивают о другом, вежливо перенаправь.
Отвечай на русском.`
    : `Esti asistentul magazinului de haine pentru copii Didi Kids MD (Moldova).

CATALOG:
- Fete: costum denim Mickey Mouse 850 lei (110-150 cm), costum 2 piese denim+maleta roz 650 lei (80-120 cm), rochie gri cu flori 650 lei (110-160 cm), rochie bej cu sclipici 650 lei (110-160 cm), rochie bumbac cu ursulet 590 lei (90-130 cm), costum denim roz 650 lei (80-120 cm), costum Chanel 650 lei (90-130 cm).
- Baieti: costum denim Louis Vuitton 3 piese 850 lei (80-120 cm), costum 3 piese pantaloni+maiou+camasa 650 lei (80-120 cm).
- Livrare GRATUITA, 2-3 zile lucratoare (posta sau curier).

REGULI:
1. NU inventa produse sau preturi — doar din catalogul de mai sus.
2. NU vorbi despre alte magazine sau produse.
3. Da sfaturi DOAR despre intretinerea hainelor (spalare, calcare) dupa tipul tesaturii.
4. Raspunsuri SCURTE: maxim 2-3 propozitii per mesaj.
5. Daca nu stii raspunsul, spune: "Nu am informatia asta, dar ne poti contacta direct prin butonul Intreaba Didi."
6. Ramai pe tema hainelor de copii — daca clientul intreaba altceva, redirectioneaza politicos.
Raspunde in romana.`;
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
    userHistory[chatId] = [];
    return bot.sendMessage(chatId, welcomeText(lang), mainMenu(lang));
  }

  if (['🛍 Cum sa comand', '🛍 Как заказать'].includes(cleanText)) {
    return bot.sendMessage(chatId, ORDER_INFO[lang], { reply_markup: mainMenu(lang).reply_markup })
      .catch(err => console.error('ORDER_INFO err:', err.message));
  }

  if (['❓ Intreaba Didi', '❓ Задать вопрос'].includes(cleanText)) {
    const prompt = lang === 'ru'
      ? '💬 Напишите ваш вопрос и я отвечу!'
      : '💬 Scrie intrebarea ta si iti raspund!';
    return bot.sendMessage(chatId, prompt, { reply_markup: mainMenu(lang).reply_markup });
  }

  userLang[chatId] = detectLang(cleanText || text);
  const updatedLang = getLang(chatId);

  if (!userHistory[chatId]) userHistory[chatId] = [];
  userHistory[chatId].push({ role: 'user', content: cleanText || text });
  if (userHistory[chatId].length > MAX_HISTORY) {
    userHistory[chatId] = userHistory[chatId].slice(-MAX_HISTORY);
  }

  try {
    await bot.sendChatAction(chatId, 'typing');
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt(updatedLang),
      messages: userHistory[chatId],
    });
    const reply = response.content[0].text;
    userHistory[chatId].push({ role: 'assistant', content: reply });
    if (userHistory[chatId].length > MAX_HISTORY) {
      userHistory[chatId] = userHistory[chatId].slice(-MAX_HISTORY);
    }
    bot.sendMessage(chatId, reply, { reply_markup: mainMenu(updatedLang).reply_markup });
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
