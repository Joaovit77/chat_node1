// ===========================
// ELEMENTOS DO DOM
// ===========================
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");
const chatTabsEl = document.getElementById("chatTabs");
const menuBtn = document.getElementById("menuBtn");
const sidebarEl = document.getElementById("sidebar");
const backdropEl = document.getElementById("backdrop");
const codeBoxEl = document.getElementById("codeBox");
const maxTermsEl = document.getElementById("maxTerms");
const translateCodeBtn = document.getElementById("translateCode");
const lineCommentBtn = document.getElementById("lineCommentBtn");
const improveCodeBtn = document.getElementById("improveCodeBtn");
const dictionaryEl = document.getElementById("dictionary");
const codeAnalysisEl = document.getElementById("codeAnalysis");
const typingEl = document.getElementById("typingIndicator");
const dictLoadingEl = document.getElementById("dictLoading");
const toastEl = document.getElementById("toast");
const statusTextEl = document.getElementById("statusText");
const statusDotEl = document.getElementById("statusDot");
const statusDotDesktopEl = document.getElementById("statusDotDesktop");
const clearCodeBtn = document.getElementById("clearCodeBtn");
const storageInfoEl = document.getElementById("storageInfo");
const mobileSwitchChatBtn = document.getElementById("mobileSwitchChat");
const mobileSwitchDictBtn = document.getElementById("mobileSwitchDict");
const panelChatEl = document.querySelector(".panel-chat");
const panelDictEl = document.querySelector(".panel-dict");

// ===========================
// CONSTANTES E ESTADO
// ===========================
const TABS_KEY = "nd_chat_tabs";
const ACTIVE_TAB_KEY = "nd_active_tab";
let chatTabs = [];
let sessionId = "";
let isLoading = false;

// ===========================
// TOAST
// ===========================
let toastTimer;
function showToast(msg, type = "info", duration = 3000) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = `toast ${type} show`;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, duration);
}

// ===========================
// STATUS
// ===========================
function setStatus(text, state = "offline") {
  if (statusTextEl) statusTextEl.textContent = text;
  [statusDotEl, statusDotDesktopEl].forEach(el => {
    if (el) {
      el.className = `status-dot ${state}`;
      el.title = text;
    }
  });
}

// ===========================
// GERENCIAR ABAS
// ===========================
function createDefaultTab() {
  return { id: crypto.randomUUID(), name: "Geral" };
}

function loadTabs() {
  try {
    chatTabs = JSON.parse(localStorage.getItem(TABS_KEY) || "[]");
  } catch {
    chatTabs = [];
  }
  if (!Array.isArray(chatTabs) || !chatTabs.length) {
    chatTabs = [createDefaultTab()];
  }
  let activeId = localStorage.getItem(ACTIVE_TAB_KEY);
  if (!activeId || !chatTabs.some(t => t.id === activeId)) {
    activeId = chatTabs[0].id;
  }
  sessionId = activeId;
  saveTabs();
}

function saveTabs() {
  localStorage.setItem(TABS_KEY, JSON.stringify(chatTabs));
  localStorage.setItem(ACTIVE_TAB_KEY, sessionId);
}

function switchTab(tabId) {
  sessionId = tabId;
  saveTabs();
  renderTabs();
  loadHistory().catch(() => {});
  closeMobileMenu();
}

function addTab() {
  const name = `Assunto ${chatTabs.length + 1}`;
  const newTab = { id: crypto.randomUUID(), name };
  chatTabs.push(newTab);
  switchTab(newTab.id);
}

function renameTabInline(tabId, nameSpan) {
  const tab = chatTabs.find(t => t.id === tabId);
  if (!tab) return;

  const input = document.createElement("input");
  input.className = "tab-name-input";
  input.value = tab.name;
  input.maxLength = 40;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim() || tab.name;
    tab.name = newName;
    saveTabs();
    renderTabs();
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = tab.name; input.blur(); }
  });
}

function closeTab(tabId) {
  if (chatTabs.length <= 1) {
    showToast("Mantenha ao menos uma conversa.", "error");
    return;
  }
  chatTabs = chatTabs.filter(t => t.id !== tabId);
  if (sessionId === tabId) {
    sessionId = chatTabs[0].id;
  }
  saveTabs();
  renderTabs();
  loadHistory().catch(() => {});
}

