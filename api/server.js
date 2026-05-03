require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const https = require("https");

// ===========================
// MDN + NPM DOCS
// ===========================
const mdnCache = new Map();
const npmCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "node-dictionary-tool/1.0",
        "Accept": "application/json",
      }
    }, (res) => {
      // Seguir redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGetJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// Busca explicação do termo na MDN (pt-BR com fallback en-US)
async function fetchMdnTerm(term) {
  const cached = mdnCache.get(term);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const queries = [
    `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(term)}&locale=pt-BR&limit=3`,
    `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(term)}&locale=en-US&limit=3`,
  ];

  for (const url of queries) {
    try {
      const { status, body } = await httpsGetJSON(url);
      if (status !== 200 || !body?.documents?.length) continue;

      // Pega o resultado mais relevante (título mais próximo do termo)
      const docs = body.documents;
      const exact = docs.find(d => d.title?.toLowerCase() === term.toLowerCase()) || docs[0];

      const result = {
        titulo: exact.title || term,
        resumo: exact.summary || "Sem descrição disponível.",
        url: `https://developer.mozilla.org${exact.mdn_url}`,
        fonte: "MDN Web Docs",
      };

      mdnCache.set(term, { data: result, ts: Date.now() });
      return result;
    } catch {
      continue;
    }
  }

  return null;
}

// Busca dados do pacote no npm registry
async function fetchNpmPackage(pkg) {
  const cached = npmCache.get(pkg);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const { status, body } = await httpsGetJSON(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`
    );
    if (status !== 200 || !body) return null;

    const result = {
      name: body.name || pkg,
      version: body.version || "—",
      description: body.description || "Sem descrição disponível.",
      homepage: body.homepage || `https://www.npmjs.com/package/${pkg}`,
      keywords: Array.isArray(body.keywords) ? body.keywords.slice(0, 5) : [],
      license: body.license || "—",
    };
    npmCache.set(pkg, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// Extrai nomes de pacotes de require() e import
function extractPackageNames(code) {
  const found = new Set();
  for (const m of code.matchAll(/require\s*\(\s*['"]([^'".\/][^'"]*)['"]\s*\)/g)) {
    found.add(m[1].split("/")[0]);
  }
  for (const m of code.matchAll(/from\s+['"]([^'".\/][^'"]*)['"]/g)) {
    const pkg = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
    found.add(pkg);
  }
  return [...found];
}

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY || "";
const hasOpenAIKey = Boolean(apiKey);
const isOpenRouterKey = apiKey.startsWith("sk-or-v1");
const baseURL =
  process.env.OPENAI_BASE_URL ||
  (isOpenRouterKey ? "https://openrouter.ai/api/v1" : undefined);
const selectedModel =
  process.env.OPENAI_MODEL || (isOpenRouterKey ? "openai/gpt-4o-mini" : "gpt-4o-mini");

const openai = hasOpenAIKey ? new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null;

const chatHistoryBySession = new Map();
const MAX_HISTORY_ITEMS = 20;

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseTable = process.env.SUPABASE_CHAT_TABLE || "chat_messages";
const hasSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);
const supabase = hasSupabase ? createClient(supabaseUrl, supabaseServiceRoleKey) : null;

// ===========================
// DICIONÁRIO ESTÁTICO
// ===========================
const NODE_DICTIONARY = {
  const: { traducao: "constante", explicacao: "Declara um valor que não pode ser reatribuído." },
  let: { traducao: "variável mutável", explicacao: "Declara uma variável cujo valor pode mudar." },
  var: { traducao: "variável legada", explicacao: "Forma antiga de declarar variáveis em JavaScript." },
  function: { traducao: "função", explicacao: "Define um bloco reutilizável de código." },
  async: { traducao: "assíncrono", explicacao: "Indica que a função trabalha com operações assíncronas." },
  await: { traducao: "aguardar", explicacao: "Espera o resultado de uma Promise dentro de função async." },
  return: { traducao: "retorno", explicacao: "Envia um valor da função para quem chamou." },
  if: { traducao: "condição se", explicacao: "Executa um bloco quando a condição é verdadeira." },
  else: { traducao: "senão", explicacao: "Executa um bloco alternativo quando o if falha." },
  try: { traducao: "tentativa", explicacao: "Inicia bloco de tratamento de erro com catch." },
  catch: { traducao: "captura de erro", explicacao: "Recebe e trata erros lançados no bloco try." },
  throw: { traducao: "lançar erro", explicacao: "Interrompe o fluxo e gera um erro manualmente." },
  require: { traducao: "importação de módulo", explicacao: "Importa um módulo no padrão CommonJS." },
  module: { traducao: "módulo", explicacao: "Representa o arquivo/módulo atual no Node.js." },
  exports: { traducao: "exportações", explicacao: "Expõe funções e objetos para outros arquivos." },
  process: { traducao: "processo", explicacao: "Objeto global com informações do processo Node." },
  env: { traducao: "ambiente", explicacao: "Variáveis de ambiente acessadas por process.env." },
  express: { traducao: "framework web", explicacao: "Biblioteca para criar servidor HTTP e APIs." },
  app: { traducao: "aplicação", explicacao: "Instância principal da aplicação Express." },
  get: { traducao: "leitura HTTP", explicacao: "Método HTTP GET para consultar dados." },
  post: { traducao: "criação/envio", explicacao: "Método HTTP POST para enviar ou criar dados." },
  delete: { traducao: "remoção", explicacao: "Método HTTP DELETE para apagar dados." },
  json: { traducao: "formato JSON", explicacao: "Formato de dados estruturado em texto." },
  map: { traducao: "mapeamento", explicacao: "Transforma cada item de uma lista em outro valor." },
  filter: { traducao: "filtro", explicacao: "Filtra itens de um array com base em uma condição." },
  reduce: { traducao: "redução", explicacao: "Acumula valores de um array em um único resultado." },
  forEach: { traducao: "para cada", explicacao: "Itera sobre cada item de um array." },
  Promise: { traducao: "promessa", explicacao: "Representa o resultado futuro de uma operação assíncrona." },
  resolve: { traducao: "resolver", explicacao: "Completa uma Promise com sucesso." },
  reject: { traducao: "rejeitar", explicacao: "Completa uma Promise com erro." },
  null: { traducao: "nulo", explicacao: "Representa a ausência intencional de um valor." },
  undefined: { traducao: "indefinido", explicacao: "Valor padrão de variáveis não inicializadas." },
  true: { traducao: "verdadeiro", explicacao: "Valor booleano positivo." },
  false: { traducao: "falso", explicacao: "Valor booleano negativo." },
  new: { traducao: "novo", explicacao: "Instancia um objeto de uma classe ou função construtora." },
  class: { traducao: "classe", explicacao: "Define uma estrutura de dados com propriedades e métodos." },
};

const TERM_TRANSLATIONS = {
  get: "obter", set: "definir", create: "criar", update: "atualizar",
  delete: "excluir", remove: "remover", list: "listar", find: "buscar",
  fetch: "buscar", load: "carregar", save: "salvar", send: "enviar",
  parse: "interpretar", format: "formatar", render: "renderizar",
  build: "montar", validate: "validar", handle: "tratar", check: "verificar",
  init: "inicializar", start: "iniciar", stop: "parar", reset: "reiniciar",
  user: "usuário", users: "usuários", auth: "autenticação", token: "token",
  route: "rota", request: "requisição", response: "resposta", error: "erro",
  message: "mensagem", data: "dados", id: "id", name: "nome", email: "e-mail",
  password: "senha", history: "histórico", chat: "conversa", code: "código",
  server: "servidor", client: "cliente", port: "porta", host: "host",
  db: "banco de dados", table: "tabela", row: "linha", col: "coluna",
  key: "chave", value: "valor", result: "resultado", count: "contagem",
  index: "índice", item: "item", list: "lista", array: "arranjo",
  config: "configuração", env: "ambiente", log: "log", debug: "depuração",
};

const NATURAL_PHRASE_MAP = {
  "usuário nome": "nome do usuário",
  "usuário id": "id do usuário",
  "mensagem erro": "mensagem de erro",
  "dados resposta": "dados da resposta",
  "dados requisição": "dados da requisição",
};

const JS_RESERVED = new Set([
  "break", "case", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "let", "new", "null",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with", "yield", "async", "await", "catch",
]);

// ===========================
// MIDDLEWARE
// ===========================
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// ===========================
// HEALTH
// ===========================
app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    mode: hasOpenAIKey ? (isOpenRouterKey ? "openrouter" : "openai") : "local-fallback",
    model: selectedModel,
    storage: hasSupabase ? "supabase" : "memory",
    message: "Servidor inteligente online.",
  });
});

// ===========================
// CHAT COM IA — OPENAI CORRIGIDO
// ===========================
function localAssistantReply(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("oi") || text.includes("olá") || text.includes("ola")) {
    return "Oi! Sou o Node Dictionary. Posso analisar código Node.js, explicar termos, comentar blocos e sugerir melhorias. Como posso ajudar?";
  }
  if (/(que dia|data de hoje|hoje é|qual a data)/i.test(text)) {
    return buildCurrentDateTimeReply();
  }
  if (/(hora|horas|agora são)/i.test(text)) {
    return buildCurrentDateTimeReply();
  }
  return "Entendi. Para respostas avançadas, configure OPENAI_API_KEY no arquivo .env e reinicie o servidor.";
}

