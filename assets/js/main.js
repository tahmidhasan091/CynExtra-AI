/* ============================================================
   CYNEXTRA-AI — Production Frontend Controller (v2)
   Frontend + Backend API integration
   ============================================================ */
"use strict";

const CYNEXTRA = Object.freeze({
  storage: Object.freeze({
    auth: "cynextra_auth_state",
    settings: "cynextra_settings",
    theme: "cynextra_theme",
    profile: "cynextra_profile",
    accounts: "cynextra_accounts",
    plan: "cynextra_plan",
    model: "cynextra_model",
    chatId: "cynextra_current_chat"
  }),
  pages: Object.freeze({
    index: "index.html",
    login: "login.html",
    signup: "signup.html",
    chat: "chat.html",
    library: "library.html",
    projects: "projects.html",
    plugins: "plugins.html",
    tools: "tools.html",
    profile: "profile.html",
    settings: "settings.html",
    pricing: "pricing.html",
    ultimate: "ultimate.html",
    terms: "terms.html"
  }),
  apiBase: (function () {
    const meta = document.querySelector('meta[name="cynextra-api"]');
    if (meta && meta.content) return meta.content.replace(/\/$/, "");

    const BACKEND_API = "http://localhost:3000/api";
    if (typeof window === "undefined" || !window.location) return BACKEND_API;

    const origin = window.location.origin || "";
    if (!origin || origin === "null" || origin.startsWith("file:")) return BACKEND_API;

    // The backend serves the frontend from port 3000. Acode Preview may use
    // another localhost port (for example 8158); never treat that preview
    // origin as the API origin.
    try {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase();
      if ((host === "localhost" || host === "127.0.0.1" || host === "[::1]") && url.port === "3000") {
        return origin + "/api";
      }
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
        return BACKEND_API;
      }
    } catch {
      return BACKEND_API;
    }

    return BACKEND_API;
  })()
});

const CynExtraApp = {
  state: {
    initialized: false,
    sidebarOpen: false,
    plusMenuOpen: false,
    moreMenuOpen: false,
    modelMenuOpen: false,
    currentTheme: "default",
    currentPlan: "free",
    currentModel: "cynextra-swift",
    currentChatId: null,
    webSearchEnabled: false,
    isGenerating: false,
    models: [],
    activeProject: null,
    capabilities: null,
    abortController: null,
    editingMessage: null,
    pendingAttachments: []
  },
  elements: {},

  init() {
    if (this.state.initialized) return;
    this.cacheElements();
    this.bindEvents();
    this.state.initialized = true;
    this.initializePage();
  },

  cacheElements() {
    this.elements = {
      body: document.body,
      html: document.documentElement,
      sidebar: document.querySelector("[data-sidebar]"),
      chatView: document.querySelector("[data-chat-view]"),
      plusMenu: document.querySelector("[data-plus-menu]"),
      moreMenu: document.querySelector("[data-more-menu]")
    };
  },

  getPageName() {
    const path = window.location.pathname || "";
    const file = path.split("/").pop();
    return file ? file.toLowerCase() : CYNEXTRA.pages.index;
  },

  isPage(page) {
    return this.getPageName() === page;
  },

  navigate(page) {
    if (!page) return false;
    const target = CYNEXTRA.pages[page] || String(page);
    if (target.startsWith("#") || target.startsWith("http")) {
      window.location.href = target;
      return true;
    }
    if (this.getPageName() === target.toLowerCase()) return false;
    window.location.href = target;
    return true;
  },

  safeStorageGet(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },

  safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  },

  safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  parseJSON(raw, fallback = null) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  },

  escapeSelectorValue(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  },

  dispatch(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  },

  async api(path, options = {}) {
    const url = `${CYNEXTRA.apiBase}${path.startsWith("/") ? path : "/" + path}`;
    const opts = {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {})
      },
      ...(options.signal ? { signal: options.signal } : {})
    };
    const authState = this.auth?.getState?.() || {};
    if (authState.token && !opts.headers.Authorization) {
      opts.headers.Authorization = `Bearer ${authState.token}`;
    }
    if (options.body !== undefined) {
      opts.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return {
        ok: false,
        status: 0,
        data: {
          success: false,
          error: "CynExtra-AI could not reach the backend. Check the backend URL, server status, or network connection."
        }
      };
    }
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = { success: false, error: "Server returned invalid JSON." };
      }
    } else {
      const text = await res.text().catch(() => "");
      data = {
        success: false,
        error:
          res.status === 404
            ? "API route not found. Start backend with: cd backend && npm start"
            : `Server error (${res.status}). Expected JSON, got HTML/text.`
      };
      if (text && text.length < 200) data.detail = text;
    }
    return { ok: res.ok, status: res.status, data };
  }
};

/* ============================================================
   AUTH
   ============================================================ */

CynExtraApp.auth = {
  getState() {
    const parsed = CynExtraApp.parseJSON(
      CynExtraApp.safeStorageGet(CYNEXTRA.storage.auth),
      {}
    );
    return {
      loggedIn: parsed?.loggedIn === true,
      userId: parsed?.userId || null,
      token: parsed?.token || null
    };
  },

  isLoggedIn() {
    return this.getState().loggedIn;
  },

  setState(state) {
    if (!state || typeof state !== "object") return false;
    return CynExtraApp.safeStorageSet(
      CYNEXTRA.storage.auth,
      JSON.stringify({
        loggedIn: state.loggedIn === true,
        userId: state.userId || null,
        token: state.token || null
      })
    );
  },

  clearState() {
    return CynExtraApp.safeStorageRemove(CYNEXTRA.storage.auth);
  },

  protectedPages: new Set([
    CYNEXTRA.pages.chat,
    CYNEXTRA.pages.library,
    CYNEXTRA.pages.projects,
    CYNEXTRA.pages.plugins,
    CYNEXTRA.pages.tools,
    CYNEXTRA.pages.profile,
    CYNEXTRA.pages.settings,
    CYNEXTRA.pages.pricing
  ]),

  authPages: new Set([CYNEXTRA.pages.login, CYNEXTRA.pages.signup]),

  enforceRedirects() {
    const page = CynExtraApp.getPageName();
    const loggedIn = this.isLoggedIn();
    if (this.protectedPages.has(page) && !loggedIn) {
      CynExtraApp.navigate("login");
      return true;
    }
    if (this.authPages.has(page) && loggedIn) {
      CynExtraApp.navigate("chat");
      return true;
    }
    if (page === CYNEXTRA.pages.index) {
      CynExtraApp.navigate(loggedIn ? "chat" : "login");
      return true;
    }
    return false;
  },

  async hashPassword(password) {
    const value = String(password ?? "");
    if (!window.crypto?.subtle) return value;
    try {
      const data = new TextEncoder().encode(value);
      const digest = await window.crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return value;
    }
  }
};

CynExtraApp.logout = function () {
  this.auth.clearState();
  this.safeStorageRemove(CYNEXTRA.storage.profile);
  this.safeStorageRemove(CYNEXTRA.storage.plan);
  this.safeStorageRemove(CYNEXTRA.storage.chatId);
  this.state.currentPlan = "free";
  this.state.currentChatId = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  this.closeAllMenus();
  this.closeSidebar();
  this.navigate("login");
};

/* ============================================================
   NAVIGATION / SIDEBAR / MENUS
   ============================================================ */