function renderTabs() {
  chatTabsEl.innerHTML = "";

  for (const tab of chatTabs) {
    const btn = document.createElement("button");
    btn.className = `tab ${tab.id === sessionId ? "active" : ""}`;
    btn.addEventListener("click", () => switchTab(tab.id));

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-name";
    nameSpan.textContent = tab.name;
    nameSpan.title = "Clique duplo para renomear";
    nameSpan.addEventListener("dblclick", e => {
      e.stopPropagation();
      renameTabInline(tab.id, nameSpan);
    });
    btn.appendChild(nameSpan);

    const actions = document.createElement("span");
    actions.className = "tab-actions";

    const renameBtn = document.createElement("button");
    renameBtn.className = "tab-icon";
    renameBtn.textContent = "✎";
    renameBtn.title = "Renomear";
    renameBtn.addEventListener("click", e => {
      e.stopPropagation();
      const currentName = btn.querySelector(".tab-name");
      if (currentName) renameTabInline(tab.id, currentName);
    });
    actions.appendChild(renameBtn);

    const closeTabBtn = document.createElement("button");
    closeTabBtn.className = "tab-icon";
    closeTabBtn.textContent = "✕";
    closeTabBtn.title = "Fechar";
    closeTabBtn.addEventListener("click", e => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    actions.appendChild(closeTabBtn);
    btn.appendChild(actions);
    chatTabsEl.appendChild(btn);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "tab tab-add";
  addBtn.textContent = "+ Nova conversa";
  addBtn.addEventListener("click", addTab);
  chatTabsEl.appendChild(addBtn);
}

// ===========================
// MENU MOBILE
// ===========================
function isMobile() { return window.innerWidth <= 720; }

function openMobileMenu() {
  if (!isMobile()) return;
  sidebarEl.classList.add("open");
  backdropEl.classList.add("show");
}

function closeMobileMenu() {
  sidebarEl.classList.remove("open");
  backdropEl.classList.remove("show");
}

function setMobileSection(section) {
  if (!isMobile()) return;
  const showChat = section === "chat";
  panelChatEl?.classList.toggle("active", showChat);
  panelDictEl?.classList.toggle("active", !showChat);
  mobileSwitchChatBtn?.classList.toggle("active", showChat);
  mobileSwitchDictBtn?.classList.toggle("active", !showChat);
}

function showChatPanel() { setMobileSection("chat"); }
function showDictPanel() { setMobileSection("dict"); }

// ===========================
// MENSAGENS
// ===========================
function clearEmptyState() {
  const empty = messagesEl.querySelector(".empty-state");
  if (empty) empty.remove();
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text || "").replace(/[&<>"']/g, m => map[m]);
}

function addMessage(kind, text) {
  clearEmptyState();
  const div = document.createElement("div");
  div.className = `msg ${kind}`;

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = kind === "user" ? "Você" : "Node Dictionary";
  div.appendChild(label);

  const body = document.createElement("div");
  body.textContent = text;
  div.appendChild(body);

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addCodeMessage(code, title = "Código") {
  clearEmptyState();
  const div = document.createElement("div");
  div.className = "msg bot";

  const label = document.createElement("div");
  label.className = "msg-label";
  label.textContent = "Node Dictionary";
  div.appendChild(label);

  if (title) {
    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:6px;";
    titleEl.textContent = title;
    div.appendChild(titleEl);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "code-block-wrapper";

  const header = document.createElement("div");
  header.className = "code-block-header";
  const lang = document.createElement("span");
  lang.className = "code-block-lang";
  lang.textContent = "javascript";
  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copiar";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.textContent = "Copiado!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copiar";
        copyBtn.classList.remove("copied");
      }, 2000);
    }).catch(() => showToast("Falha ao copiar.", "error"));
  });
  header.appendChild(lang);
  header.appendChild(copyBtn);
  wrapper.appendChild(header);

  const content = document.createElement("div");
  content.className = "code-block-content";
  content.textContent = code;
  wrapper.appendChild(content);

  div.appendChild(wrapper);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function parseAndDisplayMessage(text) {
  const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  const parts = [];

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.substring(lastIndex, match.index).trim();
      if (textBefore) parts.push({ type: "text", content: textBefore });
    }
    parts.push({ type: "code", content: match[1].trim() });
    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    const textAfter = text.substring(lastIndex).trim();
    if (textAfter) parts.push({ type: "text", content: textAfter });
  }

  if (parts.length === 0) { addMessage("bot", text); return; }

  for (const part of parts) {
    if (part.type === "text") addMessage("bot", part.content);
    else addCodeMessage(part.content, "");
  }
}