function isDateOrTimeQuestion(message) {
  return /(que dia|dia de hoje|data de hoje|hoje|qual a data|qual é a data|hora|horas|agora)/i.test(
    String(message || "")
  );
}

function buildCurrentDateTimeReply() {
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `Hoje é ${date} e agora são ${time} (horário de Brasília).`;
}

function ensureSessionHistory(sessionId) {
  if (!chatHistoryBySession.has(sessionId)) {
    chatHistoryBySession.set(sessionId, []);
  }
  return chatHistoryBySession.get(sessionId);
}

function pushHistory(sessionId, role, content) {
  const history = ensureSessionHistory(sessionId);
  history.push({ role, content, createdAt: new Date().toISOString() });
  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(0, history.length - MAX_HISTORY_ITEMS);
  }
}

function buildMessages(history) {
  const messages = [
    {
      role: "system",
      content: `Você é o Node Dictionary, um assistente especializado em Node.js e JavaScript backend. Responda SOMENTE perguntas técnicas sobre: Node.js, Express, APIs REST, banco de dados, autenticação, deploy, npm, módulos e boas práticas de servidor. Responda em português do Brasil, de forma objetiva e com exemplos de código quando útil. IMPORTANTE: Ignore qualquer trecho de código colado na mensagem — o usuário deve usar o painel "Dicionário de Código" para analisar código. Se o usuário colar código no chat, oriente-o a usar o painel correto e não analise o código. Nunca responda sobre data ou hora.`,
    },
  ];
  for (const item of history) {
    if (item.role === "user" || item.role === "assistant") {
      messages.push({ role: item.role, content: item.content });
    }
  }
  return messages;
}