CynExtraApp.navigation = {
  getTargetFromElement(element) {
    if (!element) return null;
    return (
      element.dataset.navigate ||
      element.dataset.page ||
      element.getAttribute("href")
    );
  },
  normalizeTarget(target) {
    if (!target) return null;
    const value = String(target).trim();
    if (!value || value === "#") return null;
    if (value.endsWith(".html")) return value.split("/").pop().toLowerCase();
    return value;
  },
  handleNavigation(element) {
    const target = this.normalizeTarget(this.getTargetFromElement(element));
    if (!target) return;
    CynExtraApp.navigate(target);
  },
  markCurrentPage() {
    const currentPage = CynExtraApp.getPageName();
    document.querySelectorAll("[data-nav-link]").forEach((link) => {
      const target = this.normalizeTarget(
        link.dataset.navLink || link.getAttribute("href")
      );
      const active = target === currentPage;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }
};

CynExtraApp.openSidebar = function () {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;
  this.state.sidebarOpen = true;
  sidebar.classList.add("is-open");
  sidebar.dataset.open = "true";
  sidebar.setAttribute("aria-hidden", "false");
  const overlay = document.querySelector(".sidebar-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.dataset.visible = "true";
    overlay.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("sidebar-open");
  const composer = document.querySelector(".chat-composer");
  if (composer) {
    composer.style.setProperty("visibility", "hidden", "important");
    composer.style.setProperty("pointer-events", "none", "important");
  }
};

CynExtraApp.closeSidebar = function () {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;
  this.state.sidebarOpen = false;
  sidebar.classList.remove("is-open");
  sidebar.dataset.open = "false";
  sidebar.setAttribute("aria-hidden", "true");
  const overlay = document.querySelector(".sidebar-overlay");
  if (overlay) {
    overlay.classList.remove("is-visible");
    overlay.dataset.visible = "false";
    overlay.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("sidebar-open");
  const composerShow = document.querySelector(".chat-composer");
  if (composerShow) {
    composerShow.style.removeProperty("visibility");
    composerShow.style.removeProperty("pointer-events");
  }
};

CynExtraApp.toggleSidebar = function () {
  this.state.sidebarOpen ? this.closeSidebar() : this.openSidebar();
};

CynExtraApp.setMenuState = function (menu, open, button) {
  if (!menu) return;
  menu.classList.toggle("is-open", open);
  menu.dataset.open = String(open);
  menu.setAttribute("aria-hidden", String(!open));
  if (button) button.setAttribute("aria-expanded", String(open));
};

CynExtraApp.togglePlusMenu = function () {
  this.state.plusMenuOpen = !this.state.plusMenuOpen;
  if (this.state.plusMenuOpen) {
    this.closeMoreMenu();
    this.closeModelMenu();
  }
  this.setMenuState(
    this.elements.plusMenu,
    this.state.plusMenuOpen,
    document.querySelector("[data-action='toggle-plus-menu']")
  );
};

CynExtraApp.toggleMoreMenu = function () {
  this.state.moreMenuOpen = !this.state.moreMenuOpen;
  if (this.state.moreMenuOpen) {
    this.closePlusMenu();
    this.closeModelMenu();
  }
  this.setMenuState(
    this.elements.moreMenu,
    this.state.moreMenuOpen,
    document.querySelector("[data-action='toggle-more-menu']")
  );
};

CynExtraApp.closePlusMenu = function () {
  this.state.plusMenuOpen = false;
  this.setMenuState(this.elements.plusMenu, false, document.querySelector("[data-action='toggle-plus-menu']"));
};

CynExtraApp.closeMoreMenu = function () {
  this.state.moreMenuOpen = false;
  this.setMenuState(this.elements.moreMenu, false, document.querySelector("[data-action='toggle-more-menu']"));
};

CynExtraApp.closeModelMenu = function () {
  this.state.modelMenuOpen = false;
  const menu = document.querySelector("[data-model-menu]");
  this.setMenuState(menu, false, document.querySelector("[data-action='toggle-model-menu']"));
};

CynExtraApp.closeAllMenus = function () {
  this.closePlusMenu();
  this.closeMoreMenu();
  this.closeModelMenu();
};

CynExtraApp.handleOutsideMenus = function (event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (
    this.state.plusMenuOpen &&
    this.elements.plusMenu &&
    !target.closest("[data-plus-menu]") &&
    !target.closest("[data-action='toggle-plus-menu']")
  ) {
    this.closePlusMenu();
  }
  if (
    this.state.moreMenuOpen &&
    this.elements.moreMenu &&
    !target.closest("[data-more-menu]") &&
    !target.closest("[data-action='toggle-more-menu']")
  ) {
    this.closeMoreMenu();
  }
  if (
    this.state.modelMenuOpen &&
    !target.closest("[data-model-menu]") &&
    !target.closest("[data-action='toggle-model-menu']")
  ) {
    this.closeModelMenu();
  }
};

/* ============================================================
   THEME + PLANS
   ============================================================ */

CynExtraApp.theme = {
  allowedThemes: Object.freeze([
    "default",
    "slate",
    "forest",
    "neon-blue",
    "cyber-purple",
    "ocean-glass",
    "sunset",
    "arctic",
    "aurora",
    "galaxy",
    "luxury-dark",
    "quantum",
    "crimson",
    "obsidian-gold"
  ]),
  minimumPlan: Object.freeze({
    default: "free",
    slate: "free",
    forest: "free",
    "neon-blue": "pro",
    "cyber-purple": "pro",
    "ocean-glass": "pro",
    sunset: "pro",
    arctic: "pro",
    aurora: "ultimate",
    galaxy: "ultimate",
    "luxury-dark": "ultimate",
    quantum: "ultimate",
    crimson: "ultimate",
    "obsidian-gold": "ultimate"
  }),
  planRank: Object.freeze({ free: 0, pro: 1, ultimate: 2 }),
  canUse(theme, plan = CynExtraApp.state.currentPlan) {
    const required = this.minimumPlan[theme] || "free";
    return (this.planRank[plan] || 0) >= (this.planRank[required] || 0);
  },
  fallbackForPlan() {
    return "default";
  },
  load() {
    const saved = CynExtraApp.safeStorageGet(CYNEXTRA.storage.theme, "default");
    const theme =
      this.allowedThemes.includes(saved) && this.canUse(saved)
        ? saved
        : this.fallbackForPlan();
    this.apply(theme, false);
  },
  apply(theme, persist = true) {
    const requested = String(theme || "default");
    const selected =
      this.allowedThemes.includes(requested) && this.canUse(requested)
        ? requested
        : this.fallbackForPlan();
    CynExtraApp.state.currentTheme = selected;
    document.documentElement.dataset.theme = selected;
    if (document.body) document.body.dataset.theme = selected;
    if (persist) CynExtraApp.safeStorageSet(CYNEXTRA.storage.theme, selected);
    document.querySelectorAll("[data-theme-option]").forEach((option) => {
      const active = option.dataset.themeOption === selected;
      option.classList.toggle("is-selected", active);
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-pressed", String(active));
    });
  }
};

CynExtraApp.account = {
  async sync() {
    const auth = CynExtraApp.auth.getState();
    if (!auth.token || !auth.userId) return null;
    const result = await CynExtraApp.api(`/user?userId=${encodeURIComponent(auth.userId)}`);
    if (result.status === 401 || result.status === 403) {
      CynExtraApp.logout();
      return null;
    }
    if (!result.ok || !result.data?.user) return null;
    const user = result.data.user;
    CynExtraApp.state.currentPlan = CynExtraApp.plans.normalize(user.plan);
    CynExtraApp.safeStorageSet(CYNEXTRA.storage.plan, CynExtraApp.state.currentPlan);
    CynExtraApp.safeStorageSet(CYNEXTRA.storage.profile, JSON.stringify({
      name: user.metadata?.name || "",
      email: user.metadata?.email || ""
    }));
    return user;
  }
};

CynExtraApp.plans = {
  allowed: Object.freeze(["free", "pro", "ultimate"]),
  normalize(plan) {
    const value = CynExtraApp.normalize(plan);
    return this.allowed.includes(value) ? value : "free";
  },
  load() {
    const stored = CynExtraApp.safeStorageGet(CYNEXTRA.storage.plan, "free");
    CynExtraApp.state.currentPlan = this.normalize(stored);
  },
  applyToUI() {
    const plan = CynExtraApp.state.currentPlan;
    document.body?.setAttribute("data-plan", plan);
    document.querySelectorAll("[data-plan]").forEach((el) => {
      el.classList.toggle("is-current", el.dataset.plan === plan);
    });
    document.querySelectorAll("[data-plan-select]").forEach((btn) => {
      const selected = btn.dataset.planSelect === plan;
      btn.classList.toggle("is-current", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-profile-plan]").forEach((el) => {
      el.textContent = plan.toUpperCase();
    });
  },
  async set(plan) {
    const selected = this.normalize(plan);
    const userId = CynExtraApp.auth.getState().userId;
    if (!userId) {
      CynExtraApp.navigate("login");
      return false;
    }
    try {
      if (selected === "free") {
        throw new Error("Free is the default plan. Paid plans are activated after verified payment.");
      }
      const result = await CynExtraApp.api("/payments/checkout", {
        method: "POST",
        body: {
          userId,
          plan: selected,
          successUrl: window.location.href,
          cancelUrl: window.location.href
        }
      });
      if (!result.ok || !result.data?.success || !result.data?.checkoutUrl) {
        throw new Error(result.data?.error || "Payment checkout is not configured.");
      }
      window.location.href = result.data.checkoutUrl;
      return true;
    } catch (error) {
      this.applyToUI();
      const status = document.querySelector("[data-pricing-status]");
      if (status) {
        status.textContent = error.message;
        status.hidden = false;
      }
      return false;
    }
  }
};

/* ============================================================
   MODELS
   ============================================================ */

CynExtraApp.models = {
  async load() {
    const userId = CynExtraApp.auth.getState().userId;
    try {
      const { data } = await CynExtraApp.api(
        `/models${userId ? "?userId=" + encodeURIComponent(userId) : ""}`
      );
      if (data?.success && Array.isArray(data.models)) {
        CynExtraApp.state.models = data.models;
        const saved = CynExtraApp.safeStorageGet(CYNEXTRA.storage.model, "");
        const exists = data.models.some((m) => m.id === saved);
        CynExtraApp.state.currentModel = exists
          ? saved
          : data.defaultModel || data.models[0]?.id || "cynextra-swift";
        this.updateUI();
        return;
      }
    } catch {
      /* fallback list */
    }
    CynExtraApp.state.models = [];
    CynExtraApp.state.currentModel = "";
    this.updateUI();
    const status = document.querySelector("[data-model-status]");
    if (status) status.textContent = "Models are unavailable until the backend is reachable.";
  },

  select(modelId) {
    const model = CynExtraApp.state.models.find((m) => m.id === modelId);
    if (!model) return;
    CynExtraApp.state.currentModel = modelId;
    CynExtraApp.safeStorageSet(CYNEXTRA.storage.model, modelId);
    this.updateUI();
    CynExtraApp.closeModelMenu();
    CynExtraApp.dispatch("cynextra:model-changed", { modelId, model });
  },

  updateUI() {
    const current = CynExtraApp.state.models.find(
      (m) => m.id === CynExtraApp.state.currentModel
    );
    document.querySelectorAll("[data-current-model-name]").forEach((el) => {
      el.textContent = current ? `${current.icon || ""} ${current.name}` : "Select model";
    });
    document.querySelectorAll("[data-model-option]").forEach((btn) => {
      const active = btn.dataset.modelOption === CynExtraApp.state.currentModel;
      btn.classList.toggle("is-selected", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  },

  toggleMenu() {
    CynExtraApp.state.modelMenuOpen = !CynExtraApp.state.modelMenuOpen;
    if (CynExtraApp.state.modelMenuOpen) {
      CynExtraApp.closePlusMenu();
      CynExtraApp.closeMoreMenu();
      this.renderMenu();
    }
    const menu = document.querySelector("[data-model-menu]");
    CynExtraApp.setMenuState(
      menu,
      CynExtraApp.state.modelMenuOpen,
      document.querySelector("[data-action='toggle-model-menu']")
    );
  },

  renderMenu() {
    const container = document.querySelector("[data-model-list]");
    if (!container) return;
    container.innerHTML = "";
    CynExtraApp.state.models.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-option";
      btn.dataset.modelOption = m.id;
      btn.setAttribute("aria-pressed", String(m.id === CynExtraApp.state.currentModel));
      if (m.id === CynExtraApp.state.currentModel) btn.classList.add("is-selected");
      const iconKey = String(m.icon || "nova").replace(/[^a-z0-9-]/gi, "") || "nova";
      const iconNameMap = { nova: "model-nova.png", swift: "model-swift.png", core: "model-core.png", think: "think.png", code: "think.png", max: "ultimate.png", vision: "photo.png" };
      const iconSrc = "assets/images/icons/" + (iconNameMap[iconKey] || "model-nova.png");
      btn.innerHTML = `
        <span class="model-option-icon"><img src="${iconSrc}" alt="" width="22" height="22"></span>
        <span class="model-option-body">
          <strong>${m.name}</strong>
          <small>${m.tagline || ""} — ${m.description || ""}</small>
        </span>
      `;
      btn.addEventListener("click", () => this.select(m.id));
      container.appendChild(btn);
    });
  }
};

/* ============================================================
   CHAT + API
   ============================================================ */

CynExtraApp.chat = {
  getInput() {
    return document.querySelector("[data-chat-input]");
  },
  getForm() {
    return document.querySelector("[data-chat-form]");
  },
  getMessagesContainer() {
    return document.querySelector(".chat-message-list") || document.querySelector("[data-chat-messages]");
  },

  clearInput() {
    const input = this.getInput();
    if (!input) return;
    input.value = "";
    this.autoResizeInput();
    this.updateSendButtonState();
  },

  updateSendButtonState() {
    const input = this.getInput();
    const form = this.getForm();
    const button = form?.querySelector("[data-action='send-message'], [type='submit'], .chat-send-button");
    if (!input || !button) return;
    const hasText = String(input.value || "").trim().length > 0;
    const hasAttachments = Array.isArray(CynExtraApp.state.pendingAttachments) && CynExtraApp.state.pendingAttachments.length > 0;
    if (CynExtraApp.state.isGenerating) {
      button.disabled = false;
      button.setAttribute("aria-disabled", "false");
      button.classList.remove("has-text");
      return;
    }
    const disabled = !hasText && !hasAttachments;
    button.disabled = disabled;
    button.setAttribute("aria-disabled", String(disabled));
    button.classList.toggle("has-text", (hasText || hasAttachments) && !CynExtraApp.state.isGenerating);
  },

  autoResizeInput() {
    const input = this.getInput();
    if (!input) return;
    input.style.height = "auto";
    const maxHeight = Number.parseInt(getComputedStyle(input).maxHeight, 10) || 180;
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    this.updateSendButtonState();
  },

  focusInput() {
    const input = this.getInput();
    if (input && !input.disabled) input.focus();
  },

  setSendingState(sending, thinkText) {
    CynExtraApp.state.isGenerating = sending;
    const form = this.getForm();
    const sendButton = form?.querySelector(
      "[data-action='send-message'], [type='submit'], .chat-send-button"
    );
    if (sendButton) {
      sendButton.classList.toggle("is-loading", sending);
      sendButton.setAttribute("aria-busy", String(sending));
      if (sending) {
        sendButton.type = "button";
        sendButton.dataset.action = "stop-generating";
        sendButton.setAttribute("aria-label", "Stop generating");
        sendButton.title = "Stop generating";
        sendButton.disabled = false;
        sendButton.innerHTML = '<span class="stop-icon" aria-hidden="true"></span>';
      } else {
        sendButton.type = "submit";
        delete sendButton.dataset.action;
        sendButton.setAttribute("aria-label", "Send message");
        sendButton.title = "Send message";
        sendButton.innerHTML = '<span class="send-icon" aria-hidden="true"></span>';
      }
    }
    this.updateSendButtonState();
    if (sending) {
      this.showThinking(thinkText || "Preparing your request…");
      this.showTypingIndicator();
    } else {
      this.hideThinking();
      this.hideTypingIndicator();
    }
  },

  stopGenerating() {
    if (!CynExtraApp.state.isGenerating) return;
    const controller = CynExtraApp.state.abortController;
    CynExtraApp.state.abortController = null;
    if (controller) controller.abort();
    this.setSendingState(false);
    this.hideThinking();
    this.focusInput();
  },

  showThinking(text) {
    let panel = document.querySelector("[data-thinking-panel]");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "thinking-panel";
      panel.dataset.thinkingPanel = "";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      panel.innerHTML = `
        <div class="thinking-panel-header">
          <div class="thinking-panel-left">
            <span class="thinking-spinner" aria-hidden="true"></span>
            <img class="thinking-logo" src="assets/images/logo.png" alt="" width="22" height="22">
            <div>
              <strong class="thinking-title">CynExtra-AI is working</strong>
              <span class="thinking-subtitle">Live request status</span>
            </div>
          </div>
          <button type="button" class="thinking-toggle" data-action="toggle-thinking-detail" aria-expanded="true" title="Hide status">Details</button>
        </div>
        <div class="thinking-panel-body" data-thinking-body>
          <p class="thinking-status" data-thinking-status></p>
          <div class="thinking-task" data-thinking-task></div>
          <ul class="thinking-steps" data-thinking-steps></ul>
        </div>
      `;
      const area = document.querySelector(".chat-messages") || document.querySelector("[data-chat-view]") || document.body;
      area.appendChild(panel);
    }
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-visible", "is-expanded");
    const status = panel.querySelector("[data-thinking-status]");
    if (status) status.textContent = text || "Preparing your request…";
    const task = panel.querySelector("[data-thinking-task]");
    if (task) {
      const input = document.querySelector("[data-chat-input]");
      const attachments = Array.isArray(CynExtraApp.state.pendingAttachments) ? CynExtraApp.state.pendingAttachments : [];
      const summary = String(input?.value || "").trim() || (attachments.length ? `Analyze ${attachments.length} attached file${attachments.length === 1 ? "" : "s"}` : "Complete the requested task");
      task.textContent = `Task: ${summary.slice(0, 180)}`;
    }
    const steps = panel.querySelector("[data-thinking-steps]");
    if (steps) {
      const model = CynExtraApp.state.models.find((m) => m.id === CynExtraApp.state.currentModel)?.name || "Selected model";
      steps.innerHTML = `
        <li class="is-active">Preparing your request</li>
        <li>Sending it to ${model}</li>
        <li>Waiting for the model response</li>
        <li>Finalizing the answer</li>
      `;
    }
    panel.scrollIntoView({ behavior: "smooth", block: "end" });
  },

  updateThinkingStatus(text, activeIndex = 0) {
    const panel = document.querySelector("[data-thinking-panel]");
    if (!panel) return;
    const status = panel.querySelector("[data-thinking-status]");
    if (status && text) status.textContent = text;
    const items = panel.querySelectorAll("[data-thinking-steps] li");
    items.forEach((el, index) => {
      el.classList.toggle("is-active", index === activeIndex);
      el.classList.toggle("is-done", index < activeIndex);
    });
  },

  showTypingIndicator() {
    if (document.querySelector("[data-typing-indicator]")) return;
    const list = this.getMessagesContainer();
    if (!list) return;
    const article = document.createElement("article");
    article.className = "chat-message ai typing-message";
    article.dataset.typingIndicator = "";
    article.setAttribute("aria-label", "CynExtra-AI is generating a response");
    article.innerHTML = `
      <div class="message-inner">
        <div class="message-avatar ai-avatar" aria-hidden="true">
          <img src="assets/images/logo.png" alt="" width="32" height="32">
        </div>
        <div class="message-body">
          <div class="message-bubble typing-bubble">
            <span class="typing-label">CynExtra-AI is responding</span>
            <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </div>
        </div>
      </div>
    `;
    list.appendChild(article);
    article.scrollIntoView({ behavior: "smooth", block: "end" });
  },

  hideTypingIndicator() {
    const indicator = document.querySelector("[data-typing-indicator]");
    if (indicator) indicator.remove();
  },

  hideThinking() {
    if (this._thinkStepTimer) {
      clearInterval(this._thinkStepTimer);
      this._thinkStepTimer = null;
    }
    const panel = document.querySelector("[data-thinking-panel]");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      panel.classList.remove("is-visible");
    }
    const legacy = document.querySelector("[data-thinking-indicator]");
    if (legacy) {
      legacy.hidden = true;
      legacy.setAttribute("aria-hidden", "true");
    }
  },

  toggleThinkingDetail() {
    const panel = document.querySelector("[data-thinking-panel]");
    if (!panel) return;
    const expanded = panel.classList.toggle("is-expanded");
    const body = panel.querySelector("[data-thinking-body]");
    if (body) body.hidden = !expanded;
    const btn = panel.querySelector("[data-action='toggle-thinking-detail']");
    if (btn) {
      btn.textContent = expanded ? "Hide" : "Show";
      btn.setAttribute("aria-expanded", String(expanded));
      btn.title = expanded ? "Hide thinking" : "Show thinking";
    }
  },

  appendMessage(role, content, meta = {}) {
    const list = this.getMessagesContainer();
    if (!list) return null;
    const article = document.createElement("article");
    article.className = `chat-message ${role === "user" ? "user" : "ai"}`;
    article.dataset.chatMessage = "";
    article.dataset.messageRole = role;
    if (meta.id) article.dataset.messageId = String(meta.id);
    const formatContent = (raw, isUser) => {
      let s = String(raw ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (isUser) {
        return "<p>" + s.replace(/\n/g, "<br>") + "</p>";
      }
      // Generated media markers (URLs are escaped first and only http(s)/data image URLs are allowed).
      s = s.replace(/\[\[image:(https?:\/\/[^\s\]]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\]\]/g, '<img class="generated-image" src="$1" alt="Generated image" loading="lazy">');
      s = s.replace(/\[\[video:(https?:\/\/[^\s\]]+)\]\]/g, '<video class="generated-video" src="$1" controls preload="metadata"></video>');

      // Fenced code blocks
      s = s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const id = "code_" + Math.random().toString(36).slice(2, 9);
        return (
          '<div class="code-block" data-code-block>' +
          '<div class="code-block-header"><span class="code-lang">' +
          (lang || "code") +
          '</span><button type="button" class="code-copy" data-message-action="copy-code" data-code-id="' +
          id +
          '">Copy</button></div>' +
          '<pre id="' + id + '"><code>' + code.replace(/\n$/, "") + "</code></pre></div>"
        );
      });
      // Inline code
      s = s.replace(/`([^`\n]+)`/g, "<code class=\"inline-code\">$1</code>");
      // Bold / italic (simple)
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
      // Headings
      s = s.replace(/^### (.+)$/gm, "<h4>$1</h4>");
      s = s.replace(/^## (.+)$/gm, "<h3>$1</h3>");
      s = s.replace(/^# (.+)$/gm, "<h3>$1</h3>");
      // Unordered lists
      s = s.replace(/(?:^|\n)([-*] .+(\n[-*] .+)*)/g, (m) => {
        const items = m.trim().split(/\n/).map((l) => "<li>" + l.replace(/^[-*]\s+/, "") + "</li>").join("");
        return "<ul>" + items + "</ul>";
      });
      // Paragraphs / breaks
      s = s.replace(/\n\n/g, "</p><p>");
      s = s.replace(/\n/g, "<br>");
      if (!s.startsWith("<")) s = "<p>" + s + "</p>";
      return s;
    };
    const safe = formatContent(content, role === "user");
    if (role === "user") {
      article.innerHTML = `
        <div class="message-inner">
          <div class="message-avatar user-avatar" aria-hidden="true">C</div>
          <div class="message-body">
            <div class="message-bubble">
              <div class="message-text" data-message-content>${safe}</div>
            </div>
            <div class="message-actions user-message-actions" aria-label="Your message actions">
              <button class="message-action" type="button" data-message-action="edit" aria-label="Edit message">Edit</button>
              <button class="message-action" type="button" data-message-action="copy" aria-label="Copy message">Copy</button>
            </div>
          </div>
        </div>`;
    } else {
      article.innerHTML = `
        <div class="message-inner">
          <div class="message-avatar ai-avatar" aria-hidden="true">
            <img src="assets/images/logo.png" alt="CynExtra-AI" width="32" height="32">
          </div>
          <div class="message-body">
            <div class="assistant-message-head">
              <span class="assistant-name">CynExtra-AI</span>
              <span class="assistant-status-dot" aria-hidden="true"></span>
              <span class="assistant-mode-label">AI Assistant</span>
            </div>
            <div class="message-bubble">
              <div class="message-text" data-message-content>${safe}</div>
            </div>
            <div class="message-actions" aria-label="Assistant message actions">
              <button class="message-action" type="button" data-message-action="copy" aria-label="Copy message">Copy</button>
              <button class="message-action" type="button" data-message-action="like" aria-label="Like message">Like</button>
              <button class="message-action" type="button" data-message-action="dislike" aria-label="Dislike message">Dislike</button>
              <button class="message-action" type="button" data-message-action="read-aloud" aria-label="Read aloud">Read Aloud</button>
              <button class="message-action" type="button" data-message-action="share" aria-label="Share message">Share</button>
            </div>
          </div>
        </div>`;
    }
    list.appendChild(article);
    const n = list.querySelectorAll("[data-chat-message]").length;
    article.style.animationDelay = Math.min(n * 0.03, 0.3) + "s";
    requestAnimationFrame(() => {
      article.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    // The full response is already available here. Keep its content fully readable;
    // CSS handles only a short opacity/translate entrance animation.
    if (role !== "user" && meta.animate === false) article.classList.add("no-message-animation");
    return article;
  },

  // Reveals an already-rendered assistant message word-by-word so it looks
  // like CynExtra-AI is typing. This animates real, already-received content
  // only. It never fabricates tokens or simulates a live network stream.
  revealTyping(textEl) {
    // Kept for compatibility with existing callers. Do not blur or hide real
    // response text: the complete provider response should remain readable.
    if (!textEl) return;
    textEl.classList.add("response-ready");
  },

  async sendMessage(message) {
    const userId = CynExtraApp.auth.getState().userId;
    const hasAttachments = Array.isArray(CynExtraApp.state.pendingAttachments) && CynExtraApp.state.pendingAttachments.length > 0;
    const originalMessage = String(message || "").trim();
    const apiMessage = originalMessage || (hasAttachments ? "Please analyze the attached file(s)." : "");
    if (!apiMessage) {
      this.focusInput();
      return;
    }
    if (!userId) {
      CynExtraApp.navigate("login");
      return;
    }
    const userArticle = this.appendMessage("user", originalMessage || "Attached file(s)");
    this.clearInput();
    this.setSendingState(true, hasAttachments ? `Understanding your request and ${hasAttachments === 1 ? "the attached file" : "the attached files"}…` : "Understanding your request…");

    // Add / update sidebar history immediately
    const wasLocalOnly = !CynExtraApp.state.currentChatId;
    const historyId = CynExtraApp.state.currentChatId || "local_" + Date.now();
    if (wasLocalOnly) {
      CynExtraApp.state.currentChatId = historyId;
      CynExtraApp.safeStorageSet(CYNEXTRA.storage.chatId, historyId);
    }
    const shortTitle = String(originalMessage || "Attached file(s)").split(/\n/)[0].trim().slice(0, 42);
    CynExtraApp.history.add({
      id: historyId,
      title: shortTitle || "Attached file(s)",
      preview: "",
      updatedAt: new Date().toISOString()
    });

    const ultimateMeta = CynExtraApp.ultimate
      ? CynExtraApp.ultimate.getRequestMeta()
      : { ultimateMode: false };
    const body = {
      userId,
      message: apiMessage,
      modelId: CynExtraApp.state.currentModel,
      webSearch: Boolean(CynExtraApp.state.webSearchEnabled) || Boolean(ultimateMeta.ultimateWeb),
      toolAccess: CynExtraApp.state.toolAccess || "auto",
      attachments: CynExtraApp.state.pendingAttachments.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        text: item.kind === "text" ? item.text : null
      })),
      ...ultimateMeta
    };
    // A local_ ID is only a frontend placeholder. The backend must create
    // the real chat on the first message, so never send the placeholder ID.
    const currentChatId = CynExtraApp.state.currentChatId;
    if (currentChatId && !String(currentChatId).startsWith("local_")) {
      body.chatId = currentChatId;
    }

    let recoveredFromChatId = null;
    const controller = new AbortController();
    CynExtraApp.state.abortController = controller;
    this.updateThinkingStatus(`Working on: ${originalMessage ? originalMessage.slice(0, 120) : "your attached files"}`, 1);
    try {
      let result = await CynExtraApp.api("/chat", {
        method: "POST",
        body,
        signal: controller.signal
      });

      // If the saved server chat was deleted/reset elsewhere, recover by
      // starting a new server chat instead of surfacing "Chat not found."
      // The first request returned 404 before the backend could add the
      // message, so retrying without chatId is safe.
      if (
        result.status === 404 &&
        result.data?.error === "Chat not found." &&
        body.chatId
      ) {
        recoveredFromChatId = body.chatId;
        delete body.chatId;
        CynExtraApp.state.currentChatId = null;
        CynExtraApp.safeStorageRemove(CYNEXTRA.storage.chatId);
        result = await CynExtraApp.api("/chat", {
          method: "POST",
          body,
          signal: controller.signal
        });
      }

      const { ok, data, status } = result;
      this.updateThinkingStatus("The model has returned a response. Finalizing it…", 3);
      if (ok && data?.success && data.response?.content) {
        CynExtraApp.clearPendingAttachments();
        if (data.chat?.id) {
          const prevId = CynExtraApp.state.currentChatId || recoveredFromChatId;
          const serverId = data.chat.id;
          if (prevId && prevId !== serverId) {
            CynExtraApp.history.replaceId(prevId, serverId);
          }
          CynExtraApp.state.currentChatId = serverId;
          CynExtraApp.safeStorageSet(CYNEXTRA.storage.chatId, serverId);
          CynExtraApp.history.add({
            id: serverId,
            title: String(originalMessage || "Attached file(s)").split(/\n/)[0].trim().slice(0, 42) || "New chat",
            preview: String(data.response.content).slice(0, 80),
            updatedAt: new Date().toISOString()
          });
        }
        if (userArticle && data.message?.id) userArticle.dataset.messageId = String(data.message.id);
        this.appendMessage("assistant", data.response.content, { id: data.response?.id });
        // keep local message cache so sidebar open works instantly
        if (CynExtraApp.state.currentChatId) {
          CynExtraApp.history.snapshotCurrentChat(CynExtraApp.state.currentChatId);
        }
      } else {
        let errMsg =
          data?.error ||
          (status === 503
            ? "AI provider is not configured. Set AI_API_KEY in backend/.env"
            : status === 404
              ? "API route not found. Run: cd backend && npm install && npm start — then open http://localhost:3000"
              : "Could not get a response from the server.");
        if (data?.raw) errMsg = "Server returned an invalid response.";
        this.appendMessage("assistant", `⚠️ ${errMsg}`);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        this.appendMessage(
          "assistant",
          "⚠️ CynExtra-AI could not reach the backend. Check that the server is running, the API URL is correct, and your connection is stable."
        );
      }
    } finally {
      if (CynExtraApp.state.abortController === controller) {
        CynExtraApp.state.abortController = null;
      }
      this.setSendingState(false);
      this.focusInput();
    }
  },

  cancelEdit() {
    CynExtraApp.state.editingMessage = null;
    const banner = document.querySelector("[data-editing-banner]");
    if (banner) banner.remove();
    this.clearInput();
    this.focusInput();
  },

  beginEdit(messageArticle) {
    if (!messageArticle || messageArticle.dataset.messageRole !== "user") return;
    const messageId = messageArticle.dataset.messageId || "";
    const chatId = CynExtraApp.state.currentChatId || "";
    const text = messageArticle.querySelector("[data-message-content]")?.innerText?.trim() || "";
    if (!text) return;
    CynExtraApp.state.editingMessage = { messageId, chatId, text };
    let banner = document.querySelector("[data-editing-banner]");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "chat-editing-banner";
      banner.dataset.editingBanner = "";
      banner.innerHTML = '<span><strong>Editing message</strong><small>Update your prompt and send it again.</small></span><button type="button" data-action="cancel-edit" aria-label="Cancel editing">Cancel</button>';
      const form = this.getForm();
      if (form) form.insertBefore(banner, form.firstElementChild);
    }
    const input = this.getInput();
    if (input) {
      input.value = text;
      this.autoResizeInput();
      this.focusInput();
    }
  },

  async editMessage(message) {
    const edit = CynExtraApp.state.editingMessage;
    if (!edit) return this.sendMessage(message);
    if (!edit.chatId || !edit.messageId || String(edit.chatId).startsWith("local_")) {
      this.cancelEdit();
      return this.sendMessage(message);
    }
    const userId = CynExtraApp.auth.getState().userId;
    if (!userId) { this.cancelEdit(); this.navigate("login"); return; }
    this.setSendingState(true, "Updating your message…");
    const controller = new AbortController();
    CynExtraApp.state.abortController = controller;
    this.updateThinkingStatus(`Working on: ${originalMessage ? originalMessage.slice(0, 120) : "your attached files"}`, 1);
    try {
      const ultimateMeta = CynExtraApp.ultimate ? CynExtraApp.ultimate.getRequestMeta() : { ultimateMode: false };
      const result = await CynExtraApp.api(
        "/chats/" + encodeURIComponent(edit.chatId) + "/messages/" + encodeURIComponent(edit.messageId) + "/edit",
        {
          method: "POST",
          body: {
            userId,
            message,
            modelId: CynExtraApp.state.currentModel,
            webSearch: Boolean(CynExtraApp.state.webSearchEnabled) || Boolean(ultimateMeta.ultimateWeb),
            ...ultimateMeta
          },
          signal: controller.signal
        }
      );
      if (!result.ok || !result.data?.success) {
        this.appendMessage("assistant", "⚠️ " + (result.data?.error || "Could not edit this message."));
        return;
      }
      this.history.cacheMessages(edit.chatId, result.data.messages || []);
      this.history.showMessages(result.data.messages || []);
      this.history.update(edit.chatId, {
        title: String(message).split(/\n/)[0].trim().slice(0, 42) || "Chat",
        preview: String(result.data.response?.content || "").slice(0, 80)
      });
      this.cancelEdit();
      CynExtraApp.state.currentChatId = edit.chatId;
      CynExtraApp.safeStorageSet(CYNEXTRA.storage.chatId, edit.chatId);
    } catch (error) {
      if (error?.name !== "AbortError") this.appendMessage("assistant", "⚠️ Network error while editing the message.");
    } finally {
      if (CynExtraApp.state.abortController === controller) CynExtraApp.state.abortController = null;
      this.setSendingState(false);
      this.focusInput();
    }
  },

  handleSubmit(event) {
    const form = event.target.closest("[data-chat-form]");
    if (!form) return;
    event.preventDefault();
    if (CynExtraApp.state.isGenerating) return;
    const input = form.querySelector("[data-chat-input]");
    if (!input) return;
    const message = String(input.value || "").trim();
    if (!message) {
      this.focusInput();
      return;
    }
    if (CynExtraApp.state.editingMessage) {
      this.editMessage(message);
      return;
    }
    this.sendMessage(message);
  },

  handleKeydown(event) {
    const input = event.target.closest("[data-chat-input]");
    if (!input) return;
    if (event.isComposing || input.dataset.composing === "1") return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const form = input.form || this.getForm();
      if (form) form.requestSubmit();
    }
  },

  toggleWebSearch() {
    CynExtraApp.state.webSearchEnabled = !CynExtraApp.state.webSearchEnabled;
    document.querySelectorAll("[data-action='toggle-web-search']").forEach((btn) => {
      btn.classList.toggle("is-active", CynExtraApp.state.webSearchEnabled);
      btn.setAttribute("aria-pressed", String(CynExtraApp.state.webSearchEnabled));
    });
    const badge = document.querySelector("[data-search-badge]");
    if (badge) badge.hidden = !CynExtraApp.state.webSearchEnabled;
  },

  handlePlusAction(element) {
    const action = element?.dataset.plusAction;
    if (!action) return;
    if (action === "web-search") {
      this.toggleWebSearch();
      const stateEl = document.querySelector('[data-state-for="webSearch"]');
      if (stateEl) {
        stateEl.textContent = CynExtraApp.state.webSearchEnabled ? "On" : "Off";
        stateEl.classList.toggle("is-on", CynExtraApp.state.webSearchEnabled);
      }
      element.classList.toggle("is-active", CynExtraApp.state.webSearchEnabled);
      return; // keep menu open so user sees toggle state
    }
    CynExtraApp.closePlusMenu();
    if (action === "camera") CynExtraApp.openFilePicker("camera");
    else if (action === "photo") CynExtraApp.openFilePicker("photo");
    else if (action === "file") CynExtraApp.openFilePicker("file");
    else if (action === "plugin") CynExtraApp.navigate("plugins");
    else if (action === "think-harder") {
      const think = CynExtraApp.state.models.find((m) => m.id === "cynextra-think");
      if (think) this.models.select("cynextra-think");
      else {
        const status = document.querySelector("[data-model-status]");
        if (status) status.textContent = "Think mode is not available on the current plan/provider.";
      }
    } else if (action === "project") {
      CynExtraApp.navigate("projects");
    } else if (action === "connectors") {
      CynExtraApp.navigate("plugins");
    } else if (action === "tool-access") {
      const modes = ["auto", "safe", "off"];
      const cur = CynExtraApp.state.toolAccess || "auto";
      const next = modes[(modes.indexOf(cur) + 1) % modes.length];
      CynExtraApp.state.toolAccess = next;
      CynExtraApp.safeStorageSet("cynextra_tool_access", next);
      const el = document.querySelector('[data-state-for="tools"]');
      if (el) el.textContent = next === "off" ? "Off" : next === "safe" ? "Safe" : "Auto";
    }
  }
};

CynExtraApp.openFilePicker = function (type) {
  const selectorMap = {
    camera: "[data-file-input='camera']",
    photo: "[data-file-input='photo']",
    file: "[data-file-input='file']"
  };
  const input = document.querySelector(selectorMap[type]);
  if (!input) return;
  if (type === "camera") {
    if (!input.accept) input.accept = "image/*";
    input.setAttribute("capture", "environment");
  } else if (type === "photo") {
    if (!input.accept) input.accept = "image/*";
    input.removeAttribute("capture");
  }
  input.click();
};

CynExtraApp.renderAttachmentTray = function () {
  const tray = document.querySelector("[data-attachment-tray]");
  const list = document.querySelector("[data-attachment-list]");
  if (!tray || !list) return;
  const items = Array.isArray(this.state.pendingAttachments) ? this.state.pendingAttachments : [];
  list.innerHTML = "";
  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "chat-attachment-item";
    card.dataset.attachmentIndex = String(index);
    if (item.kind === "image" && item.previewUrl) {
      const img = document.createElement("img");
      img.className = "chat-attachment-thumb";
      img.src = item.previewUrl;
      img.alt = item.name || "Selected image";
      img.loading = "lazy";
      card.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "chat-attachment-file-icon";
      icon.textContent = "FILE";
      card.appendChild(icon);
    }
    const meta = document.createElement("div");
    meta.className = "chat-attachment-meta";
    const name = document.createElement("strong");
    name.textContent = item.name || "Attachment";
    const kind = document.createElement("small");
    kind.textContent = item.kind === "image" ? "Image" : "File";
    meta.append(name, kind);
    card.appendChild(meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-attachment-remove";
    remove.dataset.action = "remove-attachment";
    remove.dataset.attachmentIndex = String(index);
    remove.setAttribute("aria-label", `Remove ${item.name || "attachment"}`);
    remove.textContent = "×";
    card.appendChild(remove);
    list.appendChild(card);
  });
  tray.hidden = items.length === 0;
  this.updateSendButtonState();
};

CynExtraApp.removeAttachment = function (index) {
  const items = this.state.pendingAttachments || [];
  const item = items[index];
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  items.splice(index, 1);
  this.renderAttachmentTray();
};

CynExtraApp.clearPendingAttachments = function () {
  (this.state.pendingAttachments || []).forEach((item) => {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  this.state.pendingAttachments = [];
  this.renderAttachmentTray();
};

CynExtraApp.handleFileSelection = async function (input) {
  if (!input?.files) return;
  const files = Array.from(input.files);
  if (!files.length) return;
  const userId = this.auth.getState().userId;
  if (!userId) {
    this.navigate("login");
    return;
  }
  const status = document.querySelector("[data-attachment-status]");
  const tray = document.querySelector("[data-attachment-tray]");
  if (tray) tray.hidden = false;
  if (status) {
    status.hidden = false;
    status.textContent = "Uploading selected file(s)…";
  }
  try {
    for (const file of files.slice(0, 5)) {
      if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: file is larger than 12 MB.`);
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
      });
      const result = await this.api("/files/process", {
        method: "POST",
        body: { userId, name: file.name, mimeType: file.type, data }
      });
      if (!result.ok || !result.data?.success) {
        throw new Error(result.data?.error || `Could not upload ${file.name}.`);
      }
      const uploaded = result.data.file;
      this.state.pendingAttachments.push({
        id: uploaded.id,
        name: uploaded.name,
        kind: uploaded.kind,
        text: uploaded.kind === "text" ? (uploaded.text || "") : null,
        previewUrl: uploaded.kind === "image" ? URL.createObjectURL(file) : null
      });
      this.renderAttachmentTray();
      if (status) {
        status.textContent = uploaded.aiContextSupported
          ? `${uploaded.name} attached.`
          : `${uploaded.name} uploaded. The current AI provider cannot analyze image pixels.`;
      }
    }
    this.dispatch("cynextra:file-selected", {
      files,
      source: input.dataset.fileInput || "file"
    });
  } catch (error) {
    if (status) {
      status.hidden = false;
      status.textContent = error.message || "File upload failed.";
    }
    this.renderAttachmentTray();
    const currentTray = document.querySelector("[data-attachment-tray]");
    if (currentTray && !(this.state.pendingAttachments || []).length) currentTray.hidden = false;
  } finally {
    input.value = "";
  }
};