// ===========================
// LOADING STATES
// ===========================
function setTyping(show) {
  typingEl.classList.toggle("hidden", !show);
  if (show) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setDictLoading(show) {
  dictLoadingEl.classList.toggle("hidden", !show);
}

function setButtonsDisabled(disabled) {
  [sendBtn, translateCodeBtn, lineCommentBtn, improveCodeBtn].forEach(btn => {
    btn.disabled = disabled;
  });
  isLoading = disabled;
}

// ===========================
// API CALLS
// ===========================
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const mode = data.mode || "online";
    const storage = data.storage || "memory";
    setStatus(`Online · ${mode}`, "online");
    if (storageInfoEl) {
      storageInfoEl.textContent = `Armazenamento: ${storage}`;
    }
  } catch {
    setStatus("Backend offline", "error");
    showToast("Backend offline. Rode npm run dev no terminal.", "error", 6000);
  }
}

async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message || isLoading) return;

  inputEl.value = "";
  addMessage("user", message);
  setTyping(true);
  setButtonsDisabled(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId })
    });
    const data = await res.json();
    const reply = data.reply || data.error || "Sem resposta.";
    parseAndDisplayMessage(reply);
  } catch {
    addMessage("bot", "Erro de conexão. Verifique se o servidor está rodando.");
    showToast("Falha ao enviar mensagem.", "error");
  } finally {
    setTyping(false);
    setButtonsDisabled(false);
    inputEl.focus();
  }
}

async function loadHistory() {
  try {
    const res = await fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    messagesEl.innerHTML = "";

    if (!data.history || !data.history.length) {
      messagesEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <p>Faça uma pergunta sobre Node.js ou cole um código abaixo para analisar.</p>
        </div>`;
      return;
    }

    for (const item of data.history) {
      const kind = item.role === "user" ? "user" : "bot";
      addMessage(kind, item.content);
    }
  } catch {
    // silently ignore
  }
}

async function clearHistory() {
  try {
    await fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    messagesEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p>Histórico limpo. Comece uma nova conversa!</p>
      </div>`;
    showToast("Histórico limpo com sucesso.", "success");
  } catch {
    showToast("Falha ao limpar histórico.", "error");
  }
}

async function saveAssistantMessage(content) {
  await fetch("/api/history/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, role: "assistant", content })
  }).catch(() => {});
}

