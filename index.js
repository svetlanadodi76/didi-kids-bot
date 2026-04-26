const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const https = require('https');

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
        const fullDesc = String(row[1] || ''); // ex: "CH005 - Costum jeans miki mouse - 120"
        result.push({ marime, pret, fullDesc });
      }
    }
  }
  return result;
}

async function addComanda(data) {
  console.log('addComanda start, SHEET_ID:', SHEET_ID ? SHEET_ID.substring(0, 10) + '...' : 'LIPSA');
  const sheets = getSheetsClient();

  // Coloana D (Telefon) - nu are formule, doar numere reale de telefon
  const countRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Comenzi!D:D',
  });
  const filledRows = (countRes.data.values || []).filter(r => r[0] && String(r[0]).trim() !== '');
  const dataCount = filledRows.length - 1; // minus header "Telefon"
  const targetRow = dataCount + 2;
  const nr = dataCount + 1;
  console.log('addComanda: comenzi existente =', dataCount, '-> scriu pe randul', targetRow);

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;

  // Denumirea completa din Stoc pentru col F (trebuie sa corespunda dropdown-ului)
  const colF = data.stoc_full || `${data.cod_produs} - ${data.marime}`;

  // Scriem doar coloanele cu date manuale (A:I si M)
  // Sarim J, K, L, N, O, P, Q care au formule de calcul in sheet
  // Scriem si in Livrari!A nr comenzii ca sa se auto-completeze B (Client) din formula
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `Comenzi!A${targetRow}:I${targetRow}`,
          values: [[nr, dateStr, data.nume, data.telefon, data.adresa, colF, data.descriere_produs, 1, data.pret]],
        },
        {
          range: `Comenzi!M${targetRow}`,
          values: [[data.livrare]],
        },
        {
          range: `'Livrări'!A${targetRow}`,
          values: [[nr]],
        },
      ],
    },
  });
  console.log('addComanda scris pe randul:', targetRow);
}

async function updateStatusComanda(orderData, status) {
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Comenzi!A:P',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = res.data.values || [];

    // Cauta de jos in sus cel mai recent rand cu acelasi telefon+nume
    let targetRow = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][2] === orderData.nume && String(rows[i][3]) === String(orderData.telefon)) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      console.error('updateStatus: rand negasit pentru', orderData.nume, orderData.telefon);
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Comenzi!P${targetRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[status]] },
    });
    console.log('Status actualizat randul', targetRow, '->', status);
  } catch (e) {
    console.error('updateStatus err:', e.message);
  }
}
// ───────────────────────────────────────────────────────────────────────────────