/* ============================================================
   MESSAGE ACTIONS / AUTH FORMS / SETTINGS / PROFILE
   ============================================================ */

CynExtraApp.voice = {
  recognition: null,
  start() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      this.setStatus("Voice input is not supported by this browser/device.");
      return false;
    }
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
      return false;
    }
    const input = document.querySelector("[data-chat-input]");
    if (!input) return false;
    const recognition = new Recognition();
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => this.setStatus("Listening…");
    recognition.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i][0]?.transcript || "";
      }
      if (text.trim()) {
        input.value = `${input.value ? `${input.value} ` : ""}${text.trim()}`;
        CynExtraApp.chat.autoResizeInput();
      }
    };
    recognition.onerror = () => this.setStatus("Voice input failed or permission was denied.");
    recognition.onend = () => {
      this.recognition = null;
      this.setStatus("");
    };
    this.recognition = recognition;
    recognition.start();
    return true;
  },
  setStatus(text) {
    const el = document.querySelector("[data-voice-status]");
    if (el) {
      el.textContent = text || "";
      el.hidden = !text;
    }
  }
};

CynExtraApp.messageActions = {
  getMessage(button) {
    return button?.closest("[data-chat-message]") || null;
  },
  getText(message) {
    return message?.querySelector("[data-message-content]")?.innerText?.trim() || "";
  },
  async copyMessage(button) {
    const text = this.getText(this.getMessage(button));
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      button.classList.add("is-success");
      const originalLabel = button.dataset.copyLabel || button.textContent.trim() || "Copy";
      button.dataset.copyLabel = originalLabel;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.classList.remove("is-success");
        button.textContent = originalLabel;
      }, 1200);
      return true;
    } catch {
      return false;
    }
  },
  startEdit(button) {
    const message = this.getMessage(button);
    if (message) CynExtraApp.chat.beginEdit(message);
  },
  readAloud(button) {
    if (!("speechSynthesis" in window)) return false;
    const text = this.getText(this.getMessage(button));
    if (!text) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
    return true;
  },
  async shareMessage(button) {
    const text = this.getText(this.getMessage(button));
    if (!text) return false;
    if (navigator.share) {
      try {
        await navigator.share({ title: "CynExtra-AI", text });
        return true;
      } catch {
        /* cancelled */
      }
    }
    return this.copyMessage(button);
  },
  handle(button, event) {
    const action = button.dataset.messageAction;
    if (!action) return;
    event.preventDefault();
    if (action === "copy") {
      this.copyMessage(button);
      return;
    }
    if (action === "edit") {
      this.startEdit(button);
      return;
    }
    if (action === "copy-code") {
      const id = button.dataset.codeId;
      const pre = id ? document.getElementById(id) : button.closest("[data-code-block]")?.querySelector("pre");
      const text = pre?.innerText || "";
      if (!text) return;
      (async () => {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
          button.classList.add("is-success");
          button.textContent = "Copied";
          setTimeout(() => {
            button.classList.remove("is-success");
            button.textContent = "Copy";
          }, 1200);
        } catch {}
      })();
      return;
    }
    if (action === "read-aloud") {
      this.readAloud(button);
      return;
    }
    if (action === "share") {
      this.shareMessage(button);
      return;
    }
    if (action === "like" || action === "dislike") {
      const message = this.getMessage(button);
      if (message) {
        message
          .querySelectorAll("[data-message-action='like'], [data-message-action='dislike']")
          .forEach((item) => {
            if (item !== button) item.classList.remove("is-selected");
          });
      }
      button.classList.toggle("is-selected");
      CynExtraApp.dispatch("cynextra:message-feedback", { action, message });
    }
  }
};

