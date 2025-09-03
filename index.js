// index.js — Этап 1: Support Bot с логикой эскалации
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const http = require('http');

// === Настройки ===
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1m4-2_NOG_cqJn6XAHgsVfHZNC2MXMBRBgY8c6poOYAg/export?format=csv&gid=0";
const IO_API_KEY = process.env.IO_API_KEY;
const IO_ENDPOINT = "https://api.intelligence.io.solutions/api/v1/chat/completions";
const MODEL = "deepseek-ai/DeepSeek-R1-0528";

// === Глобальная база знаний ===
let kb = null;

// === Состояние активных чатов ===
let activeSessions = new Map(); // sessionId -> { stage, lastMessage, language, questionCount }

// === Ключевые слова для эскалации ===
const ESCALATION_KEYWORDS = {
  ru: [
    'оператор', 'живой человек', 'сотрудник', 'менеджер', 'специалист',
    'не помогает', 'не работает', 'не решается', 'проблема не решена',
    'переведите', 'соедините', 'хочу поговорить', 'нужна помощь человека',
    'срочно', 'жалоба', 'недоволен', 'плохо работает', 'баг', 'ошибка',
    'не понимаю', 'сложная проблема', 'индивидуальный случай', 'Задание не работает', 'в задании проблема', 'есть проблема', 'МИQ', 'новый учитель', 'внутренний учитель', 'отпуск', 'компьютера нет', 'компьютеров не хватает', 'компьютер не работает', 'компьютер неисправен', 'компьютер не пришёл', 'компьютер не был отправлен', 'компьютер не выдан', 'проектор не пришёл', 'проектор не выдан', 'проектора нет'
  ],
  az: [
    'operator', 'canlı insan', 'əməkdaş', 'menecer', 'mütəxəssis',
    'kömək etmir', 'işləmir', 'həll olunmur', 'problem həll olunmadı',
    'köçürün', 'birləşdirin', 'danışmaq istəyirəm', 'insanın köməyi lazımdır',
    'təcili', 'şikayət', 'narazıyam', 'pis işləyir', 'səhv', 'xəta',
    'başa düşmürəm', 'mürəkkəb problem', 'fərdi hal', 'Tapşırıq işləmir', 'tapşırıqda problem var', 'problem var', 'MİQ', 'yeni müəlli', 'daxili müəllim', 'məzuniyyət', 'kompüter yoxdur', 'kompüter çatışmır', 'kompüter işləmir', 'kompüter nasazdı', 'kompüter gəlməyib', 'kompüter göndərilməyib', 'kompüter verilməyib', 'proyektor gəlməyib', 'proyektor verilməyib', 'proyektor yoxdur'

  ],
  translit: [
    'operator', 'chelovek', 'sotrudnik', 'menedjer', 'specialist',
    'ne pomogaet', 'ne rabotaet', 'problema ne reshena',
    'perevedite', 'soedините', 'hochu govorit', 'nuzhna pomosh cheloveka',
    'srochno', 'zhaloba', 'nedovolen', 'plokho rabotaet'
  ]
};

// === Ключевые слова завершения ===
const COMPLETION_KEYWORDS = {
  ru: [
    'спасибо', 'спс', 'благодарю', 'все понятно', 'все ясно',
    'вопросов нет', 'больше вопросов нет', 'все хорошо', 'решено',
    'помогло', 'разобрался', 'разобралась', 'понял', 'поняла'
  ],
  az: [
    'təşəkkür', 'sağol', 'minnettaram', 'hamısı aydındır', 'hamısı başa düşülür',
    'sual yoxdur', 'daha sual yoxdur', 'hər şey yaxşıdır', 'həll olundu',
    'kömək etdi', 'başa düşdüm', 'anladım', 'çox sağ olun', 'çox sağ ol', 'sağ ol', 'sağ olun'
  ]
};

// === Транслит и синонимы (существующий код) ===
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
  'интернет': ['инет', 'сеть', 'подключение', 'коннект', 'связь']
};