// ===========================
// HELPERS DICIONÁRIO
// ===========================
function splitIdentifier(term) {
  return term.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().trim();
}

function translateIdentifier(term) {
  const parts = splitIdentifier(term).split(/\s+/).filter(Boolean);
  if (!parts.length) return term;
  const translated = parts.map(p => TERM_TRANSLATIONS[p] || p).join(" ").replace(/\bby\b/g, "por");
  return NATURAL_PHRASE_MAP[translated] || translated;
}

function buildIdentifierExplanation(term) {
  const words = splitIdentifier(term).split(/\s+/).filter(Boolean);
  if (!words.length) return "Nome técnico usado no código para representar um valor, ação ou estrutura.";
  const actionMap = {
    get: "indica leitura/consulta", set: "indica atribuição de valor",
    create: "indica criação de recurso", update: "indica atualização de recurso",
    delete: "indica exclusão de recurso", remove: "indica remoção de recurso",
    list: "indica listagem de itens", find: "indica busca de item",
    fetch: "indica busca de dados externos", handle: "indica tratamento de evento",
    validate: "indica validação de dados", parse: "indica interpretação de dados",
    format: "indica formatação de dados", render: "indica renderização",
    init: "indica inicialização", check: "indica verificação de condição",
  };
  const firstWord = words[0];
  if (actionMap[firstWord]) {
    return `Nome composto; o prefixo '${firstWord}' ${actionMap[firstWord]}.`;
  }
  return "Nome técnico usado no código para representar um valor, ação ou estrutura.";
}