/* ============================================================
   CHAT HISTORY (sidebar)
   ============================================================ */

CynExtraApp.history = {
  storageKey: "cynextra_chat_history",
  messagesKey: "cynextra_chat_messages_cache",
  projectsKey: "cynextra_projects",
  longPressTimer: null,
  longPressTarget: null,
  _opening: false,
  suppressHistoryClickUntil: 0,

  getAll() {
    const raw = CynExtraApp.parseJSON(
      CynExtraApp.safeStorageGet(this.storageKey, "[]"),
      []
    );
    return Array.isArray(raw) ? raw : [];
  },

  saveAll(items) {
    const sorted = (items || []).slice(0, 60);
    sorted.sort((a, b) => {
      const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pin) return pin;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    CynExtraApp.safeStorageSet(this.storageKey, JSON.stringify(sorted));
  },

  getMessageCache() {
    const raw = CynExtraApp.parseJSON(
      CynExtraApp.safeStorageGet(this.messagesKey, "{}"),
      {}
    );
    return raw && typeof raw === "object" ? raw : {};
  },

  saveMessageCache(cache) {
    // keep only recent 40 chats worth of messages
    const ids = Object.keys(cache || {});
    if (ids.length > 40) {
      const keep = new Set(this.getAll().map((i) => i.id));
      ids.forEach((id) => {
        if (!keep.has(id)) delete cache[id];
      });
    }
    CynExtraApp.safeStorageSet(this.messagesKey, JSON.stringify(cache));
  },

  cacheMessages(chatId, messages) {
    if (!chatId || !Array.isArray(messages)) return;
    const cache = this.getMessageCache();
    cache[chatId] = messages.map((m) => ({
      id: m.id || null,
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content || "")
    })).slice(-80);
    this.saveMessageCache(cache);
  },

  getCachedMessages(chatId) {
    if (!chatId) return [];
    const cache = this.getMessageCache();
    return Array.isArray(cache[chatId]) ? cache[chatId] : [];
  },

  add(entry) {
    if (!entry || !entry.title) return;
    const existing = this.getAll().find((i) => i.id === entry.id);
    const items = this.getAll().filter((i) => i.id !== entry.id);
    const activeProject = CynExtraApp.state.activeProject || null;
    items.unshift({
      id: entry.id || "chat_" + Date.now(),
      title: String(entry.title).split(/\n/)[0].trim().slice(0, 42) || "New chat",
      preview: entry.preview != null ? String(entry.preview).slice(0, 80) : (existing?.preview || ""),
      pinned: existing ? Boolean(existing.pinned) : Boolean(entry.pinned),
      projectId: existing?.projectId || entry.projectId || activeProject?.id || null,
      projectName: existing?.projectName || entry.projectName || activeProject?.name || null,
      updatedAt: entry.updatedAt || new Date().toISOString()
    });
    this.saveAll(items);
    this.render();
  },

  update(id, patch) {
    const items = this.getAll().map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() } : item
    );
    this.saveAll(items);
    this.render();
  },

  remove(id) {
    this.saveAll(this.getAll().filter((item) => item.id !== id));
    const cache = this.getMessageCache();
    if (cache[id]) {
      delete cache[id];
      this.saveMessageCache(cache);
    }
    if (CynExtraApp.state.currentChatId === id) {
      CynExtraApp.state.currentChatId = null;
      CynExtraApp.safeStorageRemove(CYNEXTRA.storage.chatId);
    }
    // also delete on server when possible
    const userId = CynExtraApp.auth.getState().userId;
    if (userId && id && !String(id).startsWith("local_")) {
      CynExtraApp.api(
        "/chats/" + encodeURIComponent(id) + "?userId=" + encodeURIComponent(userId),
        { method: "DELETE" }
      ).catch(() => {});
    }
    this.render();
  },

  pin(id) {
    const item = this.getAll().find((i) => i.id === id);
    if (!item) return;
    this.update(id, { pinned: !item.pinned });
  },

  replaceId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const items = this.getAll().map((item) =>
      item.id === oldId ? { ...item, id: newId } : item
    );
    // dedupe
    const seen = new Set();
    const deduped = [];
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }
    this.saveAll(deduped);
    const cache = this.getMessageCache();
    if (cache[oldId]) {
      cache[newId] = cache[oldId];
      delete cache[oldId];
      this.saveMessageCache(cache);
    }
    if (CynExtraApp.state.currentChatId === oldId) {
      CynExtraApp.state.currentChatId = newId;
      CynExtraApp.safeStorageSet(CYNEXTRA.storage.chatId, newId);
    }
    this.render();
  },

  addToProject(id) {
    const existingProjects = this.getProjects();
    const suggestion = existingProjects[0]?.name || "My Project";
    const title = prompt("Project name for this chat:", suggestion);
    if (title === null) return;
    const projectName = String(title).trim().slice(0, 60) || "My Project";
    // Reuse project with same name if exists
    let project = existingProjects.find(
      (p) => String(p.name).toLowerCase() === projectName.toLowerCase()
    );
    if (!project) {
      project = {
        id: "proj_" + Date.now().toString(36),
        name: projectName,
        chatIds: [],
        createdAt: new Date().toISOString()
      };
      existingProjects.unshift(project);
    }
    if (!Array.isArray(project.chatIds)) project.chatIds = [];
    if (!project.chatIds.includes(id)) project.chatIds.unshift(id);
    // legacy single chatId field
    project.chatId = id;
    project.updatedAt = new Date().toISOString();
    CynExtraApp.safeStorageSet(this.projectsKey, JSON.stringify(existingProjects.slice(0, 40)));
    this.update(id, { projectId: project.id, projectName: project.name });
    // Optionally set as active project so next chats join it
    CynExtraApp.state.activeProject = { id: project.id, name: project.name };
    CynExtraApp.safeStorageSet(
      "cynextra_active_project",
      JSON.stringify(CynExtraApp.state.activeProject)
    );
    this.closeContextMenu();
    this.render();
  },

  getProjects() {
    const raw = CynExtraApp.parseJSON(
      CynExtraApp.safeStorageGet(this.projectsKey, "[]"),
      []
    );
    return Array.isArray(raw) ? raw : [];
  },

  setActiveProject(project) {
    if (!project || !project.id) {
      CynExtraApp.state.activeProject = null;
      CynExtraApp.safeStorageRemove("cynextra_active_project");
    } else {
      CynExtraApp.state.activeProject = { id: project.id, name: project.name || "Project" };
      CynExtraApp.safeStorageSet(
        "cynextra_active_project",
        JSON.stringify(CynExtraApp.state.activeProject)
      );
    }
    this.render();
  },

  ensureSidebarSection() {
    const sidebar = document.querySelector("[data-sidebar] .sidebar-inner");
    if (!sidebar) return;
    if (document.querySelector("[data-chat-history]")) return;

    const section = document.createElement("section");
    section.className = "sidebar-section sidebar-history-section";
    section.setAttribute("aria-label", "Chat history");
    section.innerHTML = `
      <div class="sidebar-section-label sidebar-history-label">
        <span class="sidebar-history-label-text">
          <span class="sidebar-history-dot" aria-hidden="true"></span>
          HISTORY
        </span>
        <button type="button" class="sidebar-history-new" data-action="new-chat" title="New chat" aria-label="New chat">+</button>
      </div>
      <div class="sidebar-history-active-project" data-active-project-bar hidden></div>
      <div class="sidebar-history-list" data-chat-history></div>
    `;

    // Prefer: after main nav, before Ultimate / bottom
    const nav = sidebar.querySelector(".sidebar-navigation, nav.sidebar-nav, .sidebar-nav");
    const bottom = sidebar.querySelector(".sidebar-bottom");
    const sections = sidebar.querySelectorAll(".sidebar-section");
    let ultimate = null;
    sections.forEach((s) => {
      if (s.querySelector(".mode-card") || /ultimate/i.test(s.textContent || "")) {
        ultimate = s;
      }
    });
    if (nav && nav.parentNode) {
      const anchor = ultimate || bottom || nav.nextSibling;
      if (anchor) sidebar.insertBefore(section, anchor);
      else nav.parentNode.insertBefore(section, nav.nextSibling);
    } else if (bottom) {
      sidebar.insertBefore(section, bottom);
    } else {
      sidebar.appendChild(section);
    }
  },

  render() {
    this.ensureSidebarSection();
    const list = document.querySelector("[data-chat-history]");
    if (!list) return;
    const items = this.getAll();
    const current = CynExtraApp.state.currentChatId;

    // Active project bar
    const bar = document.querySelector("[data-active-project-bar]");
    if (bar) {
      const ap = CynExtraApp.state.activeProject;
      if (ap && ap.id) {
        bar.hidden = false;
        bar.innerHTML = `<span class="active-project-chip">${String(ap.name || "Project").replace(/</g, "&lt;")}
          <button type="button" class="active-project-clear" data-action="clear-active-project" title="Clear project filter">Close</button></span>`;
      } else {
        bar.hidden = true;
        bar.innerHTML = "";
      }
    }

    if (!items.length) {
      list.innerHTML = `
        <div class="sidebar-history-empty">
          <p>No conversations yet</p>
          <button type="button" class="sidebar-history-empty-cta" data-action="new-chat">Start a chat</button>
        </div>`;
      return;
    }

    // Group by project
    const unassigned = [];
    const byProject = new Map();
    items.forEach((item) => {
      if (item.projectId && item.projectName) {
        if (!byProject.has(item.projectId)) {
          byProject.set(item.projectId, { name: item.projectName, items: [] });
        }
        byProject.get(item.projectId).items.push(item);
      } else {
        unassigned.push(item);
      }
    });

    const renderItem = (item) => {
      const title = String(item.title || "New conversation")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const preview = String(item.preview || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const active = current && item.id === current ? " is-active" : "";
      const pin = item.pinned ? " is-pinned" : "";
      return `
      <button type="button" class="sidebar-history-item${pin}${active}" data-history-id="${item.id}" title="${title}">
        <span class="sidebar-history-icon" aria-hidden="true">${item.pinned ? "P" : "C"}</span>
        <span class="sidebar-history-text">
          <span class="sidebar-history-title">${title}</span>
          ${preview ? `<span class="sidebar-history-preview">${preview}</span>` : ""}
        </span>
        <span class="sidebar-history-more" data-history-more="${item.id}" title="More" aria-label="Chat options">More</span>
      </button>`;
    };

    let html = "";
    byProject.forEach((group) => {
      const name = String(group.name)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;");
      html += `<div class="sidebar-history-group">
        <div class="sidebar-history-group-label">${name}</div>
        ${group.items.map(renderItem).join("")}
      </div>`;
    });
    if (unassigned.length) {
      if (byProject.size) {
        html += `<div class="sidebar-history-group-label sidebar-history-group-label--plain">Chats</div>`;
      }
      html += unassigned.map(renderItem).join("");
    }

    list.innerHTML = html;
    this.bindLongPress(list);
  },

  bindLongPress(list) {
    if (list.dataset.longPressBound === "1") return;
    list.dataset.longPressBound = "1";

    const clearTimer = () => {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      this.longPressTarget = null;
    };

    const startPress = (item, x, y) => {
      clearTimer();
      this.longPressTarget = item;
      this._lpX = x;
      this._lpY = y;
      this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = null;
        this.suppressHistoryClickUntil = Date.now() + 1200;
        item.dataset.longPressed = "1";
        this.openContextMenu(item, x, y);
      }, 600);
    };

    const cancelPress = () => clearTimer();

    list.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("[data-history-more]")) return;
      const item = e.target.closest("[data-history-id]");
      if (!item) return;
      startPress(item, e.clientX, e.clientY);
    }, { passive: true });

    list.addEventListener("pointerup", cancelPress, { passive: true });
    list.addEventListener("pointercancel", cancelPress, { passive: true });
    list.addEventListener("pointerleave", cancelPress, { passive: true });
    list.addEventListener("pointermove", (e) => {
      if (!this.longPressTarget || this.longPressTimer == null) return;
      const dx = Math.abs(e.clientX - (this._lpX || 0));
      const dy = Math.abs(e.clientY - (this._lpY || 0));
      if (dx > 14 || dy > 14) cancelPress();
    }, { passive: true });

    // Android WebView/older browsers can expose touch events separately from
    // pointer events. Keep a dedicated touch path so long-press is reliable.
    list.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || e.target.closest("[data-history-more]")) return;
      const item = e.target.closest("[data-history-id]");
      if (!item) return;
      const touch = e.touches[0];
      startPress(item, touch.clientX, touch.clientY);
    }, { passive: true });
    list.addEventListener("touchend", cancelPress, { passive: true });
    list.addEventListener("touchcancel", cancelPress, { passive: true });
    list.addEventListener("touchmove", (e) => {
      if (!this.longPressTarget || this.longPressTimer == null || !e.touches[0]) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - (this._lpX || 0));
      const dy = Math.abs(touch.clientY - (this._lpY || 0));
      if (dx > 14 || dy > 14) cancelPress();
    }, { passive: true });

    list.addEventListener("contextmenu", (e) => {
      const item = e.target.closest("[data-history-id]");
      if (!item) return;
      e.preventDefault();
      this.suppressHistoryClickUntil = Date.now() + 1200;
      this.openContextMenu(item, e.clientX, e.clientY);
    });

    list.addEventListener("click", (e) => {
      const more = e.target.closest("[data-history-more]");
      if (!more) return;
      e.preventDefault();
      e.stopPropagation();
      const id = more.dataset.historyMore;
      const item = list.querySelector(`[data-history-id="${CSS && CSS.escape ? CSS.escape(id) : id}"]`);
      if (item) {
        const rect = more.getBoundingClientRect();
        this.openContextMenu(item, rect.left, rect.bottom + 4);
      }
    });
  },

  openContextMenu(item, x, y) {
    this.closeContextMenu();
    const id = item.dataset.historyId;
    if (!id) return;
    const entry = this.getAll().find((i) => i.id === id);
    const menu = document.createElement("div");
    menu.className = "history-context-menu";
    menu.dataset.historyMenu = "";
    menu.innerHTML = `
      <button type="button" data-history-action="open" data-id="${id}">Open chat</button>
      <button type="button" data-history-action="pin" data-id="${id}">
        ${entry?.pinned ? "Unpin chat" : "Pin chat"}
      </button>
      <button type="button" data-history-action="project" data-id="${id}">
        Add to project
      </button>
      <button type="button" data-history-action="delete" data-id="${id}" class="is-danger">
        Delete chat
      </button>
      <button type="button" data-history-action="cancel">Cancel</button>
    `;
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(12, x - rect.width / 2), window.innerWidth - rect.width - 12);
    const top = Math.min(Math.max(12, y - 8), window.innerHeight - rect.height - 12);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    item.classList.add("is-context-open");

    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-history-action]");
      if (!btn) return;
      const action = btn.dataset.historyAction;
      const targetId = btn.dataset.id;
      if (action === "cancel") {
        this.closeContextMenu();
        return;
      }
      if (action === "open") {
        this.closeContextMenu();
        this.openChat(targetId);
        return;
      }
      if (action === "pin") {
        this.pin(targetId);
        this.closeContextMenu();
        return;
      }
      if (action === "project") {
        this.addToProject(targetId);
        return;
      }
      if (action === "delete") {
        if (confirm("Delete this chat from history?")) {
          this.remove(targetId);
        }
        this.closeContextMenu();
      }
    });

    window.setTimeout(() => {
      const closer = (ev) => {
        if (ev.target.closest("[data-history-menu], .history-context-menu")) return;
        this.closeContextMenu();
        document.removeEventListener("pointerdown", closer, true);
      };
      document.addEventListener("pointerdown", closer, true);
    }, 0);
  },

  closeContextMenu() {
    document.querySelectorAll(".history-context-menu").forEach((el) => el.remove());
    document
      .querySelectorAll(".sidebar-history-item.is-context-open")
      .forEach((el) => {
        el.classList.remove("is-context-open");
        delete el.dataset.longPressed;
      });
  },

  showMessages(messages) {
    const list = CynExtraApp.chat.getMessagesContainer();
    if (!list) return;
    list.innerHTML = "";
    if (!messages || !messages.length) {
      CynExtraApp.chat.appendMessage(
        "assistant",
        "This conversation is empty. Send a message to continue."
      );
      return;
    }
    messages.forEach((m) => {
      CynExtraApp.chat.appendMessage(
        m.role === "user" ? "user" : "assistant",
        m.content,
        { id: m.id }
      );
    });
  },

  async openChat(id) {
    if (!id || this._opening) return;
    this._opening = true;
    try {
      CynExtraApp.state.currentChatId = id;
      CynExtraApp.safeStorageSet(CYNEXTRA.storage.chatId, id);
      this.render(); // highlight active
      CynExtraApp.closeSidebar();

      // 1) Instant paint from local cache
      const cached = this.getCachedMessages(id);
      if (cached.length) {
        this.showMessages(cached);
      } else {
        const list = CynExtraApp.chat.getMessagesContainer();
        if (list) {
          list.innerHTML = `<div class="chat-history-loading">Loading conversation…</div>`;
        }
      }

      // 2) Server refresh when possible
      const userId = CynExtraApp.auth.getState().userId;
      if (userId && !String(id).startsWith("local_")) {
        const { ok, data } = await CynExtraApp.api(
          "/chats/" + encodeURIComponent(id) + "?userId=" + encodeURIComponent(userId)
        );
        if (ok && data?.success) {
          const messages = (data.messages || []).map((m) => ({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            content: m.content
          }));
          this.cacheMessages(id, messages);
          this.showMessages(messages);
          const firstUser = messages.find((m) => m.role === "user");
          if (firstUser) {
            this.update(id, {
              title: String(firstUser.content).split(/\n/)[0].trim().slice(0, 42) || "Chat",
              preview: messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content?.slice(0, 80) || ""
            });
          }
        } else if (!cached.length) {
          this.showMessages([]);
        }
      } else if (!cached.length) {
        this.showMessages([]);
      }

      CynExtraApp.chat.focusInput();
    } finally {
      this._opening = false;
    }
  },

  startNewChat() {
    CynExtraApp.state.currentChatId = null;
    CynExtraApp.safeStorageRemove(CYNEXTRA.storage.chatId);
    const list = CynExtraApp.chat.getMessagesContainer();
    if (list) {
      list.innerHTML = "";
      CynExtraApp.chat.appendMessage(
        "assistant",
        "Welcome to CynExtra-AI.\n\nTell me what you’re working on — I can explain, build, debug, analyze files, or help you plan the next step."
      );
    }
    this.render();
    CynExtraApp.closeSidebar();
    CynExtraApp.chat.focusInput();
  },

  /** Snapshot current DOM messages into cache for current chat */
  snapshotCurrentChat(chatId) {
    if (!chatId) return;
    const list = CynExtraApp.chat.getMessagesContainer();
    if (!list) return;
    const nodes = list.querySelectorAll("[data-chat-message]");
    const messages = [];
    nodes.forEach((node) => {
      const role = node.dataset.messageRole === "user" ? "user" : "assistant";
      const content = node.querySelector("[data-message-content]")?.innerText?.trim() || "";
      if (content) messages.push({ role, content });
    });
    this.cacheMessages(chatId, messages);
  },

  async loadFromServer() {
    const userId = CynExtraApp.auth.getState().userId;
    if (!userId) {
      this.render();
      return;
    }
    try {
      const { ok, data } = await CynExtraApp.api(
        "/chats?userId=" + encodeURIComponent(userId)
      );
      if (ok && data?.success && Array.isArray(data.chats)) {
        const local = this.getAll();
        const pinMap = {};
        local.forEach((i) => {
          pinMap[i.id] = {
            pinned: i.pinned,
            projectId: i.projectId,
            projectName: i.projectName,
            preview: i.preview
          };
        });
        const mapped = data.chats
          .slice()
          .sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
          )
          .slice(0, 50)
          .map((c) => {
            const firstUser = (c.messages || []).find((m) => m.role === "user");
            const lastAsst = [...(c.messages || [])]
              .reverse()
              .find((m) => m.role === "assistant");
            const prev = pinMap[c.id] || {};
            return {
              id: c.id,
              title: String(firstUser?.content || c.title || "New chat")
                .split(/\n/)[0]
                .trim()
                .slice(0, 42),
              preview: String(prev.preview || lastAsst?.content || "").slice(0, 80),
              pinned: Boolean(prev.pinned),
              projectId: prev.projectId || null,
              projectName: prev.projectName || null,
              updatedAt: c.updatedAt
            };
          });
        const serverIds = new Set(mapped.map((m) => m.id));
        const localsOnly = local.filter(
          (i) => String(i.id).startsWith("local_") && !serverIds.has(i.id)
        );
        const merged = [...mapped, ...localsOnly];
        this.saveAll(merged);
        // Cache message bodies from list payload when available
        data.chats.forEach((c) => {
          if (c.id && Array.isArray(c.messages) && c.messages.length) {
            this.cacheMessages(c.id, c.messages);
          }
        });
      }
    } catch {
      /* local history still works */
    }
    this.render();
  }
};



