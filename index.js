const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

process.on('unhandledRejection', () => {});
process.on('uncaughtException', (err) => { console.error('err:', err.message); });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Google Sheets ─────────────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getStocForProduct(codProdus) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Stoc!A:I',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  const result = [];
  for (const row of rows) {
    if (String(row[0] || '').toUpperCase() === codProdus.toUpperCase()) {
      const stoc = parseFloat(row[6]) || 0;
      if (stoc > 0) {
        const parts = String(row[1] || '').split(' - ');
        const marime = parts[parts.length - 1].trim();
        const pret = Math.round(parseFloat(row[7]) || 0);
        result.push({ marime, pret });
      }
    }
  }
  return result;
}

async function addComanda(data) {
  const sheets = getSheetsClient();
  const countRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Comenzi!A:A',
  });
  const nr = (countRes.data.values || []).length;

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Comenzi!A:P',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        // A=Nr, B=Data, C=Client, D=Telefon, E=Adresa
        nr, dateStr, data.nume, data.telefon, data.adresa,
        // F=Cod Produs, G=Descriere, H=Cantitate, I=Pret/buc, J=Cost/buc
        `${data.cod_produs} - ${data.marime}`, data.descriere_produs, 1, data.pret, '',
        // K=Total Vanzare, L=Total Cost, M=Metoda Livrare, N=Cost Livrare, O=AWB, P=Status, Q=Profit
        data.pret, '', data.livrare, '', '', '', '',
      ]],
    },
  });
}
// ───────────────────────────────────────────────────────────────────────────────

const userLang = {};
const userHistory = {};
const userOrder = {};
const MAX_HISTORY = 6;

const ORDER_STEPS = {
  ro: [
    null, // 0: foto
    null, // 1: marime (butoane)
    'Care este numele si prenumele tau? (ex: Ion Popescu)',
    'Care este numarul tau de telefon? (ex: 069123456)',
    'Care este adresa de livrare? (oras/sat, strada, nr.)',
    'Care este codul postal? (4 cifre, ex: 2001)',
    'Cum doriti livrarea?',
  ],
  ru: [
    null, null,
    'Как вас зовут (имя и фамилия)? (пр: Иван Попеску)',
    'Какой у вас номер телефона? (пр: 069123456)',
    'Какой адрес доставки? (город/село, улица, номер)',
    'Какой почтовый индекс? (4 цифры, пр: 2001)',
    'Как вы хотите получить заказ?',
  ],
};

const FIELD_MAP = { 2: 'nume', 3: 'telefon', 4: 'adresa', 5: 'cod_postal' };

function validateNume(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return false;
  return parts.every(p => /^[a-zA-ZăîâșțĂÎÂȘȚа-яёА-ЯЁ\-]{2,}$/.test(p));
}

function validateTelefon(text) {
  return /^0[67]\d{7}$/.test(text.trim().replace(/\s+/g, ''));
}

function validateAdresa(text) {
  return text.trim().length >= 10;
}

function validateCodPostal(text) {
  return /^\d{4}$/.test(text.trim());
}

async function verifyCodPostal(adresa, cod) {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: `In Republica Moldova, codul postal "${cod}" corespunde localitatii/adresei "${adresa}"? Raspunde DOAR cu CORECT sau INCORECT.` }],
    });
    return res.content[0].text.trim().toUpperCase().startsWith('CORECT');
  } catch { return true; }
}

function sizeMenu(marimi, lang) {
  const rows = marimi.map(m => [{ text: `📏 ${m.marime} cm — ${m.pret} lei` }]);
  rows.push([{ text: lang === 'ru' ? '❌ Отмена' : '❌ Anuleaza' }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true } };
}

function livrareMenu(lang) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📮 Prin posta' }, { text: '🏃 Prin curier' }],
        [{ text: lang === 'ru' ? '❌ Отмена' : '❌ Anuleaza' }],
      ],
      resize_keyboard: true,
    },
  };
}

function detectLang(text) {
  if (!text) return 'ro';
  const ruChars = (text.match(/[а-яёА-ЯЁ]/g) || []).length;
  const roChars = (text.match(/[a-zA-ZăîâșțĂÎÂȘȚ]/g) || []).length;
  return ruChars > roChars ? 'ru' : 'ro';
}

function getLang(chatId) { return userLang[chatId] || 'ro'; }

