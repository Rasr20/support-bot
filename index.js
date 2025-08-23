// Установите зависимости:
// npm install axios csv-parse

const axios = require('axios');
const { parse } = require('csv-parse/sync');
const readline = require('readline');

// === Настройки ===
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqhgkTa8_0nMhbIt5yKykCkB3F88hSR-w8dcQj8Z1wem-3zCA5GgDSAsQzhIbXIHEqIRzqdv-vA_OV/pub?gid=0&single=true&output=csv";
const IO_API_KEY = process.env.IO_API_KEY;
const IO_ENDPOINT = "https://api.intelligence.io.solutions/api/v1/chat/completions";
const MODEL = "deepseek-ai/DeepSeek-R1-0528";

// === Простой кэш в памяти ===
const cache = new Map();
const CACHE_TTL = 3600000; // 1 час в миллисекундах

// === Транслит маппинг ===
const TRANSLIT_MAP = {
  // Русский → Латиница
  'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д', 'e': 'е', 'yo': 'ё',
  'zh': 'ж', 'z': 'з', 'i': 'и', 'j': 'й', 'k': 'к', 'l': 'л', 'm': 'м',
  'n': 'н', 'o': 'о', 'p': 'п', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
  'f': 'ф', 'h': 'х', 'c': 'ц', 'ch': 'ч', 'sh': 'ш', 'sch': 'щ', 'y': 'ы',
  'yu': 'ю', 'ya': 'я', 'x': 'кс', 'w': 'в', 'q': 'к',
  
  // Распространенные варианты
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

// === Синонимы для обоих языков ===
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

// === Загрузка базы знаний ===
async function loadKB() {
  try {
    const res = await axios.get(SHEET_URL, { timeout: 10000 });
    const records = parse(res.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax: true
    });

    const kb = records.map(r => ({
      id: r['id'] || '',
      question_ru: (r['Sual_ru'] || '').trim(),
      question_az: (r['Sual_az'] || '').trim(),
      answer_ru: (r['Cavab_ru'] || '').trim(),
      answer_az: (r['Cavab_az'] || '').trim()
    })).filter(r => 
      (r.question_ru || r.question_az) && (r.answer_ru || r.answer_az)
    );

    console.log(`✅ Загружено ${kb.length} записей из базы`);
    return kb;
  } catch (error) {
    console.error("❌ Ошибка загрузки базы:", error.message);
    process.exit(1);
  }
}

// === Конвертация транслита в кириллицу ===
function convertTranslit(text) {
  let converted = text.toLowerCase();
  
  const sortedKeys = Object.keys(TRANSLIT_MAP).sort((a, b) => b.length - a.length);
  
  sortedKeys.forEach(key => {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    converted = converted.replace(regex, TRANSLIT_MAP[key]);
  });
  
  return converted;
}

// === Определение языка с учетом транслита ===
function detectLanguage(text) {
  const ruCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const azSpecific = (text.match(/[əƏıİğĞüÜöÖçÇşŞ]/g) || []).length;
  
  if (azSpecific > 0) return 'az';
  if (ruCount > 0) return 'ru';
  
  const converted = convertTranslit(text);
  const ruCountAfter = (converted.match(/[а-яА-ЯёЁ]/g) || []).length;
  
  if (ruCountAfter > text.length * 0.3) {
    return 'ru_translit';
  }
  
  return 'az';
}