const userLang = {};
const userHistory = {};
const userOrder = {};
const MAX_HISTORY = 6;
const pendingConfirmations = {};
let pendingCounter = 0;

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

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function extractCodeFromImage(fileId) {
  try {
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
    const mediaType = (file.file_path || '').toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const imgBuffer = await downloadBuffer(fileUrl);
    const base64 = imgBuffer.toString('base64');

    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Gaseste in imagine un cod de forma CHxxx unde xxx sunt exact 3 cifre (ex: CH005, CH001). Raspunde DOAR cu codul gasit sau NEGASIT.' },
        ],
      }],
    });

    const responseText = result.content[0].text.trim().toUpperCase();
    const match = responseText.match(/CH\d{3}/);
    return match ? match[0] : null;
  } catch (e) {
    console.error('Vision err:', e.message);
    return null;
  }
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
      keyboard: [
        [
          { text: lang === 'ru' ? '🛍 Как заказать' : '🛍 Cum sa comand' },
          { text: lang === 'ru' ? '❓ Задать вопрос' : '❓ Intreaba Didi' },
        ],
        [{ text: lang === 'ru' ? '📞 Contactati-ne' : '📞 Contactati-ne' }],
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
- Девочки: костюм деним Mickey Mouse 850 лей (110-160 см), костюм 2 предмета джинсы+майка 650 лей (80-120 см), платье серое с цветами 650 лей (110-160 см), платье бежевое с блёстками 650 лей (110-160 см), платье хлопок с медвежонком 590 лей (90-130 см), костюм деним розовый 650 лей (80-120 см), костюм Chanel 650 лей (90-130 см).
- Мальчики: костюм деним Louis Vuitton 3 предмета 850 лей (80-120 см), костюм 3 предмета брюки+майка+рубашка 650 лей (80-120 см).
- Доставка БЕСПЛАТНАЯ, 2-3 рабочих дня (почта или курьер).

ПРАВИЛА:
1. НЕ придумывай продукты или цены — только из каталога выше.
2. НЕ упоминай другие магазины или бренды.
3. Давай советы ТОЛЬКО по уходу за одеждой (стирка, глажка) по типу ткани.
4. Отвечай КОРОТКО: максимум 2-3 предложения.
5. Если клиент хочет заказать или купить — скажи ТОЛЬКО: "Нажми кнопку 🛍 Как заказать в меню, чтобы оформить заказ." Не задавай вопросов.
6. Если не знаешь ответа, скажи: "Не имею этой информации. Нажми 📞 Contactati-ne для связи с нами."
7. Оставайся на теме детской одежды — если спрашивают о другом, вежливо перенаправь.
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
5. Daca clientul vrea sa comande sau sa cumpere — spune DOAR: "Apasa butonul 🛍 Cum sa comand din meniu pentru a plasa comanda." Nu pune intrebari.
6. Daca nu stii raspunsul, spune: "Nu am aceasta informatie. Apasa 📞 Contactati-ne pentru a ne contacta direct."
7. Ramai pe tema hainelor de copii — daca clientul intreaba altceva, redirectioneaza politicos.
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

  if (['📞 Contactati-ne'].includes(cleanText)) {
    const phone = process.env.OWNER_PHONE || '';
    const contactMsg = phone
      ? `📞 Ne puteti contacta:\n📱 Telefon/WhatsApp: ${phone}\n💬 Telegram: @didikidsmd\n🕐 Luni-Vineri: 9:00-18:00`
      : `📞 Ne puteti contacta:\n💬 Telegram: @didikidsmd\n🕐 Luni-Vineri: 9:00-18:00`;
    return bot.sendMessage(chatId, contactMsg, mainMenu(lang));
  }

  if (['🛍 Cum sa comand', '🛍 Как заказать'].includes(cleanText)) {
    if (isGroup(msg)) {
      const botUser = process.env.BOT_USERNAME || '';
      const opts = {
        reply_to_message_id: msg.message_id,
        ...(botUser ? { reply_markup: { inline_keyboard: [[{ text: '💬 Deschide chat privat', url: `https://t.me/${botUser}?start=start` }]] } } : {}),
      };
      return bot.sendMessage(chatId,
        lang === 'ru'
          ? `🛍 Comenzile se plaseaza in mesaj privat${botUser ? ` cu @${botUser}` : '.'}`
          : `🛍 Comenzile se plaseaza in mesaj privat${botUser ? ` cu @${botUser}` : '.'}`,
        opts);
    }
    userOrder[chatId] = { step: 0, data: {} };
    return bot.sendMessage(chatId,
      lang === 'ru'
        ? '🛍 Incepem inregistrarea comenzii!\n\nTrimite poza produsului dorit cu codul produsului (ex: CH005) in descriere.'
        : '🛍 Incepem inregistrarea comenzii!\n\nTrimite poza produsului dorit cu codul produsului (ex: CH005) in descriere.',
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
      // Sub-pas: asteapta codul dupa ce poza a fost trimisa fara cod in caption
      if (order.waiting_code) {
        const inputText = (msg.text || msg.caption || '').trim();
        const rawMatch = inputText.match(/CH[\s\-]?\d{3}/i);
        if (!rawMatch) {
          return bot.sendMessage(chatId,
            lang === 'ru'
              ? 'Scrie codul produsului din canalul @didikidsmd (ex: CH005):'
              : 'Scrie codul produsului din canalul @didikidsmd (ex: CH005):',
            cancelKb);
        }
        order.data.cod_produs = rawMatch[0].replace(/[\s\-]/g, '').toUpperCase();
        if (!order.data.descriere_produs) order.data.descriere_produs = order.data.cod_produs;
        delete order.waiting_code;
      } else {
        if (!msg.photo) {
          return bot.sendMessage(chatId,
            lang === 'ru'
              ? 'Trimite poza produsului dorit cu codul produsului (ex: CH005) in descriere.'
              : 'Trimite poza produsului dorit cu codul produsului (ex: CH005) in descriere.',
            cancelKb);
        }

        const caption = msg.caption || '';
        console.log('Step0 caption:', JSON.stringify(caption));
        order.data.photo_id = msg.photo[msg.photo.length - 1].file_id;
        order.data.descriere_produs = caption.split('\n')[0] || '';
        const rawMatch = caption.match(/CH[\s\-]?\d{3}/i);

        if (!rawMatch) {
          await bot.sendChatAction(chatId, 'typing');
          const visionCode = await extractCodeFromImage(order.data.photo_id);
          if (visionCode) {
            order.data.cod_produs = visionCode;
            if (!order.data.descriere_produs) order.data.descriere_produs = visionCode;
          } else {
            order.waiting_code = true;
            return bot.sendMessage(chatId,
              lang === 'ru'
                ? '📦 Poza primita!\n\nAcum scrie codul produsului din canalul @didikidsmd (ex: CH005):'
                : '📦 Poza primita!\n\nAcum scrie codul produsului din canalul @didikidsmd (ex: CH005):',
              cancelKb);
          }
        } else {
          order.data.cod_produs = rawMatch[0].replace(/[\s\-]/g, '').toUpperCase();
          if (!order.data.descriere_produs) order.data.descriere_produs = order.data.cod_produs;
        }
      }

      const codProdus = order.data.cod_produs;
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
      order.data.stoc_full = selected.fullDesc; // denumirea completa din Stoc pentru col F
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

      // Notificare owner cu butoane confirmare
      const ownerId = process.env.OWNER_CHAT_ID;
      if (ownerId) {
        const pendingKey = String(++pendingCounter);
        pendingConfirmations[pendingKey] = { clientChatId: chatId, clientLang: lang, orderData: { ...d } };

        const confirmKb = {
          inline_keyboard: [[
            { text: '✅ Confirma comanda', callback_data: `conf_${pendingKey}` },
            { text: '❌ Anuleaza', callback_data: `canc_${pendingKey}` },
          ]],
        };

        const send = d.photo_id
          ? bot.sendPhoto(ownerId, d.photo_id, { caption: notify, reply_markup: confirmKb })
              .catch(() => bot.sendMessage(ownerId, notify, { reply_markup: confirmKb }))
          : bot.sendMessage(ownerId, notify, { reply_markup: confirmKb });
        send.catch(e => console.error('notify err:', e.message));
      }

      // Scrie in Google Sheets
      if (SHEET_ID) {
        addComanda(d)
          .then(() => console.log('✅ Comanda salvata in Sheets'))
          .catch(e => console.error('❌ Sheets write err:', e.message, e.stack));
      } else {
        console.error('❌ GOOGLE_SHEET_ID lipsa din env');
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

  // Detectie intentie comandă — redirectionare directa fara AI
  const msgLower = (cleanText || text).toLowerCase();
  const orderIntent = [
    'vreau sa comand', 'vreau să comand', 'cum comand', 'cum se comanda',
    'doresc sa comand', 'pot comanda', 'as vrea sa comand',
    'хочу заказать', 'как заказать', 'хочу купить', 'хочу сделать заказ',
  ].some(k => msgLower.includes(k));
  if (orderIntent) {
    return bot.sendMessage(chatId,
      updatedLang === 'ru'
        ? '🛍 Pentru a plasa o comandă, apasă butonul de mai jos 👇'
        : '🛍 Pentru a plasa o comandă, apasă butonul de mai jos 👇',
      { reply_markup: { keyboard: [[{ text: updatedLang === 'ru' ? '🛍 Как заказать' : '🛍 Cum sa comand' }]], resize_keyboard: true } });
  }

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

bot.on('callback_query', async (query) => {
  const data = query.data || '';
  if (!data.startsWith('conf_') && !data.startsWith('canc_')) return;

  const key = data.replace(/^(conf_|canc_)/, '');
  const pending = pendingConfirmations[key];

  if (!pending) {
    return bot.answerCallbackQuery(query.id, { text: 'Comanda nu mai este disponibila.' });
  }

  const { clientChatId, clientLang: cLang, orderData: d } = pending;
  delete pendingConfirmations[key];

  // Sterge butoanele din mesajul owner
  bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
  }).catch(() => {});

  if (data.startsWith('conf_')) {
    const isPosta = d.livrare.includes('posta');

    const clientMsg = cLang === 'ru'
      ? `✅ Ваш заказ подтверждён!\n\n📦 Товар: ${d.cod_produs} — ${d.marime} cm\n💰 Цена: ${d.pret} lei\n\n🚚 Заказ будет доставлен завтра ${isPosta ? 'по Почте' : 'Курьером'}.\n${isPosta
        ? '📮 При получении SMS-уведомления, пожалуйста, подойдите на почту для получения посылки.'
        : '🏃 Пожалуйста, будьте доступны по телефону для получения посылки.'}\n\nХорошего вам дня! 🌸`
      : `✅ Comanda Dvs. este confirmată!\n\n📦 Produs: ${d.cod_produs} — ${d.marime} cm\n💰 Preț: ${d.pret} lei\n\n🚚 Comanda va fi transmisă mâine ${isPosta ? 'prin Poștă' : 'prin Curier'}.\n${isPosta
        ? '📮 La primirea notificării SMS pe telefon, vă rugăm să vă apropiați la oficiul poștal pentru ridicarea coletului.'
        : '🏃 Vă rugăm să fiți disponibil/ă la telefon pentru preluarea coletului.'}\n\nO zi frumoasă vă dorim în continuare! 🌸`;

    bot.sendMessage(clientChatId, clientMsg, mainMenu(cLang))
      .catch(e => console.error('confirm send err:', e.message));
    bot.answerCallbackQuery(query.id, { text: '✅ Confirmat! Clientul a fost notificat.' });

  } else {
    const cancelMsg = cLang === 'ru'
      ? '❌ Ne pare rău, comanda Dvs. a fost anulată. Contactați-ne pentru detalii.'
      : '❌ Ne pare rău, comanda Dvs. a fost anulată. Contactați-ne pentru detalii.';

    bot.sendMessage(clientChatId, cancelMsg, mainMenu(cLang))
      .catch(e => console.error('cancel send err:', e.message));

    if (SHEET_ID) updateStatusComanda(d, 'Anulată');

    bot.answerCallbackQuery(query.id, { text: '❌ Comanda anulata.' });
  }
});

bot.on('polling_error', (error) => {
  if ((error.message || '').includes('409')) process.exit(1);
});

console.log('Didi Kids Bot pornit... v18');
