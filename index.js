const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ești asistentul magazinului Didi Kids MD, un magazin de haine pentru copii din Moldova. 
Răspunzi la întrebări despre produse, prețuri, mărimi și livrare.
Fii prietenos, scurt și util.
Dacă nu știi răspunsul exact, spune că vei verifica și reveni cu informații.
Livrarea se face în toată Moldova.`;

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) {
    bot.sendMessage(chatId, 'Bună! Cum vă pot ajuta? Scrieți întrebarea dvs. 😊');
    return;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    bot.sendMessage(chatId, response.content[0].text);
  } catch (error) {
    bot.sendMessage(chatId, 'Îmi pare rău, a apărut o eroare. Vă rugăm să încercați din nou.');
  }
});

console.log('Bot pornit...');