function classifyTerm(term) {
  const n = term.toLowerCase();
  if (NODE_DICTIONARY[n]) return "node-js";
  if (JS_RESERVED.has(n)) return "palavra-reservada";
  return "identificador";
}

// Termos genéricos/ruído que não agregam valor ao dicionário
const NOISE_TERMS = new Set([
  "a","b","c","d","e","f","g","h","i","j","k","l","m",
  "n","o","p","q","r","s","t","u","v","w","x","y","z",
  "el","cb","fn","ok","io","fs","os","to","db",
  "res","req","err","msg","tmp","val","obj","arr","str","num",
  "idx","len","key","buf","arg","ctx","ref","row","col","doc",
  "next","done","item","data","body","text","name","type","code",
  "args","opts","info","list","rows","cols","keys","vals","docs",
  "true","false","null","undefined","NaN","Infinity",
  "console","log","warn","then","catch","finally",
  "push","pop","shift","splice","slice","join","split",
  "toString","valueOf","hasOwnProperty","prototype","constructor",
  "length","size","count","index","start","end","min","max",
  "Math","Date","JSON","Array","Object","String","Number","Boolean",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent",
]);

function extractCodeTerms(code, maxTerms = 600) {
  const matches = code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  const frequency = new Map();
  for (const term of matches) frequency.set(term, (frequency.get(term) || 0) + 1);

  const totalUnique = frequency.size;
  // frequência mínima dinâmica: código pequeno aceita freq>=1, médio >=2, grande >=3
  const minFreq = totalUnique < 30 ? 1 : totalUnique < 100 ? 2 : 3;

  return [...frequency.entries()]
    .map(([term, count]) => ({ term, count }))
    .filter(({ term, count }) => {
      const n = term.toLowerCase();
      if (NODE_DICTIONARY[n] || JS_RESERVED.has(n)) return true;
      if (NOISE_TERMS.has(term) || NOISE_TERMS.has(n)) return false;
      if (term.length <= 2) return false;
      return count >= minFreq;
    })
    .sort((a, b) => {
      const aKnown = NODE_DICTIONARY[a.term.toLowerCase()] ? 2 : JS_RESERVED.has(a.term.toLowerCase()) ? 1 : 0;
      const bKnown = NODE_DICTIONARY[b.term.toLowerCase()] ? 2 : JS_RESERVED.has(b.term.toLowerCase()) ? 1 : 0;
      if (bKnown !== aKnown) return bKnown - aKnown;
      return b.count - a.count;
    })
    .slice(0, maxTerms);
}

async function explainTerm({ term, count }) {
  const n = term.toLowerCase();
  const known = NODE_DICTIONARY[n];

  // Tenta buscar na MDN para termos JS/Node conhecidos e reservados
  let mdnData = null;
  const shouldFetchMDN = known || JS_RESERVED.has(n) || term.length >= 4;
  if (shouldFetchMDN) {
    mdnData = await fetchMdnTerm(term);
  }

  const explicacao = mdnData
    ? mdnData.resumo
    : known
      ? known.explicacao
      : buildIdentifierExplanation(term);

  return {
    termo: term,
    frequencia: count,
    categoria: classifyTerm(term),
    traducao: known ? known.traducao : translateIdentifier(term),
    explicacao,
    mdnUrl: mdnData ? mdnData.url : null,
    fonte: mdnData ? "MDN Web Docs" : "dicionário local",
  };
}