// ===========================
// DICIONÁRIO
// ===========================
function renderNpmPackages(packages) {
  // Remove seção anterior se existir
  const old = document.getElementById("npmPackagesSection");
  if (old) old.remove();

  if (!packages || !packages.length) return;

  const section = document.createElement("div");
  section.id = "npmPackagesSection";
  section.style.cssText = "margin: 0 14px 14px;";

  section.innerHTML = `
    <div style="
      border: 1px solid rgba(56,189,248,0.2);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(5,10,24,0.5);
    ">
      <div style="
        padding: 9px 14px;
        border-bottom: 1px solid rgba(148,163,184,0.1);
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(56,189,248,0.06);
      ">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--primary);">
          📦 Pacotes npm detectados
        </span>
        <span style="font-size:11px;color:var(--text-3);">dados do registry oficial</span>
      </div>
      <div id="npmPackagesList" style="display:flex;flex-direction:column;gap:0;"></div>
    </div>
  `;

  const list = section.querySelector("#npmPackagesList");

  for (const pkg of packages) {
    const item = document.createElement("div");
    item.style.cssText = "padding:11px 14px;border-bottom:1px solid rgba(148,163,184,0.08);display:flex;flex-direction:column;gap:5px;";
    item.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:#f1f5f9;">${escapeHtml(pkg.name)}</span>
          <span style="font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(52,211,153,0.12);color:#6ee7b7;border:1px solid rgba(52,211,153,0.2);">v${escapeHtml(pkg.version)}</span>
          ${pkg.license !== "—" ? `<span style="font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(148,163,184,0.08);color:var(--text-3);border:1px solid var(--stroke);">${escapeHtml(pkg.license)}</span>` : ""}
        </div>
        <a href="${escapeHtml(pkg.homepage)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--primary);text-decoration:none;display:flex;align-items:center;gap:4px;">
          ver no npm ↗
        </a>
      </div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.5;">${escapeHtml(pkg.description)}</div>
      ${pkg.keywords.length ? `
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          ${pkg.keywords.map(k => `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:rgba(129,140,248,0.1);color:#c7d2fe;border:1px solid rgba(129,140,248,0.2);">${escapeHtml(k)}</span>`).join("")}
        </div>` : ""}
    `;
    list.appendChild(item);
  }

  // Insere antes do dicionário de termos
  dictionaryEl.parentNode.insertBefore(section, dictionaryEl);
}

function renderDictionary(entries, totalIdentificadores, totalUnicos) {
  dictionaryEl.innerHTML = "";

  if (!entries || !entries.length) {
    dictionaryEl.innerHTML = `<div style="padding:14px;color:var(--text-3);font-size:13px;">Nenhum termo encontrado.</div>`;
    return;
  }

  const stats = document.createElement("div");
  stats.className = "dict-stats";
  stats.innerHTML = `Identificadores totais: <span>${totalIdentificadores || 0}</span> &nbsp;·&nbsp; Termos únicos: <span>${totalUnicos || 0}</span>`;
  dictionaryEl.appendChild(stats);

  for (const item of entries) {
    const div = document.createElement("div");
    div.className = "dict-item";
    div.innerHTML = `
      <div class="dict-head">
        <div class="dict-term-group">
          <span class="term">${escapeHtml(item.termo)}</span>
          <span class="arrow">→</span>
          <span class="translation">${escapeHtml(item.traducao)}</span>
        </div>
        <div class="chips">
          <span class="chip ${escapeHtml(item.categoria)}">${escapeHtml(item.categoria.replace(/-/g, " "))}</span>
          <span class="chip freq">×${item.frequencia}</span>
          ${item.fonte === "MDN Web Docs" ? '<span class="chip mdn">MDN</span>' : ""}
        </div>
      </div>
      <div class="dict-explanation">${escapeHtml(item.explicacao)}</div>
      ${item.mdnUrl ? `<a href="${escapeHtml(item.mdnUrl)}" target="_blank" rel="noopener" class="dict-mdn-link">ver na MDN ↗</a>` : ""}
    `;
    dictionaryEl.appendChild(div);
  }
}

function renderAnalysis(analise) {
  codeAnalysisEl.innerHTML = "";
  if (!analise || !analise.resumo) return;

  function listHtml(items) {
    if (!items || !items.length) return "<li>—</li>";
    return items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
  }

  codeAnalysisEl.innerHTML = `
    <div class="analysis-header">
      <span class="analysis-title">Análise do código</span>
    </div>
    <div class="analysis-body">
      <p class="analysis-summary">${escapeHtml(analise.resumo)}</p>
      <div class="analysis-grid">
        <div class="analysis-card strengths">
          <div class="analysis-card-title">✓ Pontos fortes</div>
          <ul class="analysis-list">${listHtml(analise.pontosFortes)}</ul>
        </div>
        <div class="analysis-card risks">
          <div class="analysis-card-title">⚠ Riscos</div>
          <ul class="analysis-list">${listHtml(analise.riscos)}</ul>
        </div>
        <div class="analysis-card improvements">
          <div class="analysis-card-title">↑ Melhorias</div>
          <ul class="analysis-list">${listHtml(analise.melhorias)}</ul>
        </div>
      </div>
    </div>
  `;
}

async function postAnalysisInChat(analise) {
  if (!analise) return;
  if (analise.comentarioChat) {
    addMessage("bot", analise.comentarioChat);
    await saveAssistantMessage(analise.comentarioChat);
  }
  if (analise.perguntaInterativa) {
    addMessage("bot", analise.perguntaInterativa);
    await saveAssistantMessage(analise.perguntaInterativa);
  }
}

async function translateCode() {
  const code = codeBoxEl.value.trim();
  if (!code) { showToast("Cole um código para traduzir.", "info"); return; }

  setDictLoading(true);
  setButtonsDisabled(true);
  dictionaryEl.innerHTML = "";
  codeAnalysisEl.innerHTML = "";

  try {
    const maxTerms = Number(maxTermsEl.value) || 600;
    const res = await fetch("/api/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, maxTerms })
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, "error"); return; }
    renderDictionary(data.entries || [], data.totalIdentificadores, data.totalUnicos);
    renderNpmPackages(data.npmPackages || []);
    renderAnalysis(data.analise);
    await postAnalysisInChat(data.analise);
    showToast(`${data.totalUnicos || 0} termos identificados!`, "success");
  } catch {
    showToast("Falha ao gerar dicionário.", "error");
  } finally {
    setDictLoading(false);
    setButtonsDisabled(false);
  }
}