function mainMenu(lang) {
  return {
    reply_markup: {
      keyboard: [[
        { text: lang === 'ru' ? '🛍 Как заказать' : '🛍 Cum sa comand' },
        { text: lang === 'ru' ? '❓ Задать вопрос' : '❓ Intreaba Didi' },
      ]],
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
- Девочки: костюм деним Mickey Mouse 850 лей (110-160 см), костюм 2 предмета джинсы+майка 650 лей (80-120 см), платье серое с цветами 650 лей (110-160 см), платье бежевое с блёстками 650 лей (110-160 см), платье хлопок с медвежонком 590 лей (90-130 см), костюм деним розовый 650 лей (80-120 см), костюм Chanel 650 лей (90-130 см).
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
- Fete: costum denim Mickey Mouse 850 lei (110-160 cm), costum 2 piese denim+maleta roz 650 lei (80-120 cm), rochie gri cu flori 650 lei (110-160 cm), rochie bej cu sclipici 650 lei (110-160 cm), rochie bumbac cu ursulet 590 lei (90-130 cm), costum denim roz 650 lei (80-120 cm), costum Chanel 650 lei (90-130 cm).
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
    userOrder[chatId] = { step: 0, data: {} };
    return bot.sendMessage(chatId,
      lang === 'ru'
        ? '🛍 Incepem inregistrarea comenzii!\n\nForwardeaza poza produsului dorit direct din canalul @didikidsmd.'
        : '🛍 Incepem inregistrarea comenzii!\n\nForwardeaza poza produsului dorit direct din canalul @didikidsmd.',
      { reply_markup: { keyboard: [[{ text: lang === 'ru' ? '❌ Отмена' : '❌ Anuleaza' }]], resize_keyboard: true } });
  }

  if (['❌ Anuleaza', '❌ Отмена'].includes(cleanText)) {
    delete userOrder[chatId];
    return bot.sendMessage(chatId, lang === 'ru' ? 'Comanda anulata.' : 'Comanda anulata.', mainMenu(lang));
  }

  if (userOrder[chatId] !== undefined) {
    const order = userOrder[chatId];
    const cancelKb = { reply_markup: { keyboard: [[{ text: lang === 'ru' ? '❌ Отмена' : '❌ Anuleaza' }]], resize_keyboard: true } };

    // Pasul 0: foto + detectie cod produs
    if (order.step === 0) {
      if (!msg.photo) {
        return bot.sendMessage(chatId,
          lang === 'ru'
            ? 'Te rugam forwardeaza poza produsului din canalul @didikidsmd.'
            : 'Te rugam forwardeaza poza produsului din canalul @didikidsmd.',
          cancelKb);
      }

      const caption = msg.caption || '';
      const codeMatch = caption.match(/CH\d{3}/i);

      if (!codeMatch) {
        return bot.sendMessage(chatId,
          lang === 'ru'
            ? '⚠️ Nu am gasit codul produsului in descriere.\nForwardeaza poza direct din canalul @didikidsmd (nu trimite poza din galerie).'
            : '⚠️ Nu am gasit codul produsului in descriere.\nForwardeaza poza direct din canalul @didikidsmd (nu trimite poza din galerie).',
          cancelKb);
      }

      const codProdus = codeMatch[0].toUpperCase();
      order.data.photo_id = msg.photo[msg.photo.length - 1].file_id;
      order.data.cod_produs = codProdus;
      order.data.descriere_produs = caption.split('\n')[0] || codProdus;

      await bot.sendChatAction(chatId, 'typing');

      try {
        const marimi = await getStocForProduct(codProdus);
        if (marimi.length === 0) {
          delete userOrder[chatId];
          return bot.sendMessage(chatId,
            lang === 'ru'
              ? `Ne pare rau, produsul *${codProdus}* nu este disponibil momentan. Revino curand!`
              : `Ne pare rau, produsul *${codProdus}* nu este disponibil momentan. Revino curand!`,
            { ...mainMenu(lang), parse_mode: 'Markdown' });
        }
        order.data.marimi_disponibile = marimi;
        order.step = 1;
        return bot.sendMessage(chatId,
          lang === 'ru'
            ? `✅ Produs: *${codProdus}*\n\nAlege marimea dorita (marimile disponibile in stoc):`
            : `✅ Produs: *${codProdus}*\n\nAlege marimea dorita (marimile disponibile in stoc):`,
          { ...sizeMenu(marimi, lang), parse_mode: 'Markdown' });
      } catch (e) {
        console.error('Sheets getStoc err:', e.message);
        order.step = 2;
        return bot.sendMessage(chatId, ORDER_STEPS[lang][2], cancelKb);
      }
    }

    // Pasul 1: selectia marimii din butoane
    if (order.step === 1) {
      const raw = (cleanText || text).trim().replace('📏 ', '');
      const value = raw.split(' — ')[0].replace(' cm', '').trim();
      const marimi = order.data.marimi_disponibile || [];
      const selected = marimi.find(m => m.marime === value);

      if (!selected) {
        return bot.sendMessage(chatId,
          lang === 'ru' ? 'Alege una din marimile disponibile:' : 'Alege una din marimile disponibile:',
          sizeMenu(marimi, lang));
      }

      order.data.marime = value;
      order.data.pret = selected.pret;
      order.step = 2;
      return bot.sendMessage(chatId, ORDER_STEPS[lang][2], cancelKb);
    }

    // Pasii 2-5: colecteaza datele personale
    if (order.step >= 2 && order.step <= 5) {
      const value = (cleanText || text).trim();

      if (order.step === 2 && !validateNume(value)) {
        return bot.sendMessage(chatId, 'Introdu Numele si Prenumele complet cu litere (ex: Ion Popescu).', cancelKb);
      }
      if (order.step === 3 && !validateTelefon(value)) {
        return bot.sendMessage(chatId, 'Numarul trebuie sa inceapa cu 06 sau 07 urmat de 7 cifre (ex: 069123456).', cancelKb);
      }
      if (order.step === 4 && !validateAdresa(value)) {
        return bot.sendMessage(chatId, 'Introdu adresa completa: oras/sat, strada, numar.', cancelKb);
      }
      if (order.step === 5 && !validateCodPostal(value)) {
        return bot.sendMessage(chatId, 'Codul postal trebuie sa fie exact 4 cifre (ex: 2001, 3100). Verifica pe posta.md', cancelKb);
      }

      order.data[FIELD_MAP[order.step]] = value;
      order.step++;

      if (order.step === 6) {
        await bot.sendChatAction(chatId, 'typing');
        const postalOk = await verifyCodPostal(order.data.adresa, order.data.cod_postal);
        if (!postalOk) {
          order.step = 5;
          delete order.data.cod_postal;
          return bot.sendMessage(chatId,
            `Codul postal ${value} nu corespunde adresei indicate. Verificati pe https://posta.md/ro/map si introduceti din nou.`,
            cancelKb);
        }
        return bot.sendMessage(chatId, ORDER_STEPS[lang][6], livrareMenu(lang));
      }
      return bot.sendMessage(chatId, ORDER_STEPS[lang][order.step], cancelKb);
    }

    // Pasul 6: livrare + finalizare comanda
    if (order.step === 6) {
      const value = (cleanText || text).trim();
      if (!['📮 Prin posta', '🏃 Prin curier'].includes(value)) {
        return bot.sendMessage(chatId, 'Alege una din optiunile de mai jos:', livrareMenu(lang));
      }
      order.data.livrare = value;

      const d = order.data;
      const notify = `🛒 COMANDA NOUA!\n\n📦 Produs: ${d.cod_produs}\n📏 Marime: ${d.marime} cm\n💰 Pret: ${d.pret} lei\n👤 Nume: ${d.nume}\n📞 Telefon: ${d.telefon}\n📍 Adresa: ${d.adresa}\n📮 Cod postal: ${d.cod_postal}\n🚚 Livrare: ${d.livrare}`;
      console.log('Comanda noua:', notify);

      // Notificare owner
      const ownerId = process.env.OWNER_CHAT_ID;
      if (ownerId) {
        const send = d.photo_id
          ? bot.sendPhoto(ownerId, d.photo_id, { caption: notify }).catch(() => bot.sendMessage(ownerId, notify))
          : bot.sendMessage(ownerId, notify);
        send.catch(e => console.error('notify err:', e.message));
      }

      // Scrie in Google Sheets
      if (SHEET_ID) {
        addComanda(d)
          .then(() => console.log('Comanda salvata in Sheets'))
          .catch(e => console.error('Sheets write err:', e.message));
      }

      delete userOrder[chatId];
      return bot.sendMessage(chatId,
        lang === 'ru'
          ? '✅ Comanda inregistrata! Te vom contacta in scurt timp pentru confirmare.'
          : '✅ Comanda inregistrata! Te vom contacta in scurt timp pentru confirmare.',
        mainMenu(lang));
    }
  }

  if (['❓ Intreaba Didi', '❓ Задать вопрос'].includes(cleanText)) {
    return bot.sendMessage(chatId,
      lang === 'ru' ? '💬 Напишите ваш вопрос и я отвечу!' : '💬 Scrie intrebarea ta si iti raspund!',
      { reply_markup: mainMenu(lang).reply_markup });
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
  if ((error.message || '').includes('409')) process.exit(1);
});

console.log('Didi Kids Bot pornit... v4');