CynExtraApp.authForms = {
  getStatusElement(form) {
    if (!form) return null;
    let status = form.querySelector("[data-auth-status]");
    if (!status) {
      status = document.createElement("p");
      status.dataset.authStatus = "";
      status.setAttribute("role", "status");
      form.appendChild(status);
    }
    return status;
  },
  setStatus(form, message, type = "info") {
    const status = this.getStatusElement(form);
    if (!status) return;
    status.textContent = message;
    status.dataset.statusType = type;
    status.classList.add("is-visible");
  },
  getField(form, name, fallbackSelector = null) {
    if (!form) return null;
    return (
      form.querySelector(`[name="${CynExtraApp.escapeSelectorValue(name)}"]`) ||
      (fallbackSelector ? form.querySelector(fallbackSelector) : null)
    );
  },
  getAccounts() {
    const raw = CynExtraApp.safeStorageGet(CYNEXTRA.storage.accounts, "[]");
    const parsed = CynExtraApp.parseJSON(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  },
  saveAccounts(accounts) {
    return CynExtraApp.safeStorageSet(CYNEXTRA.storage.accounts, JSON.stringify(accounts));
  },
  validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },
  async createAccount(form) {
    const nameField = this.getField(form, "name", "#signup-name");
    const emailField = this.getField(form, "email", "#signup-email");
    const passwordField = this.getField(form, "password", "#signup-password");
    const confirmField = form.querySelector("[data-confirm-password]") || this.getField(form, "confirmPassword", "#signup-confirm-password");
    const termsField = form.querySelector("[name='terms']") || form.querySelector("#signup-terms");
    const name = String(nameField?.value || "").trim();
    const email = String(emailField?.value || "").trim();
    const password = String(passwordField?.value || "");
    const confirmPassword = String(confirmField?.value || "");
    if (!name || !email || !password || !confirmPassword) {
      this.setStatus(form, "Please complete all required fields.", "error"); return false;
    }
    if (!this.validateEmail(email)) {
      this.setStatus(form, "Please enter a valid email address.", "error"); return false;
    }
    if (password.length < 8) {
      this.setStatus(form, "Password must be at least 8 characters.", "error"); return false;
    }
    if (password !== confirmPassword) {
      this.setStatus(form, "Passwords do not match.", "error"); return false;
    }
    if (termsField && !termsField.checked) {
      this.setStatus(form, "Please accept the terms.", "error"); return false;
    }

    try {
      const result = await CynExtraApp.api("/auth/signup", {
        method: "POST",
        body: { name, email, password },
        headers: { Authorization: "" }
      });
      if (result.ok && result.data?.success) {
        this.setStatus(form, "Account created. Redirecting…", "success");
        window.setTimeout(() => CynExtraApp.navigate("login"), 400);
        return true;
      }
      if (result.status && result.status !== 0) {
        this.setStatus(form, result.data?.error || "Unable to create account.", "error");
        return false;
      }
    } catch {}

    this.setStatus(form, "Backend authentication is unavailable. Start the backend and configure authentication.", "error");
    return false;
  },
  async login(form) {
    const identifierField = this.getField(form, "identity", "#login-identity") || this.getField(form, "email", "#login-email");
    const passwordField = this.getField(form, "password", "#login-password");
    const identifier = String(identifierField?.value || "").trim();
    const password = String(passwordField?.value || "");
    if (!identifier || !password) {
      this.setStatus(form, "Please enter email/username and password.", "error"); return false;
    }

    if (this.validateEmail(identifier)) {
      try {
        const result = await CynExtraApp.api("/auth/login", {
          method: "POST",
          body: { email: identifier, password },
          headers: { Authorization: "" }
        });
        if (result.ok && result.data?.success && result.data?.token) {
          const user = result.data.user || {};
          CynExtraApp.auth.setState({ loggedIn: true, userId: user.id, token: result.data.token });
          CynExtraApp.safeStorageSet(CYNEXTRA.storage.profile, JSON.stringify({
            name: user.metadata?.name || "", email: user.metadata?.email || identifier
          }));
          CynExtraApp.state.currentPlan = CynExtraApp.plans.normalize(user.plan);
          CynExtraApp.safeStorageSet(CYNEXTRA.storage.plan, CynExtraApp.state.currentPlan);
          this.setStatus(form, "Login successful…", "success");
          window.setTimeout(() => CynExtraApp.navigate("chat"), 250);
          return true;
        }
        if (result.status && result.status !== 0) {
          this.setStatus(form, result.data?.error || "Invalid email or password.", "error"); return false;
        }
      } catch {}
    }

    this.setStatus(form, "Backend authentication is unavailable. Start the backend and configure authentication.", "error");
    return false;
  }
};


CynExtraApp.passwordReset = {
  async request(form) {
    const email = String(form.querySelector("[name='reset-email']")?.value || "").trim();
    if (!email) return this.status(form, "Enter your account email.", "error");
    const result = await CynExtraApp.api("/auth/password/request", {
      method: "POST",
      body: { email },
      headers: { Authorization: "" }
    });
    if (!result.ok) return this.status(form, result.data?.error || "Unable to send verification code.", "error");
    this.status(form, "If the account exists and email service is configured, a verification code has been sent.", "success");
  },
  async change(form) {
    const email = String(form.querySelector("[name='reset-email']")?.value || "").trim();
    const code = String(form.querySelector("[name='reset-code']")?.value || "").trim();
    const password = String(form.querySelector("[name='reset-password']")?.value || "");
    const result = await CynExtraApp.api("/auth/password/change", {
      method: "POST",
      body: { email, code, newPassword: password },
      headers: { Authorization: "" }
    });
    if (!result.ok) return this.status(form, result.data?.error || "Unable to change password.", "error");
    this.status(form, "Password changed successfully. You can now sign in.", "success");
  },
  status(form, text, kind) {
    const el = form.querySelector("[data-reset-status]");
    if (el) {
      el.hidden = false;
      el.textContent = text;
      el.dataset.status = kind;
    }
  }
};

CynExtraApp.profile = {
  load() {
    const profile = CynExtraApp.parseJSON(
      CynExtraApp.safeStorageGet(CYNEXTRA.storage.profile),
      {}
    );
    document.querySelectorAll("[data-profile-name]").forEach((el) => {
      if (el.tagName === "INPUT") el.value = profile.name || "";
      else el.textContent = profile.name || "CynExtra User";
    });
    document.querySelectorAll("[data-profile-email]").forEach((el) => {
      if (el.tagName === "INPUT") el.value = profile.email || "";
      else el.textContent = profile.email || "Account";
    });
  },
  save(form) {
    const name = form.querySelector("[name='name']")?.value?.trim() || "";
    const email = form.querySelector("[name='email']")?.value?.trim() || "";
    const profile = { name, email };
    CynExtraApp.safeStorageSet(CYNEXTRA.storage.profile, JSON.stringify(profile));
    this.load();
    const status = form.querySelector("[data-profile-form-status]");
    if (status) {
      status.textContent = "Profile saved.";
      status.dataset.statusType = "success";
    }
    return true;
  }
};

CynExtraApp.settings = {
  defaults: Object.freeze({
    appearance: "dark",
    theme: "default",
    notifications: "on",
    notificationSound: "on",
    voice: "on",
    voicePreference: "default",
    memory: "on",
    thinkHarder: "off"
  }),
  getStored() {
    return (
      CynExtraApp.parseJSON(
        CynExtraApp.safeStorageGet(CYNEXTRA.storage.settings),
        {}
      ) || {}
    );
  },
  load() {
    const settings = { ...this.defaults, ...this.getStored() };
    // Theme
    const themeName = settings.theme || CynExtraApp.state.currentTheme || "default";
    if (themeName && CynExtraApp.theme.canUse(themeName)) {
      CynExtraApp.theme.apply(themeName, false);
    } else if (themeName) {
      // still remember preferred theme even if plan-gated
      CynExtraApp.state.currentTheme = themeName;
    }
    // Populate settings form if present
    const form = document.querySelector("[data-settings-form]");
    if (form) {
      form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
        const name = el.name;
        if (!name || !(name in settings) && settings[name] === undefined) {
          // still try defaults
        }
        const val = settings[name];
        if (el.type === "checkbox") {
          el.checked = val === "on" || val === true || val === "true";
        } else if (val != null && el.type !== "button" && el.type !== "submit" && el.type !== "reset") {
          el.value = String(val);
        }
      });
      // Theme option highlight
      document.querySelectorAll("[data-theme-option]").forEach((btn) => {
        const active = btn.dataset.themeOption === (settings.theme || "default");
        btn.classList.toggle("is-selected", active);
        btn.setAttribute("aria-pressed", String(active));
      });
      // Lock theme cards the current plan can't use yet, so the choice is
      // honest instead of silently falling back to the default theme.
      const plan = CynExtraApp.state.currentPlan || "free";
      const rank = CynExtraApp.theme.planRank;
      document.querySelectorAll(".theme-card[data-plan]").forEach((card) => {
        const requiredPlan = card.dataset.plan;
        const locked = (rank[requiredPlan] || 0) > (rank[plan] || 0);
        card.classList.toggle("is-locked", locked);
        const btn = card.querySelector("[data-theme-option]");
        if (btn) {
          btn.disabled = locked;
          btn.textContent = locked ? `Requires ${requiredPlan.toUpperCase()}` : "Use Theme";
        }
      });
    }
    // Sync Ultimate from its own store + optional settings keys
    if (CynExtraApp.ultimate) {
      const u = CynExtraApp.ultimate.getConfig();
      if (settings.ultimateMode === "on") {
        // do not force-enable without plan; bind handles UI
      }
      CynExtraApp.ultimate.refreshUI();
    }
    return settings;
  },
  save(form) {
    if (!form) form = document.querySelector("[data-settings-form]");
    if (!form) return false;
    const settings = { ...this.defaults, ...this.getStored() };

    // Named fields (inputs/selects)
    new FormData(form).forEach((value, key) => {
      settings[key] = String(value);
    });
    // Checkboxes must be explicit (unchecked are absent from FormData)
    form.querySelectorAll("input[type='checkbox'][name]").forEach((input) => {
      settings[input.name] = input.checked ? "on" : "off";
    });
    // Theme from current app state (theme buttons are not form inputs)
    settings.theme = CynExtraApp.state.currentTheme || settings.theme || "default";

    // Apply immediately
    if (settings.theme && CynExtraApp.theme.canUse(settings.theme)) {
      CynExtraApp.theme.apply(settings.theme);
    }

    // Ultimate from form fields
    if (CynExtraApp.ultimate) {
      const can = CynExtraApp.ultimate.canEnable();
      const wantOn = settings.ultimateMode === "on";
      CynExtraApp.ultimate.saveConfig({
        enabled: wantOn && can,
        reasoning: settings.ultimateReasoning || "balanced",
        tools: settings.ultimateTools || "auto",
        memory: settings.ultimateMemory !== "off",
        web: settings.ultimateWeb === "on"
      });
      if (wantOn && !can) {
        // leave checkbox unchecked via refresh
      }
      CynExtraApp.ultimate.refreshUI();
    }

    CynExtraApp.safeStorageSet(CYNEXTRA.storage.settings, JSON.stringify(settings));

    const status = form.querySelector("[data-settings-status]");
    if (status) {
      status.textContent = "Settings saved.";
      status.dataset.statusType = "success";
      status.classList.add("is-visible");
      window.setTimeout(() => {
        if (status.textContent === "Settings saved.") {
          status.textContent = "All changes stored on this device.";
        }
      }, 1600);
    }
    // Brief visual feedback on button
    const btn = form.querySelector('[data-action="save-settings"], button[type="submit"]');
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Saved ✓";
      btn.classList.add("is-success");
      window.setTimeout(() => {
        btn.textContent = prev || "Save Settings";
        btn.classList.remove("is-success");
      }, 1400);
    }
    return true;
  },
  reset(form) {
    if (!form) form = document.querySelector("[data-settings-form]");
    CynExtraApp.safeStorageRemove(CYNEXTRA.storage.settings);
    if (form) form.reset();
    this.load();
    const status = form?.querySelector("[data-settings-status]");
    if (status) {
      status.textContent = "Settings reset to defaults.";
      status.dataset.statusType = "info";
      status.classList.add("is-visible");
    }
    return true;
  }
};