// === Нормализация текста ===
function normalizeText(text, lang) {
  let normalized = text.toLowerCase();
  
  if (lang === 'ru_translit') {
    normalized = convertTranslit(normalized);
  }
  
  const synonymDict = lang.startsWith('ru') ? 
    Object.entries(SYNONYMS).filter(([k]) => /[а-я]/.test(k)) :
    Object.entries(SYNONYMS).filter(([k]) => /[a-z]/.test(k));
  
  synonymDict.forEach(([key, syns]) => {
    const allWords = [key, ...syns];
    allWords.forEach(word => {
      if (normalized.includes(word)) {
        normalized += ' ' + allWords.join(' ');
      }
    });
  });
  
  const stopWords = lang.startsWith('ru') ? 
    ['мой', 'моя', 'мое', 'наш', 'ваш', 'свой', 'это', 'эта'] :
    ['menim', 'bizim', 'sizin', 'bu', 'o'];
  
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

// === Сравнение текстов ===
function getSimilarity(q1, q2, lang1, lang2) {
  const n1 = normalizeText(q1, lang1).split(' ');
  const n2 = normalizeText(q2, lang2).split(' ');
  
  if (n1.length === 0 || n2.length === 0) return 0;
  
  let matches = 0;
  n1.forEach(w1 => {
    n2.forEach(w2 => {
      if (w1 === w2) {
        matches += 1.0;
      } else if (w1.length >= 4 && w2.length >= 4) {
        let commonChars = 0;
        for (let i = 0; i < Math.min(w1.length, w2.length); i++) {
          if (w1[i] === w2[i]) commonChars++;
        }
        if (commonChars >= Math.min(w1.length, w2.length) * 0.7) {
          matches += 0.5;
        }
      }
    });
  });
  
  return matches / Math.max(n1.length, n2.length);
}

// === Фильтрация базы знаний ===
function filterKB(question, kb, detectedLang) {
  const cacheKey = `${detectedLang}:${question.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.timestamp > Date.now() - CACHE_TTL) {
    return cached.data;
  }
  
  const lang = detectedLang === 'ru_translit' ? 'ru' : detectedLang;
  
  const results = kb
    .map(r => {
      const scoreRu = getSimilarity(question, r.question_ru, detectedLang, 'ru');
      const scoreAz = getSimilarity(question, r.question_az, detectedLang, 'az');
      
      return {
        ...r,
        semanticScore: Math.max(scoreRu, scoreAz),
        matchedLang: scoreRu > scoreAz ? 'ru' : 'az'
      };
    })
    .filter(r => r.semanticScore > 0.15)
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 10);
  
  cache.set(cacheKey, { data: results, timestamp: Date.now() });
  
  return results;
}

// === Извлечение чистого ответа (обновлённая версия) ===
function extractFinalAnswer(rawResponse) {
  let cleaned = rawResponse;

  // Удаление всех возможных форм размышлений
  cleaned = cleaned
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/Thinking:[\s\S]*?(?=Ответ:|Answer:|Final answer:|Q:|\[1\]|$)/gi, '')
    .replace(/Рассмотрим[\s\S]*?(?=Ответ:|Итак|$)/gi, '')
    .replace(/Давайте[\s\S]*?(?=Ответ:|Итак|$)/gi, '')
    .replace(/Let me (?:think|analyze|check)[\s\S]*?(?=Answer:|Ответ:|Based|$)/gi, '')
    .replace(/Analyzing[\s\S]*?(?=Answer:|Ответ:|The answer|$)/gi, '');

  // Удаление префиксов ответа
  cleaned = cleaned.replace(/^(Ответ|Answer|Final answer|Итак|So)[:\s-]*/i, '').trim();

  // Финальная очистка от лишних пробелов
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .trim();

  return cleaned || rawResponse.trim();
}

// === Запрос к ИИ ===
async function askAI(question, kb, detectedLang) {
  const filteredKB = filterKB(question, kb, detectedLang);
  
  if (filteredKB.length === 0) {
    return detectedLang.startsWith('ru') ? 
      "К сожалению, я не нашел подходящий ответ. Попробуйте переформулировать вопрос." :
      "Təəssüf ki, uyğun cavab tapa bilmədim. Sualı yenidən formalaşdırmağa çalışın.";
  }

  const answerLang = filteredKB[0].matchedLang || (detectedLang.startsWith('ru') ? 'ru' : 'az');
  
  if (filteredKB[0].semanticScore > 0.8) {
    return answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
  }

  const kbText = filteredKB.slice(0, 5).map((r, i) => {
    const q = answerLang === 'ru' ? r.question_ru : r.question_az;
    const a = answerLang === 'ru' ? r.answer_ru : r.answer_az;
    return `[${i+1}] Q: ${q}\nA: ${a}`;
  }).join('\n\n');

  // Обновлённые промпты без требования думать вслух
  const systemPrompt = `
You are a helpful support assistant. Your task is to provide a clear, complete, and natural-language answer based on the knowledge base.
- Use only the provided context.
- Answer in the same language as the question.
- Do not include any thinking, reasoning or explanation tags like <think>, [thinking], etc.
- Do not say "Based on the information", "Thinking", etc.
- If the answer is long, return the full text.
- Do not shorten or summarize unless necessary.
`.trim();

  const userPrompt = `
Question: ${question}
Target language: ${answerLang === 'ru' ? 'Russian' : 'Azerbaijani'}

Instructions:
- Provide a full, detailed, and natural-sounding answer based on the knowledge base.
- Do not shorten or summarize unless the information is very brief.
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
      max_tokens: 4096,
      timeout: 30000
    }, {
      headers: {
        Authorization: `Bearer ${IO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const rawAnswer = response.data.choices[0].message.content;
    const finalAnswer = extractFinalAnswer(rawAnswer);
    
    if (!finalAnswer || finalAnswer.toLowerCase() === "нет ответа") {
      if (filteredKB[0].semanticScore > 0.5) {
        return answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
      }
      return answerLang === 'ru' ? 
        "Не удалось найти точный ответ." :
        "Dəqiq cavab tapılmadı.";
    }
    
    return finalAnswer;
    
  } catch (error) {
    if (filteredKB[0]?.semanticScore > 0.4) {
      return answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
    }
    
    return answerLang === 'ru' ? 
      "Произошла ошибка. Попробуйте позже." :
      "Xəta baş verdi. Sonra cəhd edin.";
  }
}

// === Главная функция ===
(async () => {
  console.log("🤖 Интеллектуальный бот поддержки v3.2");
  console.log("🌐 Поддержка: Русский, Азербайджанский, Транслит");
  console.log("🔄 Загрузка базы знаний...");
  
  const kb = await loadKB();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });

  console.log("\n✅ Система готова к работе!");
  console.log("💬 Можете писать на русском, азербайджанском или транслитом");
  console.log("🚪 Для выхода введите: exit\n");
  
  rl.prompt();
  
  rl.on('line', async (input) => {
    const question = input.trim();
    
    if (!question) {
      rl.prompt();
      return;
    }
    
    if (question.toLowerCase() === 'exit' || 
        question.toLowerCase() === 'выход' || 
        question.toLowerCase() === 'çıxış') {
      console.log("\n👋 До свидания! / Sağ olun!");
      rl.close();
      return;
    }

    const detectedLang = detectLanguage(question);
    const langDisplay = {
      'ru': '🇷🇺 Русский',
      'ru_translit': '🔤 Транслит→Русский',
      'az': '🇦🇿 Azərbaycan'
    };
    
    console.log(`\n${langDisplay[detectedLang] || '🌐 Язык'}`);
    console.log("🔍 Анализирую запрос...");
    
    const startTime = Date.now();
    const answer = await askAI(question, kb, detectedLang);
    const elapsed = Date.now() - startTime;
    
    console.log("\n💬 ОТВЕТ:");
    console.log("─".repeat(50));
    console.log(answer);
    console.log("─".repeat(50));
    console.log(`⏱️ ${elapsed}мс\n`);
    
    rl.prompt();
  });

  rl.on('close', () => {
    console.log("\n✨ Сессия завершена");
    process.exit(0);
  });
})();