async function runLineComments() {
  const code = codeBoxEl.value.trim();
  if (!code) { showToast("Cole um código antes.", "info"); return; }

  addMessage("user", "Comente este código linha a linha.");
  setTyping(true);
  setButtonsDisabled(true);

  try {
    const res = await fetch("/api/code/line-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    const comentarios = data.comentarios || [];

    if (comentarios.length > 0) {
      const texto = comentarios.slice(0, 5).map(c => `📍 Linhas ${c.faixa}:\n${c.comentario}`).join("\n\n");
      addMessage("bot", texto);
      await saveAssistantMessage(texto);
    } else {
      addMessage("bot", "Não encontrei comentários linha a linha para este trecho.");
    }
    addMessage("bot", "Quer que eu aprofunde algum bloco específico?");
  } catch {
    addMessage("bot", "Falha ao comentar o código.");
    showToast("Erro ao comentar código.", "error");
  } finally {
    setTyping(false);
    setButtonsDisabled(false);
  }
}

async function runImproveCode() {
  const code = codeBoxEl.value.trim();
  if (!code) { showToast("Cole um código antes.", "info"); return; }

  addMessage("user", "Melhore este código e explique o que mudou.");
  setTyping(true);
  setButtonsDisabled(true);

  try {
    const res = await fetch("/api/code/improve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    addMessage("bot", `📌 ${data.explicacao || "Sem explicação."}`);

    const improvements = data.melhoriasAplicadas || [];
    if (improvements.length > 0) {
      const list = improvements.slice(0, 5).map((item, i) => `${i + 1}. ${item}`).join("\n");
      addMessage("bot", `✨ Melhorias aplicadas:\n${list}`);
    }

    addCodeMessage(data.codigoMelhorado || code, "Código melhorado");
    await saveAssistantMessage(`Código melhorado:\n${data.codigoMelhorado || code}`);
    addMessage("bot", "Quer que eu aplique essas melhorias em passos menores?");
    showToast("Código melhorado com sucesso!", "success");
  } catch {
    addMessage("bot", "Falha ao corrigir o código.");
    showToast("Erro ao corrigir código.", "error");
  } finally {
    setTyping(false);
    setButtonsDisabled(false);
  }
}

// ===========================
// EVENT LISTENERS
// ===========================
sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) sendMessage(); });
clearBtn.addEventListener("click", clearHistory);
menuBtn.addEventListener("click", openMobileMenu);
backdropEl.addEventListener("click", closeMobileMenu);
mobileSwitchChatBtn?.addEventListener("click", showChatPanel);
mobileSwitchDictBtn?.addEventListener("click", showDictPanel);

if (clearCodeBtn) {
  clearCodeBtn.addEventListener("click", () => {
    codeBoxEl.value = "";
    dictionaryEl.innerHTML = "";
    codeAnalysisEl.innerHTML = "";
    showToast("Editor limpo.", "info");
  });
}

translateCodeBtn.addEventListener("click", () => {
  translateCode().catch(() => showToast("Falha ao gerar dicionário.", "error"));
});

lineCommentBtn.addEventListener("click", () => {
  runLineComments().catch(() => showToast("Falha ao comentar código.", "error"));
});

improveCodeBtn.addEventListener("click", () => {
  runImproveCode().catch(() => showToast("Falha ao corrigir código.", "error"));
});

window.addEventListener("resize", () => {
  if (!isMobile()) closeMobileMenu();
  if (isMobile() && !panelChatEl?.classList.contains("active") && !panelDictEl?.classList.contains("active")) showChatPanel();
});

// ===========================
// INICIALIZAÇÃO
// ===========================
loadTabs();
renderTabs();
checkHealth();
loadHistory().catch(() => {});