/* ============================================================
   ULTIMATE MODE — Orchestration layer (frontend)
   Architecture (conceptual):
     User → Ultimate Orchestrator → Planner → Model Selection
           → Memory / Tools / Search / Connectors / Projects
           → Provider → AI Response
   This module manages flags, UI status, and request metadata.
   Autonomous multi-agent execution is intentionally not faked.
   ============================================================ */

CynExtraApp.ultimate = {
  storageKey: "cynextra_ultimate",

  defaults: Object.freeze({
    enabled: false,
    reasoning: "balanced",
    tools: "auto",
    memory: true,
    web: false
  }),

  getConfig() {
    const stored =
      CynExtraApp.parseJSON(
        CynExtraApp.safeStorageGet(this.storageKey, "{}"),
        {}
      ) || {};
    return { ...this.defaults, ...stored };
  },

  saveConfig(patch) {
    const next = { ...this.getConfig(), ...patch };
    CynExtraApp.safeStorageSet(this.storageKey, JSON.stringify(next));
    return next;
  },

  isEnabled() {
    return Boolean(this.getConfig().enabled);
  },

  canEnable() {
    const plan = CynExtraApp.plans.normalize(
      CynExtraApp.state.currentPlan || CynExtraApp.safeStorageGet(CYNEXTRA.storage.plan, "free")
    );
    return plan === "ultimate";
  },

  setEnabled(on) {
    if (on && !this.canEnable()) {
      return { ok: false, error: "Ultimate Mode requires the Ultimate plan." };
    }
    this.saveConfig({ enabled: Boolean(on) });
    this.refreshUI();
    return { ok: true };
  },

  getRequestMeta() {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      return { ultimateMode: false };
    }
    return {
      ultimateMode: true,
      ultimateReasoning: cfg.reasoning || "balanced",
      ultimateTools: cfg.tools || "auto",
      ultimateMemory: cfg.memory !== false,
      ultimateWeb: Boolean(cfg.web)
    };
  },

  refreshUI() {
    const cfg = this.getConfig();
    const enabled = Boolean(cfg.enabled);
    document.querySelectorAll("[data-ultimate-toggle]").forEach((el) => {
      if (el.type === "checkbox") el.checked = enabled;
      el.setAttribute("aria-pressed", String(enabled));
    });
    document.querySelectorAll("[data-ultimate-status-label]").forEach((el) => {
      el.textContent = enabled
        ? "Ultimate orchestration active"
        : "Standard mode active";
    });
    document.querySelectorAll(".mode-card, .ultimate-status-card").forEach((el) => {
      el.classList.toggle("is-active", enabled);
    });
    document.body.classList.toggle("ultimate-enabled", enabled);

    const reason = document.querySelector("[data-ultimate-reasoning]");
    if (reason && reason.tagName === "SELECT") reason.value = cfg.reasoning || "balanced";
    const tools = document.querySelector("[data-ultimate-tools]");
    if (tools && tools.tagName === "SELECT") tools.value = cfg.tools || "auto";
    document.querySelectorAll("[data-ultimate-memory]").forEach((el) => {
      if (el.type === "checkbox") el.checked = cfg.memory !== false;
    });
    document.querySelectorAll("[data-ultimate-web]").forEach((el) => {
      if (el.type === "checkbox") el.checked = Boolean(cfg.web);
    });

    // Lightweight dashboard indicators when present
    const setStatus = (sel, text, ok) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.textContent = text;
        el.dataset.status = ok ? "ok" : "off";
      });
    };
    setStatus("[data-ultimate-indicator-mode]", enabled ? "Ultimate" : "Standard", enabled);
    setStatus(
      "[data-ultimate-indicator-model]",
      CynExtraApp.state.currentModel || "cynextra-nova",
      true
    );
    setStatus(
      "[data-ultimate-indicator-memory]",
      enabled && cfg.memory !== false ? "On" : "Off",
      enabled && cfg.memory !== false
    );
    setStatus(
      "[data-ultimate-indicator-tools]",
      enabled ? String(cfg.tools || "auto") : "Off",
      enabled
    );
    setStatus(
      "[data-ultimate-indicator-search]",
      enabled && cfg.web ? "On" : CynExtraApp.state.webSearchEnabled ? "On" : "Off",
      (enabled && cfg.web) || CynExtraApp.state.webSearchEnabled
    );
    setStatus("[data-ultimate-indicator-connectors]", enabled ? "Ready" : "Off", enabled);
    setStatus("[data-ultimate-indicator-agents]", enabled ? "Active" : "Off", enabled);
  },

  bind() {
    this.refreshUI();
    // Settings form controls
    document.querySelectorAll("[data-ultimate-toggle]").forEach((el) => {
      if (el.dataset.ultimateBound) return;
      el.dataset.ultimateBound = "1";
      el.addEventListener("change", () => {
        const on = el.type === "checkbox" ? el.checked : true;
        const result = this.setEnabled(on);
        if (!result.ok) {
          if (el.type === "checkbox") el.checked = false;
          alert(result.error || "Unable to enable Ultimate Mode.");
          this.refreshUI();
        }
      });
    });
    document.querySelectorAll("[data-ultimate-reasoning]").forEach((el) => {
      if (el.dataset.ultimateBound) return;
      el.dataset.ultimateBound = "1";
      el.addEventListener("change", () => {
        this.saveConfig({ reasoning: el.value });
        this.refreshUI();
      });
    });
    document.querySelectorAll("[data-ultimate-tools]").forEach((el) => {
      if (el.dataset.ultimateBound) return;
      el.dataset.ultimateBound = "1";
      el.addEventListener("change", () => {
        this.saveConfig({ tools: el.value });
        this.refreshUI();
      });
    });
    document.querySelectorAll("[data-ultimate-memory]").forEach((el) => {
      if (el.dataset.ultimateBound) return;
      el.dataset.ultimateBound = "1";
      el.addEventListener("change", () => {
        this.saveConfig({ memory: el.checked });
        this.refreshUI();
      });
    });
    document.querySelectorAll("[data-ultimate-web]").forEach((el) => {
      if (el.dataset.ultimateBound) return;
      el.dataset.ultimateBound = "1";
      el.addEventListener("change", () => {
        this.saveConfig({ web: el.checked });
        if (el.checked && !CynExtraApp.state.webSearchEnabled) {
          CynExtraApp.chat.toggleWebSearch();
        }
        this.refreshUI();
      });
    });
  }
};




/* ============================================================
   TOOLS PAGE — uses the existing backend tool registry
   ============================================================ */
CynExtraApp.toolsPage = {
  state: { tools: [] },
  async load() {
    const list = document.querySelector("[data-tools-list]");
    const status = document.querySelector("[data-tools-status]");
    if (!list) return;
    if (status) status.textContent = "Loading registered tools…";
    try {
      const result = await CynExtraApp.api("/tools");
      if (!result.ok || !result.data?.success) throw new Error(result.data?.error || "Could not load tools.");
      this.state.tools = Array.isArray(result.data.tools) ? result.data.tools : [];
      this.render();
    } catch (error) {
      list.innerHTML = `<div class="tools-empty">${String(error.message || "Tools unavailable.").replace(/[<>]/g, "")}</div>`;
      if (status) status.textContent = "Tools could not be loaded.";
    }
  },
  render() {
    const list = document.querySelector("[data-tools-list]");
    const status = document.querySelector("[data-tools-status]");
    if (!list) return;
    if (!this.state.tools.length) {
      list.innerHTML = '<div class="tools-empty">No enabled tools are registered.</div>';
      if (status) status.textContent = "No enabled tools available.";
      return;
    }
    list.innerHTML = "";
    this.state.tools.forEach((tool) => {
      const card = document.createElement("article");
      card.className = "tools-card";
      card.innerHTML = `<div class="tools-card-top"><span class="tools-status">${tool.status === "enabled" ? "Available" : "Disabled"}</span><span class="tools-permission">${tool.permission || "none"}</span></div><h2></h2><p></p><div class="tools-form"><input class="tools-input" data-tool-input placeholder="Input (JSON for supported tools)" autocomplete="off"><button type="button" class="primary-button tools-run" data-tool-run="${String(tool.name).replace(/[^a-zA-Z0-9_-]/g, "")}">Run</button></div><p class="tools-result" data-tool-result></p>`;
      card.querySelector("h2").textContent = tool.name;
      card.querySelector("p").textContent = tool.description || "Registered CynExtra-AI tool.";
      card.querySelector("[data-tool-run]").dataset.toolName = tool.name;
      list.appendChild(card);
    });
    if (status) status.textContent = `${this.state.tools.length} registered tool${this.state.tools.length === 1 ? "" : "s"}.`;
  },
  async run(button) {
    const card = button.closest(".tools-card");
    const input = card?.querySelector("[data-tool-input]");
    const resultEl = card?.querySelector("[data-tool-result]");
    const name = button?.dataset.toolName;
    if (!name || !resultEl) return;
    let parsed = {};
    const raw = String(input?.value || "").trim();
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { resultEl.textContent = "Input must be valid JSON."; return; }
    }
    button.disabled = true;
    resultEl.textContent = "Running…";
    try {
      const result = await CynExtraApp.api("/tools/execute", { method: "POST", body: { name, input: parsed, mode: "normal" } });
      resultEl.textContent = result.ok && result.data?.success ? JSON.stringify(result.data.result) : (result.data?.error || "Tool execution failed.");
    } catch (error) { resultEl.textContent = error.message || "Tool execution failed."; }
    finally { button.disabled = false; }
  }
};

/* ============================================================
   PROJECTS PAGE
   ============================================================ */
CynExtraApp.projectsPage = {
  render() {
    const grid = document.querySelector(".project-grid, [data-project-grid]");
    if (!grid) return;
    const projects = CynExtraApp.history.getProjects();
    const historyItems = CynExtraApp.history.getAll();

    // Enrich chat counts
    const cards = [];
    if (!projects.length) {
      grid.innerHTML = `
        <article class="project-card project-card--empty">
          <div class="project-card-body">
            <span class="project-card-type">GET STARTED</span>
            <h3 class="project-card-title">No projects yet</h3>
            <p class="project-card-description">
              Open a chat, long-press a history item, and choose <strong>Add to project</strong>.
            </p>
          </div>
          <div class="project-card-footer">
            <a class="text-link" href="chat.html" data-navigate="chat.html">Go to Chat →</a>
          </div>
        </article>`;
      return;
    }

    grid.innerHTML = projects.map((p) => {
      const chats = historyItems.filter((h) => h.projectId === p.id);
      const count = Math.max(chats.length, (p.chatIds || []).length, p.chatId ? 1 : 0);
      const name = String(p.name || "Project")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const updated = p.updatedAt || p.createdAt || "";
      const date = updated ? new Date(updated).toLocaleDateString() : "";
      return `
        <article class="project-card" data-project-id="${p.id}">
          <div class="project-card-header">
            <div class="project-card-icon" aria-hidden="true"><img src="assets/images/icons/project.png" alt="" width="28" height="28"></div>
            <button type="button" class="icon-button" data-action="delete-project" data-project-id="${p.id}" aria-label="Delete project">✕</button>
          </div>
          <div class="project-card-body">
            <span class="project-card-type">PROJECT</span>
            <h3 class="project-card-title">${name}</h3>
            <p class="project-card-description">${count} chat${count === 1 ? "" : "s"}${date ? " · " + date : ""}</p>
          </div>
          <div class="project-card-footer">
            <span class="project-status">Active</span>
            <button type="button" class="text-link" data-action="open-project" data-project-id="${p.id}">
              Open →
            </button>
          </div>
        </article>`;
    }).join("");
  },

  create() {
    const title = prompt("New project name:", "");
    if (title === null) return;
    const name = String(title).trim().slice(0, 60);
    if (!name) return;
    const projects = this.getExisting ? this.getExisting() : CynExtraApp.history.getProjects();
    const project = {
      id: "proj_" + Date.now().toString(36),
      name,
      chatIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    projects.unshift(project);
    CynExtraApp.safeStorageSet(CynExtraApp.history.projectsKey, JSON.stringify(projects.slice(0, 40)));
    CynExtraApp.history.setActiveProject(project);
    this.render();
  },

  remove(projectId) {
    if (!projectId) return;
    if (!confirm("Delete this project? Chats inside it will stay in your history but will no longer be grouped under it.")) return;
    const projects = CynExtraApp.history.getProjects().filter((p) => p.id !== projectId);
    CynExtraApp.safeStorageSet(CynExtraApp.history.projectsKey, JSON.stringify(projects));
    // Unlink any chats that referenced this project
    const items = CynExtraApp.history.getAll().map((item) =>
      item.projectId === projectId ? { ...item, projectId: null, projectName: null } : item
    );
    CynExtraApp.history.saveAll(items);
    if (CynExtraApp.state.activeProject?.id === projectId) {
      CynExtraApp.state.activeProject = null;
      CynExtraApp.safeStorageRemove("cynextra_active_project");
    }
    this.render();
  },

  open(projectId) {
    const project = CynExtraApp.history.getProjects().find((p) => p.id === projectId);
    if (!project) return;
    CynExtraApp.history.setActiveProject(project);
    // Prefer latest chat in project
    const chats = CynExtraApp.history.getAll().filter((h) => h.projectId === projectId);
    const target = chats[0]?.id || project.chatId || (project.chatIds && project.chatIds[0]);
    CynExtraApp.navigate("chat");
    // After navigation, chat page will load; store intent
    if (target) {
      CynExtraApp.safeStorageSet(CYNEXTRA.storage.chatId, target);
      CynExtraApp.state.currentChatId = target;
    }
  }
};


CynExtraApp.pluginsPage = {
  // Real support/voice check — the browser must expose these APIs.
  voiceSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && ("speechSynthesis" in window);
  },

  setStatus(key, text, state) {
    const el = document.querySelector(`[data-plugin-status="${key}"]`);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("is-available", "is-limited", "is-unavailable");
    el.classList.add(state);
  },

  setNote(key, note) {
    if (!note) return;
    const el = document.querySelector(`[data-plugin-desc="${key}"]`);
    if (!el) return;
    let noteEl = el.querySelector("[data-plugin-note]");
    if (!noteEl) {
      noteEl = document.createElement("span");
      noteEl.dataset.pluginNote = "";
      noteEl.className = "plugin-note";
      el.appendChild(document.createElement("br"));
      el.appendChild(noteEl);
    }
    noteEl.textContent = note;
  },

  async load() {
    // Features with no real backend yet — say so plainly instead of showing "Available".
    this.setStatus("automation", "Coming soon", "is-unavailable");
    this.setNote("automation", "No automation engine is built yet — this card is a placeholder for a future release.");
    this.setStatus("integrations", "Coming soon", "is-unavailable");
    this.setNote("integrations", "No third-party integrations are connected yet.");
    this.setStatus("ai-agents", "Coming soon", "is-unavailable");
    this.setNote("ai-agents", "Multi-step autonomous agents are not implemented yet — CynExtra-AI answers directly per message.");

    // Project Tools reflects the on-device project grouping (see Projects page).
    this.setStatus("project-tools", "Available (this device)", "is-available");

    // Voice depends on the browser's own speech APIs.
    if (this.voiceSupported()) {
      this.setStatus("voice", "Available", "is-available");
    } else {
      this.setStatus("voice", "Not supported in this browser", "is-unavailable");
    }

    // AI Tools / File Tools / Memory System depend on the backend — ask it.
    const [capsResult, toolsResult] = await Promise.all([
      CynExtraApp.api("/capabilities"),
      CynExtraApp.api("/tools")
    ]);

    if (capsResult.ok && capsResult.data?.success) {
      const caps = capsResult.data.capabilities || {};
      this.setStatus(
        "file-tools",
        caps.fileProcessing ? "Available" : "Unavailable",
        caps.fileProcessing ? "is-available" : "is-unavailable"
      );
      this.setStatus(
        "memory-system",
        caps.memory ? "Available" : "Unavailable",
        caps.memory ? "is-available" : "is-unavailable"
      );
    } else {
      this.setStatus("file-tools", "Status unknown", "is-unavailable");
      this.setStatus("memory-system", "Status unknown", "is-unavailable");
    }

    if (toolsResult.ok && toolsResult.data?.success) {
      const list = Array.isArray(toolsResult.data.tools) ? toolsResult.data.tools : [];
      const enabled = list.filter((t) => t.status === "enabled").length;
      if (enabled > 0) {
        this.setStatus("ai-tools", `Available (${enabled} tool${enabled === 1 ? "" : "s"})`, "is-available");
        this.setNote("ai-tools", `Currently registered: ${list.map((t) => t.name).join(", ")}.`);
      } else {
        this.setStatus("ai-tools", "No tools registered", "is-unavailable");
      }
    } else {
      this.setStatus("ai-tools", "Status unknown", "is-unavailable");
    }
  }
};


