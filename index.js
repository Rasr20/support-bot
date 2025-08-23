// index.js — HTTP-сервер для Render + Omnidesk
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const http = require('http');

// === Настройки ===
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqhgkTa8_0nMhbIt5yKykCkB3F88hSR-w8dcQj8Z1wem-3zCA5GgDSAsQzhIbXIHEqIRzqdv-vA_OV/pub?gid=0&single=true&output=csv";
const IO_API_KEY = process.env.IO_API_KEY; // Берём из переменных окружения!
const IO_ENDPOINT = "https://api.intelligence.io.solutions/api/v1/chat/completions"; // Убраны лишние пробелы
const MODEL = "deepseek-ai/DeepSeek-R1-0528";

// === Глобальная база знаний ===
let kb = null;

// === Транслит и синонимы ===
const TRANSLIT_MAP = {
  'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д', 'e': 'е', 'yo': 'ё',
  'zh': 'ж', 'z': 'з', 'i': 'и', 'j': 'й', 'k': 'к', 'l': 'л', 'm': 'м',
  'n': 'н', 'o': 'о', 'p': 'п', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
  'f': 'ф', 'h': 'х', 'c': 'ц', 'ch': 'ч', 'sh': 'ш', 'sch': 'щ', 'y': 'ы',
  'yu': 'ю', 'ya': 'я', 'x': 'кс', 'w': 'в', 'q': 'к',
  'parol': 'пароль', 'password': 'пароль', 'pass': 'пароль',
  'internet': 'интернет', 'inet': 'интернет', 'net': 'сеть',
  'komputer': 'компьютер', 'komp': 'компьютер', 'computer': 'компьютер',
  'telefon': 'телефон', 'tel': 'телефон', 'phone': 'телефон',
  'pomoch': 'помощь', 'help': 'помощь', 'pomosh': 'помощь',
  'problema': 'проблема', 'problem': 'проблема',
  'vopros': 'вопрос', 'question': 'вопрос',
  'otvet': 'ответ', 'answer': 'ответ',
  'rabota': 'работа', 'work': 'работа', 'rabotat': 'работать',
  'ne rabotaet': 'не работает', 'ne pashet': 'не пашет',
  'moqu': 'могу', 'mogu': 'могу', 'mozhet': 'может',
  'nado': 'надо', 'nuzhno': 'нужно', 'need': 'нужно',
  'kak': 'как', 'how': 'как', 'gde': 'где', 'where': 'где',
  'kogda': 'когда', 'when': 'когда', 'pochemu': 'почему', 'why': 'почему',
  'chto': 'что', 'what': 'что', 'skolko': 'сколько',
  'izmenit': 'изменить', 'change': 'изменить', 'pomenyat': 'поменять',
  'dobavit': 'добавить', 'add': 'добавить', 'sozdat': 'создать',
  'udalit': 'удалить', 'delete': 'удалить', 'ubrat': 'убрать',
  'voiti': 'войти', 'login': 'войти', 'vhod': 'вход',
  'viyti': 'выйти', 'logout': 'выйти', 'vihod': 'выход',
  'registracia': 'регистрация', 'registration': 'регистрация',
  'dobriy den': 'добрый день', 'zdravstvuite': 'здравствуйте',
  'spasibo': 'спасибо', 'pozhalusta': 'пожалуйста'
};

const SYNONYMS = {
  'изменить': ['поменять', 'сменить', 'обновить', 'заменить', 'модифицировать', 'переделать'],
  'войти': ['зайти', 'авторизоваться', 'залогиниться', 'входить'],
  'создать': ['сделать', 'добавить', 'открыть', 'оформить'],
  'работает': ['пашет', 'функционирует', 'действует', 'идет'],
  'не работает': ['не пашет', 'сломался', 'глючит', 'виснет', 'тормозит', 'барахлит'],
  'пароль': ['код', 'ключ', 'пасс'],
  'интернет': ['инет', 'сеть', 'подключение', 'коннект', 'связь'],
  'dəyişmək': ['dəyişdirmək', 'yeniləmək', 'əvəz etmək'],
  'daxil olmaq': ['girmək', 'keçmək'],
  'yaratmaq': ['etmək', 'əlavə etmək', 'açmaq'],
  'işləyir': ['fəaliyyət göstərir', 'aktivdir'],
  'işləmir': ['xarabdır', 'problem var', 'bağlıdır'],
  'şifrə': ['parol', 'kod', 'açar'],
  'internet': ['şəbəkə', 'bağlantı', 'əlaqə']
};