// === Функции определения языка (существующий код) ===
function detectLanguage(text) {
  const ruCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const azSpecific = (text.match(/[əƏıİüğÜöÇşŞ]/g) || []).length;
  
  if (azSpecific > 0) return 'az';
  if (ruCount > 0) return 'ru';
  
  const converted = convertTranslit(text.toLowerCase());
  const ruCountAfter = (converted.match(/[а-яА-ЯёЁ]/g) || []).length;
  
  if (ruCountAfter > text.length * 0.3) {
    return 'ru_translit';
  }
  
  return 'az';
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

// === Новые функции для управления диалогом ===
function shouldEscalateToHuman(question, detectedLang) {
  const normalizedQuestion = question.toLowerCase();
  
  let keywordsToCheck = [];
  if (detectedLang === 'ru' || detectedLang === 'ru_translit') {
    keywordsToCheck = [...ESCALATION_KEYWORDS.ru, ...ESCALATION_KEYWORDS.translit];
  } else if (detectedLang === 'az') {
    keywordsToCheck = ESCALATION_KEYWORDS.az;
  }
  
  const foundKeywords = keywordsToCheck.filter(keyword => 
    normalizedQuestion.includes(keyword.toLowerCase())
  );
  
  if (foundKeywords.length > 0) {
    console.log(`🔄 Найдены ключевые слова для эскалации: ${foundKeywords.join(', ')}`);
    return true;
  }
  
  return false;
}

function shouldCompleteChat(question, detectedLang) {
  const normalizedQuestion = question.toLowerCase();
  
  let keywordsToCheck = [];
  if (detectedLang === 'ru' || detectedLang === 'ru_translit') {
    keywordsToCheck = COMPLETION_KEYWORDS.ru;
  } else if (detectedLang === 'az') {
    keywordsToCheck = COMPLETION_KEYWORDS.az;
  }
  
  return keywordsToCheck.some(keyword => 
    normalizedQuestion.includes(keyword.toLowerCase())
  );
}

function getGreeting(language) {
  if (language === 'az') {
    return "Salam! Mən Algo-bot, virtual köməkçiyəm. Sizə maksimal şəkildə kömək etməyə hazıram. Nə barədə məlumat almaq istərdiniz?";
  }
  return "Здравствуйте! Я Алго-бот, виртуальный помощник. Готов максимально помочь с вашими вопросами. О чем хотели бы узнать?";
}

function getFollowUpQuestion(language) {
  if (language === 'az') {
    return "\n\nBu mövzu ilə bağlı başqa sualınız varmı?";
  }
  return "\n\nОстались ли еще вопросы по этой теме?";
}

function getCompletionMessage(language) {
  if (language === 'az') {
    return "Əla! Sizə kömək edə bildiyimə şadam. Başqa sualla əlaqədər hər zaman müraciət edə bilərsiniz.";
  }
  return "Отлично! Рад, что смог помочь. По другим вопросам всегда можете обращаться.";
}

function getEscalationMessage(language) {
  if (language === 'az') {
    return "Sizi mütəxəssisə yönləndirirəm. Bir az gözləyin...";
  }
  return "Передаю вас специалисту. Один момент...";
}

// === Существующие функции поиска ===
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

// === Основная логика бота ===
async function askAI(question, kb, detectedLang, sessionId = null) {
  // Инициализация сессии если нужно
  if (sessionId && !activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, {
      stage: 'greeting',
      lastMessage: Date.now(),
      language: detectedLang,
      questionCount: 0
    });
    return {
      answer: getGreeting(detectedLang),
      sessionStage: 'greeting',
      needsEscalation: false
    };
  }

  // Получаем состояние сессии
  const session = sessionId ? activeSessions.get(sessionId) : null;
  if (session) {
    session.lastMessage = Date.now();
    session.questionCount++;
  }

  // Проверяем завершение диалога
  if (shouldCompleteChat(question, detectedLang)) {
    if (sessionId) activeSessions.delete(sessionId);
    return {
      answer: getCompletionMessage(detectedLang),
      sessionStage: 'completed',
      needsEscalation: false
    };
  }

  // Проверяем необходимость эскалации
  if (shouldEscalateToHuman(question, detectedLang)) {
    if (sessionId) {
      activeSessions.set(sessionId, { ...session, stage: 'escalated' });
    }
    return {
      answer: getEscalationMessage(detectedLang),
      sessionStage: 'escalated',
      needsEscalation: true,
      escalationReason: 'user_request'
    };
  }

  // Поиск ответа в базе знаний
  const filteredKB = filterKB(question, kb, detectedLang);
  
  if (filteredKB.length === 0) {
    // Нет подходящих ответов - предлагаем эскалацию
    const noAnswerMessage = detectedLang === 'az'
      ? "Təəssüf ki, bu suala cavab tapa bilmədim. Sizə mütəxəssis kömək edə bilər."
      : "К сожалению, не нашел ответ на этот вопрос. Вам поможет наш специалист.";
      
    if (sessionId) {
      activeSessions.set(sessionId, { ...session, stage: 'escalated' });
    }
    
    return {
      answer: noAnswerMessage + "\n\n" + getEscalationMessage(detectedLang),
      sessionStage: 'escalated',
      needsEscalation: true,
      escalationReason: 'no_answer',
      confidence: 0
    };
  }

  const answerLang = detectedLang === 'az' ? 'az' : 'ru';
  const exactQuestion = answerLang === 'ru' ? filteredKB[0].question_ru : filteredKB[0].question_az;
  const similarity = getSimilarity(question, exactQuestion, detectedLang, answerLang);
  
  // Высокое совпадение - даем прямой ответ
  if (similarity > 0.8) {
    const directAnswer = answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
    const fullAnswer = directAnswer + getFollowUpQuestion(detectedLang);
    
    if (sessionId) {
      activeSessions.set(sessionId, { ...session, stage: 'answered' });
    }
    
    return {
      answer: fullAnswer,
      sessionStage: 'answered',
      needsEscalation: false,
      confidence: similarity,
      source: 'direct_match'
    };
  }

  // Среднее совпадение - используем ИИ
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
- Do not include any thinking, reasoning or explanation tags.
- If the answer is long, return the full text.
- Do not shorten or summarize unless necessary.
`.trim();

  const userPrompt = `
Question: ${question}
Instructions:
- Provide a full, detailed, and natural-sounding answer in ${answerLang === 'ru' ? 'Russian' : 'Azerbaijani'}.
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
      const fallbackAnswer = answerLang === 'ru' ? filteredKB[0].answer_ru : filteredKB[0].answer_az;
      const fullAnswer = fallbackAnswer + getFollowUpQuestion(detectedLang);
      
      if (sessionId) {
        activeSessions.set(sessionId, { ...session, stage: 'answered' });
      }
      
      return {
        answer: fullAnswer,
        sessionStage: 'answered',
        needsEscalation: false,
        confidence: similarity,
        source: 'fallback'
      };
    }
    
    const fullAnswer = finalAnswer + getFollowUpQuestion(detectedLang);
    
    if (sessionId) {
      activeSessions.set(sessionId, { ...session, stage: 'answered' });
    }
    
    return {
      answer: fullAnswer,
      sessionStage: 'answered',
      needsEscalation: false,
      confidence: similarity,
      source: 'ai_processed'
    };
    
  } catch (error) {
    console.error("❌ Ошибка при запросе к ИИ:", error.message);
    const errorMessage = answerLang === 'ru' 
      ? "Произошла ошибка. Передаю вас специалисту."
      : "Xəta baş verdi. Sizi mütəxəssisə yönləndirirəm.";
    
    if (sessionId) {
      activeSessions.set(sessionId, { ...session, stage: 'escalated' });
    }
    
    return {
      answer: errorMessage,
      sessionStage: 'escalated',
      needsEscalation: true,
      escalationReason: 'technical_error',
      error: error.message
    };
  }
}