CynExtraApp.libraryPage = {
  // Real data pulled from the same localStorage chat history used on the
  // Chat page's sidebar. No fake counts, no fake content.
  load() {
    const all = CynExtraApp.history.getAll ? CynExtraApp.history.getAll() : [];
    const recent = all
      .slice()
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    const pinned = all.filter((item) => item.pinned);

    this.updateCard("recent-conversations", recent.length,
      recent.length
        ? `${recent.length} saved conversation${recent.length === 1 ? "" : "s"}. Open your most recent one.`
        : "Your saved AI conversations will appear here when available.");

    this.updateCard("favorites", pinned.length,
      pinned.length
        ? `${pinned.length} pinned conversation${pinned.length === 1 ? "" : "s"}.`
        : "Pin a conversation from the chat sidebar to see it here.");

    this._recentId = recent[0]?.id || null;
    this._favoriteId = pinned[0]?.id || null;
  },

  updateCard(key, count, text) {
    const desc = document.querySelector(`[data-resource-desc="${key}"]`);
    if (desc) desc.textContent = text;
    const btn = document.querySelector(`[data-action="library-open"][data-resource="${key}"]`);
    if (btn) btn.disabled = count === 0;
  },

  open(resource) {
    if (resource === "recent-conversations" && this._recentId) {
      window.location.href = "chat.html?open=" + encodeURIComponent(this._recentId);
    } else if (resource === "favorites" && this._favoriteId) {
      window.location.href = "chat.html?open=" + encodeURIComponent(this._favoriteId);
    } else {
      window.location.href = "chat.html";
    }
  }
};


CynExtraApp.branding = {
  apply() {
    /* keep existing branding hooks */
  }
};


/* ============================================================
   SMALL PAGE CONTROLS — search/filter/detail/reset
   ============================================================ */
CynExtraApp.showWorkspaceNotice = function (message, type = "info") {
  let notice = document.querySelector("[data-workspace-notice]");
  if (!notice) {
    notice = document.createElement("div");
    notice.dataset.workspaceNotice = "";
    notice.className = "workspace-notice";
    document.body.appendChild(notice);
  }
  notice.textContent = String(message || "");
  notice.dataset.type = type;
  notice.classList.add("is-visible");
  clearTimeout(this._noticeTimer);
  this._noticeTimer = setTimeout(() => notice.classList.remove("is-visible"), 2200);
};

CynExtraApp.toggleInlineSearch = function (kind) {
  const container = document.querySelector(`.${kind}-actions`);
  if (!container) return;
  let wrap = document.querySelector(`[data-inline-search="${kind}"]`);
  if (wrap) {
    const input = wrap.querySelector("input");
    input?.focus();
    return;
  }
  wrap = document.createElement("div");
  wrap.className = "inline-search-wrap";
  wrap.dataset.inlineSearch = kind;
  const input = document.createElement("input");
  input.type = "search";
  input.className = "inline-search-input";
  input.placeholder = `Search ${kind}…`;
  input.setAttribute("aria-label", `Search ${kind}`);
  input.addEventListener("input", () => this.applyInlineSearch(kind, input.value));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button inline-search-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close search");
  close.addEventListener("click", () => {
    this.applyInlineSearch(kind, "");
    wrap.remove();
  });
  wrap.append(input, close);
  container.parentNode.insertBefore(wrap, container.nextSibling);
  input.focus();
};

CynExtraApp.applyInlineSearch = function (kind, value) {
  const query = String(value || "").trim().toLowerCase();
  const selector = kind === "plugin" ? ".plugin-card" : kind === "project" ? ".project-card" : ".resource-card";
  document.querySelectorAll(selector).forEach((card) => {
    const text = card.textContent.toLowerCase();
    card.hidden = Boolean(query) && !text.includes(query);
  });
};

CynExtraApp.applyPageFilter = function (kind) {
  const stateKey = `_filter_${kind}`;
  const current = this[stateKey] || 0;
  const next = current + 1;
  this[stateKey] = next;
  if (kind === "plugin") {
    const modes = ["all", "available", "coming soon"];
    const mode = modes[next % modes.length];
    document.querySelectorAll(".plugin-card").forEach((card) => {
      const status = card.querySelector(".plugin-status")?.textContent.toLowerCase() || "";
      card.hidden = mode === "available" ? !status.includes("available") && !status.includes("workspace") : mode === "coming soon" ? !(status.includes("coming") || status.includes("preparation")) : false;
    });
    this.showWorkspaceNotice(`Plugin filter: ${mode}`);
  } else if (kind === "project") {
    const mode = next % 2 ? "with chats" : "all";
    document.querySelectorAll(".project-card").forEach((card) => {
      const hasDate = Boolean(card.querySelector(".project-card-meta"));
      card.hidden = mode === "with chats" && !hasDate;
    });
    this.showWorkspaceNotice(`Project filter: ${mode}`);
  } else if (kind === "library") {
    const mode = next % 2 ? "favorites" : "all";
    document.querySelectorAll(".resource-card").forEach((card) => {
      const isFav = (card.textContent || "").toLowerCase().includes("favorites");
      card.hidden = mode === "favorites" && !isFav;
    });
    this.showWorkspaceNotice(`Library filter: ${mode}`);
  }
};

CynExtraApp.showPluginDetails = function (button) {
  const card = button.closest(".plugin-card");
  const title = card?.querySelector(".plugin-card-title")?.textContent?.trim() || "Capability";
  const status = card?.querySelector(".plugin-status")?.textContent?.trim() || "Status unknown";
  const desc = card?.querySelector(".plugin-card-description")?.textContent?.trim() || "";
  this.showWorkspaceNotice(`${title}: ${status}. ${desc}`);
};

CynExtraApp.profile.reset = function (form) {
  this.load();
  const status = form?.querySelector("[data-profile-form-status]");
  if (status) { status.textContent = "Changes cancelled."; status.dataset.statusType = "info"; }
};

/* ============================================================
   EVENT ROUTER
   ============================================================ */