// ✅ Исправленная функция определения языка
function detectLanguage(text) {
  const ruCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const azSpecific = (text.match(/[əƏıİüğÜöÇşŞ]/g) || []).length; // ✅ Правильные символы азербайджанского

  if (azSpecific > 0) return 'az';
  if (ruCount > 0) return 'ru';

  const converted = convertTranslit(text.toLowerCase());
  const ruCountAfter = (converted.match(/[а-яА-ЯёЁ]/g) || []).length;

  if (ruCountAfter > text.length * 0.3) {
    return 'ru_translit';
  }

  return 'az'; // по умолчанию — азербайджанский
}

function convertTranslit(text) {
  let converted = text.toLowerCase();
  const sortedKeys = Object.keys(TRANSLIT_MAP).sort((a, b) => b.length - a.length);
  sortedKeys.forEach(key => {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    converted = converted.replace(regex, TRANSLIT_MAP[key]);
  });
  return converted;
}

function normalizeText(text, lang) {
  let normalized = text.toLowerCase();
  if (lang === 'ru_translit') normalized = convertTranslit(normalized);
  
  const synonymDict = lang.startsWith('ru') 
    ? Object.entries(SYNONYMS).filter(([k]) => /[а-я]/.test(k))
    : Object.entries(SYNONYMS).filter(([k]) => /[a-z]/.test(k));
  
  synonymDict.forEach(([key, syns]) => {
    const allWords = [key, ...syns];
    allWords.forEach(word => {
      if (normalized.includes(word)) {
        normalized += ' ' + allWords.join(' ');
      }
    });
  });
  
  const stopWords = lang.startsWith('ru') 
    ? ['мой', 'моя', 'мое', 'наш', 'ваш', 'свой', 'это', 'эта']
    : ['menim', 'bizim', 'sizin', 'bu', 'o'];
  
  stopWords.forEach(word => {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  });
  
  return normalized
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort()
    .join(' ');
}

function getSimilarity(q1, q2, lang1, lang2) {
  const n1 = normalizeText(q1, lang1).split(' ');
  const n2 = normalizeText(q2, lang2).split(' ');
  if (n1.length === 0 || n2.length === 0) return 0;
  let matches = 0;
  n1.forEach(w1 => {
    n2.forEach(w2 => {
      if (w1 === w2) matches += 1.0;
      else if (w1.length >= 4 && w2.length >= 4) {
        let commonChars = 0;
        for (let i = 0; i < Math.min(w1.length, w2.length); i++) {
          if (w1[i] === w2[i]) commonChars++;
        }
        if (commonChars >= Math.min(w1.length, w2.length) * 0.7) matches += 0.5;
      }
    });
  });
  return matches / Math.max(n1.length, n2.length);
}

function filterKB(question, kb, detectedLang) {
  const lang = detectedLang === 'ru_translit' ? 'ru' : detectedLang;
  return kb
    .map(r => {
      const scoreRu = getSimilarity(question, r.question_ru, detectedLang, 'ru');
      const scoreAz = getSimilarity(question, r.question_az, detectedLang, 'az');
      return { ...r, semanticScore: Math.max(scoreRu, scoreAz) };
    })
    .filter(r => r.semanticScore > 0.15)
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 10);
}

function extractFinalAnswer(rawResponse) {
  let cleaned = rawResponse
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/Thinking:[\s\S]*?(?=Ответ:|Answer:|Final answer:|Q:|\[1\]|$)/gi, '')
    .replace(/Рассмотрим[\s\S]*?(?=Ответ:|Итак|$)/gi, '')
    .replace(/Давайте[\s\S]*?(?=Ответ:|Итак|$)/gi, '')
    .replace(/Let me (?:think|analyze|check)[\s\S]*?(?=Answer:|Ответ:|Based|$)/gi, '')
    .replace(/Analyzing[\s\S]*?(?=Answer:|Ответ:|The answer|$)/gi, '');
  cleaned = cleaned.replace(/^(Ответ|Answer|Final answer|Итак|So)[:\s-]*/i, '').trim();
  return cleaned || rawResponse.trim();
}