// === HTTP-сервер ===
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Главная страница
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>🤖 Support Bot API - Этап 1</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .status { color: green; font-weight: bold; }
          .endpoint { background: #f0f0f0; padding: 10px; margin: 10px 0; border-radius: 5px; }
          .new { background: #e8f4fd; border-left: 4px solid #007bff; }
        </style>
      </head>
      <body>
        <h1>🤖 Support Bot API - Этап 1</h1>
        <p class="status">Готов к работе с улучшенной логикой диалога!</p>
        
        <h2>Новые возможности:</h2>
        <ul>
          <li>✅ Приветствие пользователей</li>
          <li>✅ Управление сессиями диалога</li>
          <li>✅ Автоматическое определение эскалации</li>
          <li>✅ Завершение диалогов</li>
          <li>✅ Вопросы-уточнения после ответов</li>
        </ul>
        
        <h2>Доступные endpoints:</h2>
        <div class="endpoint">
          <strong>GET /health</strong> - проверка состояния системы
        </div>
        <div class="endpoint new">
          <strong>POST /chat</strong> - новый endpoint для диалогов с сессиями
        </div>
        <div class="endpoint">
          <strong>POST /ask</strong> - простой endpoint для разовых вопросов
        </div>
        
        <h2>Статус системы:</h2>
        <ul>
          <li>База знаний: ${kb ? `${kb.length} записей ✅` : 'не загружена ❌'}</li>
          <li>ИИ модель: ${IO_API_KEY ? 'настроена ✅' : 'НЕ настроена ❌'}</li>
          <li>Активных сессий: ${activeSessions.size}</li>
        </ul>
      </body>
      </html>
    `);
    return;
  }
  
  // Проверка состояния
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      version: 'stage1',
      kb_loaded: !!kb, 
      kb_records: kb ? kb.length : 0,
      active_sessions: activeSessions.size,
      ai_configured: !!IO_API_KEY,
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  // Новый endpoint для диалогов с сессиями
  if (req.url === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { question, sessionId } = JSON.parse(body);
        if (!question) throw new Error('No question provided');
        
        const detectedLang = detectLanguage(question);
        const result = await askAI(question, kb, detectedLang, sessionId);
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ 
          ...result, 
          language: detectedLang,
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  
  // Существующий endpoint для совместимости
  if (req.url === '/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body);
        if (!question) throw new Error('No question provided');
        
        const detectedLang = detectLanguage(question);
        const result = await askAI(question, kb, detectedLang);
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ 
          answer: result.answer,
          language: detectedLang,
          needsEscalation: result.needsEscalation,
          confidence: result.confidence,
          timestamp: new Date().toISOString()
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// === Очистка неактивных сессий ===
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000; // 10 минут
  
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastMessage > timeout) {
      console.log(`🧹 Удаляем неактивную сессию: ${sessionId}`);
      activeSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // проверяем каждые 5 минут

// === Запуск ===
(async () => {
  console.log("🚀 Загрузка базы знаний...");
  try {
    const res = await axios.get(SHEET_URL, { timeout: 10000 });
    console.log("📊 Получен CSV размером:", res.data.length, "символов");
    
    kb = parse(res.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }).map(r => ({
      id: r['id'] || '',
      question_ru: (r['Sual_ru'] || '').trim(),
      question_az: (r['Sual_az'] || '').trim(),
      answer_ru: (r['Cavab_ru'] || '').trim(),
      answer_az: (r['Cavab_az'] || '').trim(),
      project: (r['Project'] || '').trim()
    })).filter(r => (r.question_ru || r.question_az) && (r.answer_ru || r.answer_az));
    
    console.log(`✅ Загружено ${kb.length} записей`);
    
  } catch (error) {
    console.error("❌ Ошибка загрузки KB:", error.message);
  }

  const PORT = process.env.PORT || 10000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
    console.log(`🔗 Доступен по адресу: http://0.0.0.0:${PORT}`);
    console.log(`📋 Этап 1: Базовая логика диалога готова`);
    console.log(`   - Управление сессиями: включено`);
    console.log(`   - Автоэскалация: включена`);
    console.log(`   - ИИ модель: ${IO_API_KEY ? 'настроена' : 'НЕ настроена'}`);
  });
})();