CynExtraApp.handleClick = function (event) {
  // History item (must run before generic null check)
  const historyMore =
    event.target instanceof Element
      ? event.target.closest("[data-history-more]")
      : null;
  if (historyMore) {
    // handled by history.bindLongPress click for the More menu
    return;
  }
  const historyBtn =
    event.target instanceof Element
      ? event.target.closest("[data-history-id]")
      : null;
  if (historyBtn) {
    if (this.history.suppressHistoryClickUntil > Date.now() || historyBtn.dataset.longPressed === "1") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    const id = historyBtn.dataset.historyId;
    if (id) this.history.openChat(id);
    return;
  }

  const element =
    event.target instanceof Element
      ? event.target.closest(
          "[data-navigate], [data-action], [data-plus-action], [data-message-action], [data-theme-option], [data-plan-select], [data-password-toggle], [data-model-option], [data-topbar-action], [data-tool-run]"
        )
      : null;

  if (!element) {
    this.handleOutsideMenus(event);
    return;
  }

  if (element.matches("[data-navigate]") && element.tagName !== "A") {
    event.preventDefault();
    this.navigation.handleNavigation(element);
    return;
  }

  if (element.matches("[data-action]")) {
    const action = element.dataset.action;
    if (action === "toggle-sidebar") {
      event.preventDefault();
      this.toggleSidebar();
      return;
    }
    if (action === "close-sidebar" || action === "chat-sidebar-close") {
      event.preventDefault();
      this.closeSidebar();
      return;
    }
    if (action === "toggle-plus-menu") {
      event.preventDefault();
      this.togglePlusMenu();
      return;
    }
    if (action === "toggle-more-menu") {
      event.preventDefault();
      this.toggleMoreMenu();
      return;
    }
    if (action === "toggle-model-menu") {
      event.preventDefault();
      this.models.toggleMenu();
      return;
    }
    if (action === "voice-input") {
      event.preventDefault();
      this.voice.start();
      return;
    }
    if (action === "send-password-code") {
      event.preventDefault();
      const form = element.closest("[data-password-reset-form]");
      if (form) this.passwordReset.request(form);
      return;
    }
    if (action === "logout") {
      event.preventDefault();
      this.logout();
      return;
    }
    if (action === "stop-generating") {
      event.preventDefault();
      this.chat.stopGenerating();
      return;
    }
    if (action === "close-thinking") {
      event.preventDefault();
      this.chat.hideThinking();
      return;
    }
    if (action === "cancel-edit") {
      event.preventDefault();
      this.chat.cancelEdit();
      return;
    }
    if (action === "toggle-thinking-detail") {
      event.preventDefault();
      this.chat.toggleThinkingDetail();
      return;
    }
    if (action === "new-chat") {
      event.preventDefault();
      this.history.startNewChat();
      return;
    }
    if (action === "open-project") {
      event.preventDefault();
      const pid = element.dataset.projectId;
      if (pid) this.projectsPage.open(pid);
      return;
    }
    if (action === "create-project") {
      event.preventDefault();
      this.projectsPage.create();
      return;
    }
    if (action === "delete-project") {
      event.preventDefault();
      const pid = element.dataset.projectId;
      if (pid) this.projectsPage.remove(pid);
      return;
    }
    if (action === "library-open") {
      event.preventDefault();
      this.libraryPage.open(element.dataset.resource);
      return;
    }
    if (action === "clear-active-project") {
      event.preventDefault();
      CynExtraApp.state.activeProject = null;
      CynExtraApp.safeStorageRemove("cynextra_active_project");
      this.history.render();
      return;
    }
    if (action === "library-search") { event.preventDefault(); this.toggleInlineSearch("library"); return; }
    if (action === "library-filter") { event.preventDefault(); this.applyPageFilter("library"); return; }
    if (action === "project-search") { event.preventDefault(); this.toggleInlineSearch("project"); return; }
    if (action === "project-filter") { event.preventDefault(); this.applyPageFilter("project"); return; }
    if (action === "plugin-search") { event.preventDefault(); this.toggleInlineSearch("plugin"); return; }
    if (action === "plugin-filter") { event.preventDefault(); this.applyPageFilter("plugin"); return; }
    if (action === "plugin-details") { event.preventDefault(); this.showPluginDetails(element); return; }
    if (action === "reset-profile") { event.preventDefault(); this.profile.reset(element.closest("form")); return; }
    if (action === "save-settings") {
      event.preventDefault();
      const form = element.closest("form") || document.querySelector("[data-settings-form]");
      this.settings.save(form);
      return;
    }
    if (action === "reset-settings") {
      event.preventDefault();
      const form = element.closest("form") || document.querySelector("[data-settings-form]");
      this.settings.reset(form);
      return;
    }
  }

  if (element.matches("[data-topbar-action]")) {
    event.preventDefault();
    const action = element.dataset.topbarAction;
    if (action === "share") {
      const url = window.location.href;
      if (navigator.share) navigator.share({ title: "CynExtra-AI conversation", url }).catch(() => {});
      else navigator.clipboard?.writeText(url);
      return;
    }
    if (action === "export-chat") {
      const messages = Array.from(document.querySelectorAll("[data-chat-message]")).map((node) => {
        const role = node.dataset.messageRole || "assistant";
        const text = node.querySelector("[data-message-content]")?.innerText?.trim() || "";
        return `${role.toUpperCase()}: ${text}`;
      }).join("\n\n");
      const blob = new Blob([messages], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "cynextra-chat.txt";
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
  }

  if (element.matches("[data-media-control]")) {
    this.capabilities.generate(element.dataset.mediaControl);
    return;
  }

  if (element.matches("[data-plus-action]")) {
    event.preventDefault();
    this.chat.handlePlusAction(element);
    return;
  }
  if (element.matches("[data-action='remove-attachment']")) {
    event.preventDefault();
    const index = Number.parseInt(element.dataset.attachmentIndex || "-1", 10);
    if (Number.isInteger(index) && index >= 0) this.removeAttachment(index);
    return;
  }
  if (element.matches("[data-tool-run]")) {
    event.preventDefault();
    this.toolsPage.run(element);
    return;
  }
  if (element.matches("[data-message-action]")) {
    this.messageActions.handle(element, event);
    return;
  }
  if (element.matches("[data-password-toggle]")) {
    event.preventDefault();
    const selector = element.dataset.passwordToggle;
    const input = selector ? document.querySelector(selector) : null;
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    element.setAttribute("aria-pressed", String(show));
    return;
  }
  if (element.matches("[data-theme-option]")) {
    event.preventDefault();
    if (element.disabled) return;
    const themeName = element.dataset.themeOption;
    this.theme.apply(themeName);
    // Persist preference immediately
    const stored = this.settings.getStored();
    stored.theme = themeName;
    this.safeStorageSet(CYNEXTRA.storage.settings, JSON.stringify(stored));
    document.querySelectorAll("[data-theme-option]").forEach((btn) => {
      const active = btn.dataset.themeOption === themeName;
      btn.classList.toggle("is-selected", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    return;
  }
  if (element.matches("[data-plan-select]")) {
    event.preventDefault();
    this.plans.set(element.dataset.planSelect);
    return;
  }
  this.handleOutsideMenus(event);
};

CynExtraApp.handleSubmit = function (event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches("[data-chat-form]")) {
    this.chat.handleSubmit(event);
    return;
  }
  if (form.matches("[data-login-form]")) {
    event.preventDefault();
    this.authForms.login(form);
    return;
  }
  if (form.matches("[data-signup-form]")) {
    event.preventDefault();
    this.authForms.createAccount(form);
    return;
  }
  if (form.matches("[data-password-reset-form]")) {
    event.preventDefault();
    this.passwordReset.change(form);
    return;
  }
  if (form.matches("[data-profile-form]")) {
    event.preventDefault();
    this.profile.save(form);
    return;
  }
  if (form.matches("[data-settings-form]")) {
    event.preventDefault();
    this.settings.save(form);
  }
};

CynExtraApp.handleInput = function (event) {
  if (event.target.matches?.("[data-chat-input]")) {
    this.chat.autoResizeInput();
    this.chat.updateMobileComposerPosition?.();
  }
};

CynExtraApp.handleKeydown = function (event) {
  if (event.key === "Escape") {
    this.closeAllMenus();
    this.closeSidebar();
    return;
  }
  this.chat.handleKeydown(event);
};

CynExtraApp.handleChange = function (event) {
  if (event.target.matches?.("[data-file-input]")) {
    this.handleFileSelection(event.target);
  }
};

CynExtraApp.bindEvents = function () {
  document.addEventListener("click", (e) => this.handleClick(e));
  document.addEventListener("submit", (e) => this.handleSubmit(e));
  document.addEventListener("input", (e) => this.handleInput(e));
  document.addEventListener("keydown", (e) => this.handleKeydown(e));
  document.addEventListener("change", (e) => this.handleChange(e));
  document.querySelector(".sidebar-overlay")?.addEventListener("click", () => this.closeSidebar());
  window.addEventListener("pageshow", () => {
    this.navigation.markCurrentPage();
    this.profile.load();
    this.ultimate.bind();
    this.plans.applyToUI();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 900) this.closeSidebar();
    this.chat.autoResizeInput();
  });
};

CynExtraApp.initializePage = function () {
  this.branding.apply();
  if (this.auth.enforceRedirects()) return;
  try {
    this.plans.load();
    this.theme.load();
    this.plans.applyToUI();
    this.profile.load();
    this.settings.load();
    this.navigation.markCurrentPage();
    this.closeAllMenus();
    if (this.auth.isLoggedIn()) {
      this.account.sync().then(() => {
        this.profile.load();
        this.plans.applyToUI();
        if (this.isPage(CYNEXTRA.pages.chat)) this.models.load();
      }).catch(() => {});
    }
    const savedChat = this.safeStorageGet(CYNEXTRA.storage.chatId, null);
    if (savedChat) this.state.currentChatId = savedChat;
    // Restore active project filter
    const ap = this.parseJSON(this.safeStorageGet("cynextra_active_project", "null"), null);
    if (ap && ap.id) this.state.activeProject = ap;
    if (this.isPage(CYNEXTRA.pages.chat)) {
      this.chat.autoResizeInput();
      this.chat.updateSendButtonState();
      const queryModel = new URLSearchParams(window.location.search).get("model");
      if (queryModel && this.state.models.some((m) => m.id === queryModel)) this.state.currentModel = queryModel;
      this.models.load();
      this.ensureChatControls();
      this.capabilities.load();
      this.history.loadFromServer();
      this.setupMobileComposer();
      this.ultimate.bind();
      this.history.render();
      // Open a specific chat if linked from Library ("chat.html?open=<id>"),
      // otherwise reopen the last chat we had open.
      const openId = new URLSearchParams(window.location.search).get("open");
      if (openId) {
        this.history.openChat(openId);
      } else if (this.state.currentChatId) {
        this.history.openChat(this.state.currentChatId);
      }
    }
    if (this.isPage(CYNEXTRA.pages.projects)) {
      this.projectsPage.render();
    }
    if (this.isPage(CYNEXTRA.pages.plugins)) {
      this.pluginsPage.load();
    }
    if (this.isPage(CYNEXTRA.pages.tools)) {
      this.toolsPage.load();
    }
    if (this.isPage(CYNEXTRA.pages.library)) {
      this.libraryPage.load();
    }
    if (this.isPage(CYNEXTRA.pages.settings)) {
      this.settings.load();
      this.ultimate.bind();
    }
    this.dispatch("cynextra:ready", {
      page: this.getPageName(),
      userId: this.auth.getState().userId
    });
  } catch (error) {
    console.error("CynExtra-AI init error:", error);
  }
};

CynExtraApp.capabilities = {
  async load() {
    const result = await CynExtraApp.api("/capabilities");
    if (result.ok && result.data?.success) {
      CynExtraApp.state.capabilities = result.data.capabilities || {};
      this.injectMediaControls();
    }
    return CynExtraApp.state.capabilities || {};
  },
  injectMediaControls() {
    const shell = document.querySelector(".chat-input-shell");
    if (!shell) return;
    const caps = CynExtraApp.state.capabilities || {};
    shell.querySelectorAll("[data-media-control]").forEach((el) => el.remove());
    const add = (type, label, icon) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-control-button";
      button.dataset.mediaControl = type;
      button.textContent = `${icon} ${label}`;
      button.title = `Use ${label}`;
      shell.appendChild(button);
    };
    if (caps.imageGeneration) add("image", "Image", "image");
    if (caps.videoGeneration) add("video", "Video", "▶");
  },
  async generate(type) {
    const input = document.querySelector("[data-chat-input]");
    const prompt = String(input?.value || "").trim();
    if (!prompt) {
      CynExtraApp.chat.appendMessage("assistant", `⚠️ Enter a prompt for ${type} generation first.`);
      input?.focus();
      return;
    }
    CynExtraApp.chat.setSendingState(true, `Generating ${type}…`);
    try {
      const userId = CynExtraApp.auth.getState().userId;
      const result = await CynExtraApp.api(`/media/${type}`, {
        method: "POST",
        body: { userId, prompt }
      });
      if (!result.ok || !result.data?.success) {
        CynExtraApp.chat.appendMessage("assistant", `⚠️ ${result.data?.error || `${type} generation failed.`}`);
        return;
      }
      if (type === "image") {
        const item = result.data.results?.[0];
        const src = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null);
        if (src) CynExtraApp.chat.appendMessage("assistant", `[[image:${src}]]`);
      } else {
        const video = result.data.result;
        CynExtraApp.chat.appendMessage("assistant", video?.url ? `[[video:${video.url}]]` : `Video job created: ${video?.id || "unknown"} (status: ${video?.status || "pending"})`);
      }
      if (input) input.value = "";
    } finally {
      CynExtraApp.chat.setSendingState(false);
      CynExtraApp.chat.focusInput();
    }
  }
};

CynExtraApp.ensureChatControls = function () {
  const shell = document.querySelector(".chat-input-shell");
  if (!shell || document.querySelector("[data-model-menu]")) return;

  // Remove any previously injected Search buttons
  document.querySelectorAll("[data-action='toggle-web-search']").forEach((el) => el.remove());

  const modelBtn = document.createElement("button");
  modelBtn.type = "button";
  modelBtn.className = "chat-control-button";
  modelBtn.dataset.action = "toggle-model-menu";
  modelBtn.setAttribute("aria-label", "Select model");
  modelBtn.innerHTML = `<img src="assets/images/icons/model-nova.png" alt="" width="16" height="16" style="border-radius:50%"><span data-current-model-name>CynExtra Nova</span>`;

  const plus = shell.querySelector(".chat-plus-button, [data-action='toggle-plus-menu']");
  if (plus && plus.parentNode) {
    plus.parentNode.insertBefore(modelBtn, plus.nextSibling);
  } else {
    shell.insertBefore(modelBtn, shell.firstChild);
  }

  const menu = document.createElement("div");
  menu.className = "model-menu";
  menu.dataset.modelMenu = "";
  menu.dataset.menu = "";
  menu.setAttribute("aria-hidden", "true");
  menu.innerHTML = `
    <div class="model-menu-title">Models</div>
    <div class="model-list" data-model-list></div>
  `;
  const form = document.querySelector("[data-chat-form]") || shell;
  form.appendChild(menu);

  if (!document.getElementById("cynextra-model-styles")) {
    const style = document.createElement("style");
    style.id = "cynextra-model-styles";
    style.textContent = `
      .chat-control-button {
        display: inline-flex; align-items: center; gap: 6px;
        min-height: 36px; padding: 6px 10px; border-radius: 10px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        color: #b8c0d8; font-size: 12px; font-weight: 600; cursor: pointer;
        flex: 0 0 auto; white-space: nowrap;
      }
      .chat-control-button:hover, .chat-control-button.is-active {
        background: rgba(77,141,255,0.15); border-color: rgba(105,163,255,0.35); color: #fff;
      }
      .model-menu {
        position: absolute; bottom: calc(100% + 10px); left: 0; right: 0;
        z-index: 400; max-height: min(320px, 50vh); overflow: auto;
        padding: 10px; border-radius: 14px;
        background: rgba(13,18,34,0.97); border: 1px solid rgba(255,255,255,0.12);
        box-shadow: 0 20px 50px rgba(0,0,0,0.4);
        opacity: 0; visibility: hidden; pointer-events: none;
        transform: translateY(8px); transition: 0.2s ease;
      }
      .model-menu.is-open, .model-menu[data-open="true"] {
        opacity: 1; visibility: visible; pointer-events: auto; transform: none;
      }
      .model-menu-title {
        font-size: 10px; font-weight: 750; letter-spacing: 0.1em;
        color: #7f8aa8; text-transform: uppercase; margin-bottom: 8px;
      }
      .model-option {
        display: flex; gap: 10px; width: 100%; text-align: left;
        padding: 10px; border-radius: 10px; border: 0; background: transparent;
        color: #b8c0d8; cursor: pointer; margin-bottom: 4px;
      }
      .model-option:hover, .model-option.is-selected {
        background: rgba(77,141,255,0.12); color: #fff;
      }
      .model-option-icon { font-size: 18px; }
      .model-option-body { display: flex; flex-direction: column; gap: 2px; }
      .model-option-body strong { font-size: 13px; }
      .model-option-body small { font-size: 11px; color: #7f8aa8; }
      .chat-composer-inner, .chat-form { position: relative; }
      .message-avatar img {
        width: 100%; height: 100%; object-fit: contain; border-radius: 50%;
      }


      /* Thinking panel */
      .thinking-panel {
        margin: 8px 14px 12px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(20, 27, 50, 0.92);
        border: 1px solid rgba(105, 163, 255, 0.22);
        box-shadow: 0 12px 40px rgba(0,0,0,0.28);
        backdrop-filter: blur(16px);
      }
      .thinking-panel[hidden] { display: none !important; }
      .thinking-panel-header {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
      }
      .thinking-panel-left {
        display: flex; align-items: center; gap: 10px; min-width: 0;
      }
      .thinking-logo {
        width: 22px; height: 22px; border-radius: 50%; object-fit: contain;
      }
      .thinking-title {
        font-size: 13px; color: #f7f9ff; font-weight: 650;
      }
      .thinking-panel-actions { display: flex; gap: 4px; }
      .thinking-toggle, .thinking-close {
        width: 32px; height: 32px; border-radius: 8px; border: 0;
        background: rgba(255,255,255,0.06); color: #b8c0d8; cursor: pointer;
        font-size: 14px; line-height: 1;
      }
      .thinking-toggle:hover, .thinking-close:hover {
        background: rgba(255,255,255,0.12); color: #fff;
      }
      .thinking-panel-body { margin-top: 10px; }
      .thinking-panel:not(.is-expanded) .thinking-panel-body { display: none; }
      .thinking-status {
        margin: 0 0 8px; color: #b8c0d8; font-size: 12px;
      }
      .thinking-steps {
        list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px;
      }
      .thinking-steps li {
        position: relative; padding-left: 18px; color: #7f8aa8; font-size: 12px;
      }
      .thinking-steps li::before {
        content: ""; position: absolute; left: 0; top: 5px;
        width: 8px; height: 8px; border-radius: 50%;
        background: rgba(255,255,255,0.15);
      }
      .thinking-steps li.is-done { color: #69a3ff; }
      .thinking-steps li.is-done::before { background: #4d8dff; }
      .thinking-steps li.is-active { color: #f7f9ff; }
      .thinking-steps li.is-active::before {
        background: #a77bff;
        box-shadow: 0 0 10px rgba(167,123,255,0.6);
        animation: thinkPulse 1s ease-in-out infinite;
      }
      .thinking-spinner {
        width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid rgba(105,163,255,0.25);
        border-top-color: #69a3ff;
        animation: thinkSpin 0.8s linear infinite;
        flex: 0 0 auto;
      }
      @keyframes thinkSpin { to { transform: rotate(360deg); } }
      @keyframes thinkPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.25); opacity: 0.7; }
      }
      .message-avatar.ai-avatar {
        background: transparent !important;
        overflow: hidden;
        border: 1px solid rgba(105,163,255,0.25);
      }
      .message-avatar.ai-avatar img {
        width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
      }
    `;
    document.head.appendChild(style);
  }

  };

CynExtraApp.setupMobileComposer = function () {
  // Composer position/layout is now handled entirely by CSS
  // (flexbox + dvh, see the "COMPOSER FINAL LAYOUT" block at the
  // bottom of style.css). This function is intentionally inert: it
  // only clears stale inline styles that older code may have left
  // behind, so the CSS rules are always the ones in control.
  const composer = document.querySelector(".chat-composer");
  if (composer) {
    ["position", "left", "right", "bottom", "top", "width", "z-index", "transform"].forEach((prop) => {
      composer.style.removeProperty(prop);
    });
    composer.classList.remove("is-keyboard-open");
  }
  const messages = document.querySelector(".chat-messages");
  if (messages) messages.style.removeProperty("padding-bottom");
};



/* ============================================================
   CYNEXTRA RELIABILITY + ULTIMATE UX PATCH
   ============================================================ */
(function installCynExtraReliabilityPatch() {
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#39;"}[ch]));
  const originalApi = CynExtraApp.api.bind(CynExtraApp);
  CynExtraApp.api = async function patchedApi(path, options = {}) {
    const requestId = options.requestId || (window.crypto?.randomUUID ? crypto.randomUUID() : `cx-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const maxRetries = Number.isInteger(options.retryCount) ? Math.max(0, options.retryCount) : 2;
    let last = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const nextOptions = { ...options, requestId, retryCount: 0 };
        nextOptions.headers = { ...(options.headers || {}), "X-CynExtra-Request": requestId };
        last = await originalApi(path, nextOptions);
        const retryable = last?.status === 0 || [502, 503, 504].includes(Number(last?.status));
        if (!retryable || attempt >= maxRetries) return last;
      } catch (error) {
        if (error?.name === "AbortError" || attempt >= maxRetries) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
    return last;
  };

  const originalShowThinking = CynExtraApp.chat.showThinking.bind(CynExtraApp.chat);
  CynExtraApp.chat.showThinking = function enhancedShowThinking(text) {
    originalShowThinking(text);
    const panel = document.querySelector("[data-thinking-panel]");
    if (!panel) return;
    const task = panel.querySelector("[data-thinking-task]");
    const input = document.querySelector("[data-chat-input]");
    const attachments = Array.isArray(CynExtraApp.state.pendingAttachments) ? CynExtraApp.state.pendingAttachments : [];
    const goal = String(input?.value || "").trim() || (attachments.length ? `Analyze ${attachments.length} attached file${attachments.length === 1 ? "" : "s"}` : "Complete the requested task");
    if (task) task.innerHTML = `<span class="thinking-goal-label">USER GOAL</span><strong>${escapeHtml(goal.slice(0, 220))}</strong>`;
    const steps = panel.querySelector("[data-thinking-steps]");
    if (steps) {
      const model = CynExtraApp.state.models.find((m) => m.id === CynExtraApp.state.currentModel)?.name || "CynExtra model";
      const isUltimate = Boolean(CynExtraApp.ultimate?.getRequestMeta?.().ultimateMode);
      const first = attachments.length ? `Inspecting ${attachments.length} attached item${attachments.length === 1 ? "" : "s"}` : "Understanding the request";
      steps.innerHTML = isUltimate
        ? `<li class="is-active">${first}</li><li>Choosing the safest useful tools</li><li>Working with ${model}</li><li>Checking the result</li><li>Preparing the final answer</li>`
        : `<li class="is-active">${first}</li><li>Working with ${model}</li><li>Checking the result</li><li>Preparing the final answer</li>`;
    }
  };

  const originalUpdateThinking = CynExtraApp.chat.updateThinkingStatus.bind(CynExtraApp.chat);
  CynExtraApp.chat.updateThinkingStatus = function enhancedUpdateThinking(text, activeIndex = 0) {
    originalUpdateThinking(text, activeIndex);
    const panel = document.querySelector("[data-thinking-panel]");
    if (!panel) return;
    const status = panel.querySelector("[data-thinking-status]");
    if (status) status.dataset.live = "1";
  };

  // Open Ultimate directly from the sidebar entry and keep the toggle state in sync.
  const originalUltimateBind = CynExtraApp.ultimate.bind.bind(CynExtraApp.ultimate);
  CynExtraApp.ultimate.bind = function patchedUltimateBind() {
    originalUltimateBind();
    const params = new URLSearchParams(location.search);
    if (params.get("ultimate") === "1" && this.canEnable() && !this.isEnabled()) this.setEnabled(true);
    if (params.get("ultimate") === "1") document.body.classList.add("ultimate-focus-mode");
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  
/* ============================================================
   CAPACITOR NATIVE BRIDGE — SAFE INTENT STUB
   ============================================================ */
CynExtraApp.nativeBridge = Object.freeze({
  isAvailable() {
    return Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  },
  async request(action, payload = {}) {
    return {
      success: false,
      executed: false,
      requiresUserConfirmation: true,
      action: String(action || ""),
      payload,
      error: "NATIVE_HOST_NOT_CONNECTED"
    };
  }
});

CynExtraApp.init();
});

window.CynExtraApp = CynExtraApp;
window.CYNEXTRA = CYNEXTRA;