// ✅ Улучшенная функция askAI — язык ответа соответствует языку вопроса
async function askAI(question, kb, detectedLang) {
  const filteredKB = filterKB(question, kb, detectedLang);
  
  if (filteredKB.length === 0) {
    return detectedLang === 'az'
      ? "Təəssüf ki, uyğun cavab tapa bilmədim. Sualı yenidən formalaşdırmağa çalışın."
      : "К сожалению, я не нашел подходящий ответ. Попробуйте переформулировать вопрос.";
  }

  // 🔥 Определяем язык ответа: если az — отвечаем на az, иначе на ru
  const answerLang = detectedLang === 'az' ? 'az' : 'ru';

  // 🔍 Сначала ищем точный ответ на нужном языке
  const exactQuestion = answerLang === 'ru' ? filteredKB[0].question_ru : filteredKB[0].question_az;
  const similarity = getSimilarity(question, exactQuestion, detectedLang, answerLang);

  if (similarity > 0.8) {
    return answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
  }

  // 📚 Формируем контекст на нужном языке
  const kbText = filteredKB
    .slice(0, 5)
    .map((r, i) => {
      const q = answerLang === 'ru' ? r.question_ru : r.question_az;
      const a = answerLang === 'ru' ? r.answer_ru : r.answer_az;
      return `[${i+1}] Q: ${q}\nA: ${a}`;
    })
    .join('\n\n');

  const systemPrompt = `
You are a helpful support assistant. Your task is to provide a clear, complete, and natural-language answer based on the knowledge base.
- Use only the provided context.
- Answer strictly in ${answerLang === 'ru' ? 'Russian' : 'Azerbaijani'}.
- Do not include any thinking, reasoning or explanation tags like <think>, [thinking], etc.
- Do not say "Based on the information", "Thinking", etc.
- If the answer is long, return the full text.
- Do not shorten or summarize unless necessary.
`.trim();

  const userPrompt = `
Question: ${question}

Instructions:
- Provide a full, detailed, and natural-sounding answer in ${answerLang === 'ru' ? 'Russian' : 'Azerbaijani'}.
- Do not add disclaimers like 'Based on the information' or 'I think'.
- Just answer directly and completely.

Available context:
${kbText}
`.trim();

  try {
    const response = await axios.post(IO_ENDPOINT, {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 4096
    }, {
      headers: { 
        Authorization: `Bearer ${IO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const rawAnswer = response.data.choices[0].message.content;
    const finalAnswer = extractFinalAnswer(rawAnswer);
    
    if (!finalAnswer || finalAnswer.toLowerCase().includes("нет ответа")) {
      return answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
    }
    
    return finalAnswer;
    
  } catch (error) {
    console.error("❌ Ошибка при запросе к ИИ:", error.message);
    return answerLang === 'ru' 
      ? "Произошла ошибка. Попробуйте позже." 
      : "Xəta baş verdi. Sonra cəhd edin.";
  }
}

// === HTTP-сервер ===
const server = http.createServer(async (req, res) => {
  // ✅ Главная страница
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <h1>🤖 Support Bot API</h1>
      <p>Готов к работе!</p>
      <ul>
        <li><a href="/health">/health</a> — проверка состояния</li>
        <li><code>POST /ask</code> — получить ответ (JSON)</li>
      </ul>
    `);
    return;
  }

  // ✅ Проверка состояния
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', kb_loaded: !!kb }));
    return;
  }

  // ✅ Обработка вопроса
  if (req.url === '/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body);
        if (!question) throw new Error('No question');
        const detectedLang = detectLanguage(question);
        const answer = await askAI(question, kb, detectedLang);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answer, language: detectedLang }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ❌ Неизвестный маршрут
  res.writeHead(404);
  res.end('Not found');
});

// === Запуск ===
(async () => {
  console.log("🚀 Загрузка базы знаний...");
  try {
    const res = await axios.get(SHEET_URL, { timeout: 10000 });
    kb = parse(res.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }).map(r => ({
      id: r['id'] || '',
      question_ru: (r['Sual_ru'] || '').trim(),
      question_az: (r['Sual_az'] || '').trim(),
      answer_ru: (r['Cavab_ru'] || '').trim(),
      answer_az: (r['Cavab_az'] || '').trim()
    })).filter(r => (r.question_ru || r.question_az) && (r.answer_ru || r.answer_az));

    console.log(`✅ Загружено ${kb.length} записей`);
  } catch (error) {
    console.error("❌ Ошибка загрузки KB:", error.message);
  }

  const PORT = process.env.PORT || 10000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
  });
})();