// ===========================
// ANÁLISE DE CÓDIGO
// ===========================
function buildLocalCodeAnalysis(code) {
  const lines = code.split(/\r?\n/).filter(l => l.trim().length > 0);
  const hasTryCatch = /try\s*\{[\s\S]*catch\s*\(/m.test(code);
  const hasAsyncAwait = /\basync\b/.test(code) || /\bawait\b/.test(code);
  const hasEnv = /process\.env/.test(code);
  const hasValidation = /\bif\s*\(|\bvalidate\w*/i.test(code);

  const pontosFortes = [];
  const riscos = [];
  const melhorias = [];

  if (hasAsyncAwait) pontosFortes.push("Usa async/await para operações assíncronas.");
  if (hasTryCatch) pontosFortes.push("Possui tratamento de erro com try/catch.");
  if (hasEnv) pontosFortes.push("Usa variáveis de ambiente para configuração.");
  if (pontosFortes.length === 0) pontosFortes.push("Código funcional identificado.");

  if (!hasTryCatch) riscos.push("Sem try/catch aparente — erros podem quebrar o fluxo.");
  if (!hasValidation) riscos.push("Validação de entrada não identificada no trecho.");
  if (lines.length > 80) riscos.push("Trecho extenso pode estar acumulando responsabilidades.");
  if (riscos.length === 0) riscos.push("Nenhum risco crítico identificado localmente.");

  melhorias.push("Separar funções por responsabilidade única (SRP).");
  melhorias.push("Adicionar logs estruturados para facilitar debug.");
  if (!hasValidation) melhorias.push("Incluir validação de payload antes de processar dados.");

  return {
    resumo: "Análise local sem IA externa. O trecho parece funcional, com oportunidades de robustez.",
    pontosFortes, riscos, melhorias,
    comentarioChat: "Analisei seu código. Quer que eu foque em performance, segurança ou organização?",
    perguntaInterativa: "O que você quer melhorar primeiro: segurança, performance ou legibilidade?",
  };
}

function parseJsonFromText(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callOpenAI(messages, maxTokens = 1200) {
  if (!openai) return null;
  const completion = await openai.chat.completions.create({
    model: selectedModel,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
  });
  return completion.choices?.[0]?.message?.content || "";
}

async function buildAICodeAnalysis(code) {
  if (!openai) return buildLocalCodeAnalysis(code);

  try {
    const text = await callOpenAI([
      {
        role: "system",
        content: "Você analisa código Node.js. Responda SOMENTE JSON válido, sem markdown, com as chaves: resumo (string), pontosFortes (array string), riscos (array string), melhorias (array string), comentarioChat (string), perguntaInterativa (string). Escreva em português do Brasil.",
      },
      { role: "user", content: `Analise o código:\n\n${code}` },
    ], 800);

    const parsed = parseJsonFromText(text);
    return {
      resumo: String(parsed.resumo || ""),
      pontosFortes: Array.isArray(parsed.pontosFortes) ? parsed.pontosFortes.map(String) : [],
      riscos: Array.isArray(parsed.riscos) ? parsed.riscos.map(String) : [],
      melhorias: Array.isArray(parsed.melhorias) ? parsed.melhorias.map(String) : [],
      comentarioChat: String(parsed.comentarioChat || ""),
      perguntaInterativa: String(parsed.perguntaInterativa || ""),
    };
  } catch {
    return buildLocalCodeAnalysis(code);
  }
}

function splitCodeInBlocks(code, linesPerBlock = 8, maxBlocks = 8) {
  const lines = String(code || "").split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += linesPerBlock) {
    if (blocks.length >= maxBlocks) break;
    const slice = lines.slice(i, i + linesPerBlock);
    if (!slice.join("").trim()) continue;
    blocks.push({ faixa: `${i + 1}-${Math.min(i + linesPerBlock, lines.length)}`, trecho: slice.join("\n") });
  }
  return blocks;
}

async function buildLineComments(code) {
  const fallbackBlocks = splitCodeInBlocks(code).map(block => ({
    faixa: block.faixa,
    comentario: "Bloco com lógica importante. Verifique validações, tratamento de erro e clareza de nomes.",
  }));

  if (!openai) return fallbackBlocks;

  try {
    const text = await callOpenAI([
      {
        role: "system",
        content: 'Você comenta código Node.js bloco a bloco. Responda SOMENTE JSON válido: {"comentarios":[{"faixa":"1-8","comentario":"..."}]}. Máximo 8 comentários. Em português do Brasil.',
      },
      { role: "user", content: `Comente por blocos:\n\n${code}` },
    ], 600);

    const parsed = parseJsonFromText(text);
    if (!Array.isArray(parsed.comentarios)) return fallbackBlocks;
    return parsed.comentarios.map(item => ({
      faixa: String(item.faixa || ""),
      comentario: String(item.comentario || ""),
    }));
  } catch {
    return fallbackBlocks;
  }
}

async function buildCodeImprovement(code) {
  const fallback = {
    codigoMelhorado: code,
    explicacao: "IA indisponível. Revise validações, try/catch e organização em funções menores.",
    melhoriasAplicadas: [
      "Sugestão: adicionar try/catch nos pontos críticos.",
      "Sugestão: validar entradas antes de processar.",
      "Sugestão: separar responsabilidades em funções.",
    ],
  };

  if (!openai) return fallback;

  try {
    const text = await callOpenAI([
      {
        role: "system",
        content: 'Você refatora código Node.js. Responda SOMENTE JSON válido: {"codigoMelhorado":"...","explicacao":"...","melhoriasAplicadas":["..."]}. Em português do Brasil.',
      },
      { role: "user", content: `Melhore este código:\n\n${code}` },
    ], 1200);

    const parsed = parseJsonFromText(text);
    return {
      codigoMelhorado: String(parsed.codigoMelhorado || code),
      explicacao: String(parsed.explicacao || ""),
      melhoriasAplicadas: Array.isArray(parsed.melhoriasAplicadas)
        ? parsed.melhoriasAplicadas.map(String)
        : [],
    };
  } catch {
    return fallback;
  }
}

// ===========================
// SUPABASE / HISTÓRICO
// ===========================
async function getHistory(sessionId) {
  if (!hasSupabase) return ensureSessionHistory(sessionId);
  const { data, error } = await supabase
    .from(supabaseTable)
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_ITEMS);
  if (error) throw new Error(`Supabase getHistory: ${error.message}`);
  return (data || []).map(item => ({ role: item.role, content: item.content, createdAt: item.created_at }));
}

async function addHistory(sessionId, role, content) {
  if (!hasSupabase) { pushHistory(sessionId, role, content); return; }
  const { error } = await supabase.from(supabaseTable).insert({ session_id: sessionId, role, content });
  if (error) throw new Error(`Supabase addHistory: ${error.message}`);
}

async function clearHistory(sessionId) {
  if (!hasSupabase) { chatHistoryBySession.set(sessionId, []); return; }
  const { error } = await supabase.from(supabaseTable).delete().eq("session_id", sessionId);
  if (error) throw new Error(`Supabase clearHistory: ${error.message}`);
}

// ===========================
// ROTAS
// ===========================
app.get("/api/history", async (req, res) => {
  const sessionId = String(req.query.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Envie sessionId." });
  try {
    const history = await getHistory(sessionId);
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao ler histórico.", details: err.message });
  }
});

app.delete("/api/history", async (req, res) => {
  const sessionId = String(req.query.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Envie sessionId." });
  try {
    await clearHistory(sessionId);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao limpar histórico.", details: err.message });
  }
});

app.post("/api/history/message", async (req, res) => {
  const { sessionId, role, content } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") return res.status(400).json({ error: "Envie sessionId." });
  if (!role || !["user", "assistant"].includes(role)) return res.status(400).json({ error: "Role inválido." });
  if (!content || typeof content !== "string") return res.status(400).json({ error: "Envie content." });
  try {
    await addHistory(sessionId, role, content);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Falha ao salvar mensagem.", details: err.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string") return res.status(400).json({ error: "Envie 'message'." });
  if (!sessionId || typeof sessionId !== "string") return res.status(400).json({ error: "Envie 'sessionId'." });

  try {
    if (!openai) {
      const reply = localAssistantReply(message);
      await addHistory(sessionId, "user", message);
      await addHistory(sessionId, "assistant", reply);
      return res.json({ reply, mode: "local-fallback" });
    }

    await addHistory(sessionId, "user", message);
    const history = await getHistory(sessionId);
    const reply = await callOpenAI(buildMessages(history), 1000);

    if (!reply) throw new Error("Resposta vazia da IA.");

    await addHistory(sessionId, "assistant", reply);
    return res.json({ reply, mode: isOpenRouterKey ? "openrouter" : "openai", model: selectedModel });
  } catch (err) {
    const isAuthError = err?.status === 401 || /incorrect api key|invalid api key|user not found/i.test(err.message || "");
    if (isAuthError) {
      const reply = "Chave de API recusada (401). Verifique OPENAI_API_KEY no .env e reinicie com npm run dev.";
      return res.json({ reply, mode: "local-fallback" });
    }
    console.error("[chat error]", err.message);
    return res.status(500).json({ error: "Falha ao gerar resposta.", details: err.message });
  }
});

// Busca dados de um pacote específico no npm registry
app.get("/api/npm/:pkg", async (req, res) => {
  const pkg = decodeURIComponent(req.params.pkg || "").trim();
  if (!pkg) return res.status(400).json({ error: "Informe o nome do pacote." });

  const data = await fetchNpmPackage(pkg);
  if (!data) return res.status(404).json({ error: `Pacote '${pkg}' não encontrado no npm.` });
  return res.json(data);
});

app.post("/api/dictionary", async (req, res) => {
  const { code, maxTerms } = req.body || {};
  if (!code || typeof code !== "string") return res.status(400).json({ error: "Envie 'code'." });

  const safeMax = Number.isFinite(Number(maxTerms)) && Number(maxTerms) > 0
    ? Math.min(Math.floor(Number(maxTerms)), 2000) : 600;

  const terms = extractCodeTerms(code, safeMax);

  // Busca MDN, análise IA e pacotes npm em paralelo
  const packageNames = extractPackageNames(code);
  const [entries, analise, npmPackagesRaw] = await Promise.all([
    Promise.all(terms.map(explainTerm)),
    buildAICodeAnalysis(code),
    Promise.all(packageNames.map(fetchNpmPackage)),
  ]);

  const npmPackages = npmPackagesRaw.filter(Boolean);

  return res.json({
    totalIdentificadores: (code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []).length,
    totalUnicos: terms.length,
    total: entries.length,
    entries,
    analise,
    npmPackages,
  });
});

app.post("/api/code/line-comments", async (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== "string") return res.status(400).json({ error: "Envie 'code'." });
  const comentarios = await buildLineComments(code);
  return res.json({ comentarios });
});

app.post("/api/code/improve", async (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== "string") return res.status(400).json({ error: "Envie 'code'." });
  const resultado = await buildCodeImprovement(code);
  return res.json(resultado);
});

// ===========================
// START
// ===========================
if (require.main === module) {
  app.listen(port, () => {
    console.log(`\n🚀 Node Dictionary rodando em http://localhost:${port}`);
    console.log(`   IA: ${hasOpenAIKey ? `${isOpenRouterKey ? "OpenRouter" : "OpenAI"} · ${selectedModel}` : "modo local (sem chave)"}`);
    console.log(`   Storage: ${hasSupabase ? "Supabase" : "memória"}\n`);
  });
}

module.exports = app;