(() => {
  if (window.__cashoutInit) return;
  window.__cashoutInit = true;

  // ===================== CONFIGURAÇÃO =====================
  // Deixe VAZIO ("") para usar o proxy local (recomendado)
  // Ou coloque "https://app.sscashout.online" para acessar diretamente
  const API_BASE_URL = "";  // ← MODIFIQUE AQUI SE NECESSÁRIO
  // ========================================================

  // Sistema em modo leve: proteções agressivas removidas para melhorar estabilidade e tempo real.

  // --- Helpers Base ---
  const $ = (sel) => document.querySelector(sel);
  const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  const asNum = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return (!s || s === "-") ? null : Number(s);
  };
  const fmtX = (n) => (n === null ? "-" : `${Number(n).toFixed(2)}x`);

  // ===================== MODO LEVE DE REDE =====================
  // Removidas as camadas pesadas de challenge/token/encriptação para evitar
  // atraso no primeiro carregamento, reconexões excessivas e rajadas de velas.
  let _apiToken = null;

  async function ensureAccessReady() {
    return true;
  }

async function secureFetch(url, options = {}) {
  // Se API_BASE_URL estiver definida, adiciona à URL
  let fullUrl = url;
  if (API_BASE_URL && (url.startsWith('/api') || url === '/vapidPublicKey.txt')) {
    fullUrl = `${API_BASE_URL}${url}`;
  }
  
  return fetch(fullUrl, {
    ...options,
    credentials: API_BASE_URL ? "include" : "same-origin",
    cache: options.cache || "no-store",
    ...(API_BASE_URL && { mode: "cors" })
  });
}

  function _decryptResponse(data) {
    return data;
  }

  // ===================== FIM MODO LEVE =====================

  const bannerEl = document.getElementById("banner-estrategia");
  const textoMetaEl = document.getElementById("texto-meta");
  const PUSH_GATE_SKIP_SECONDS = 6;
  const signalSlot = document.getElementById("signal-slot");

  let signalHideTimer = null;

  // -------------------- Live Viz (dot + sparkline) --------------------
  const liveDotEl = document.getElementById("live-dot");
  const liveValorEl = document.getElementById("live-valor");
  const sparkSvg = document.getElementById("sparkline");


  // mantém uma janela maior para tendência (cronológica: antigo -> novo)
  let trendVelas = [];
  const TREND_N = 30;

  function setLiveDotState(state){
    if (!liveDotEl) return;
    liveDotEl.classList.remove("green","red","wait");
    liveDotEl.classList.add(state || "wait");
  }

  function updateLiveDot(value){
    if (liveValorEl) liveValorEl.textContent = Number.isFinite(value) ? value.toFixed(2)+"x" : "--";
    if (!Number.isFinite(value)) { setLiveDotState("wait"); return; }

    // muda de cor por ~1.2s quando chega nova vela e volta a “wait”
    const isRed = value < 2;
    setLiveDotState(isRed ? "red" : "green");
    setTimeout(() => setLiveDotState("wait"), 1200);
  }

  // --- Sparkline SVG com interpolação suave ---
  let _sparkPrev = null;
  let _sparkAnim = null;

  function _resample(arr, n){
    if (!arr || !arr.length) return Array.from({length:n}, () => 0);
    if (arr.length === n) return arr.slice();
    const out=[];
    for (let i=0;i<n;i++){
      const t = (arr.length - 1) * (i/(n-1));
      const a = Math.floor(t), b = Math.min(arr.length-1, a+1);
      const f = t - a;
      out.push(arr[a] + (arr[b]-arr[a])*f);
    }
    return out;
  }

  function _sparkPaths(values){
    // values: length TREND_N, chronological
    const n = values.length;
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const pad = 0.12;
    const lo = minV - (maxV-minV)*pad;
    const hi = maxV + (maxV-minV)*pad || (minV + 1);

    const pts = values.map((v,i)=>{
      const x = (i/(n-1))*100;
      const y = 30 - ((v - lo)/(hi-lo))*28 - 1; // 1..29
      return {x, y};
    });

    // curva suave (quadratic)
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i=1;i<pts.length;i++){
      const p0 = pts[i-1], p1 = pts[i];
      const cx = ((p0.x + p1.x)/2).toFixed(2);
      const cy = ((p0.y + p1.y)/2).toFixed(2);
      d += ` Q ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${cx} ${cy}`;
    }
    // último segmento reta
    d += ` T ${pts[pts.length-1].x.toFixed(2)} ${pts[pts.length-1].y.toFixed(2)}`;

    // area suave
    const area = d + ` L 100 30 L 0 30 Z`;
    return {d, area};
  }

  function renderSpark(values){
    if (!sparkSvg) return;

    // garante sempre apenas 2 paths (area + line)
    if (!sparkSvg.__init) {
      sparkSvg.innerHTML = `
        <path class="area" d=""></path>
        <path class="line" d=""></path>
      `;
      sparkSvg.__init = true;
    }

    // garante elementos
    let path = sparkSvg.querySelector("path.line");
    let area = sparkSvg.querySelector("path.area");
    if (!area){
      area = document.createElementNS("http://www.w3.org/2000/svg","path");
      area.setAttribute("class","area");
      sparkSvg.appendChild(area);
    }

    const next = _resample(values, TREND_N);

    // vela mais recente (cronológico => último item)
    const latest = next[next.length - 1];
    const prev   = _sparkPrev ? _sparkPrev[_sparkPrev.length - 1] : latest;
    const jump   = Math.abs((latest ?? 0) - (prev ?? 0));

    // regra de “aceleração”
    const fast = (latest >= 10) || (jump >= 6);

    // 1ª renderização: sem animação
    if (!_sparkPrev){
      _sparkPrev = next.slice();
      const {d, area:ad} = _sparkPaths(next);
      path.setAttribute("d", d);
      area.setAttribute("d", ad);
      return;
    }

    // animação por interpolação (tua base)
    if (_sparkAnim) cancelAnimationFrame(_sparkAnim);
    const prevArr = _sparkPrev.slice();
    const start = performance.now();
    const dur = fast ? 140 : 260;

    const tick = (now)=>{
      const t = Math.min(1, (now-start)/dur);
      const eased = t<.5 ? 2*t*t : 1- Math.pow(-2*t+2,2)/2; // easeInOutQuad
      const mix = prevArr.map((p,i)=> p + (next[i]-p)*eased);
      const {d, area:ad} = _sparkPaths(mix);
      path.setAttribute("d", d);
      area.setAttribute("d", ad);
      if (t<1) _sparkAnim = requestAnimationFrame(tick);
      else { _sparkPrev = next.slice(); _sparkAnim = null; }
    };
    _sparkAnim = requestAnimationFrame(tick);

    // --- “desenhar” a linha (stroke-dash) em cima do update ---
    try{
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.style.setProperty("--len", len);
      sparkSvg.style.setProperty("--draw-ms", (fast ? 260 : 520) + "ms");

      sparkSvg.classList.remove("draw");
      // reflow para reiniciar animação
      void sparkSvg.offsetWidth;
      sparkSvg.classList.add("draw");
    }catch(e){}

    // boost visual em velas grandes
    if (fast){
      sparkSvg.classList.add("boost");
      clearTimeout(sparkSvg.__boostT);
      sparkSvg.__boostT = setTimeout(() => sparkSvg.classList.remove("boost"), 650);
    }
  }


  
  function setLiveNow(val) {
    const dot = document.getElementById("live-dot");
    const txt = document.getElementById("live-valor");
    if (!dot || !txt) return;

    const n = Number(val);
    if (!Number.isFinite(n)) return;

    txt.textContent = n.toFixed(2) + "x";

    // flash verde/vermelho e volta ao pulso "wait"
    dot.classList.remove("green", "loss", "wait");
    dot.classList.add(n >= 2 ? "green" : "loss");

    clearTimeout(dot.__t);
    dot.__t = setTimeout(() => {
      dot.classList.remove("green", "loss");
      dot.classList.add("wait");
    }, 1200);
  }


  // =============================
// CAPTURA DE LINK DE AFILIADO
// =============================

function getQueryParams() {
  return Object.fromEntries(new URLSearchParams(location.search).entries());
}

function setCookie(name, value, days = 30) {
  const maxAge = days * 24 * 60 * 60;

  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ` +
    `Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`;
}

(function captureAffiliate() {

  const params = getQueryParams()

  let pid = params.pid
  let bid = params.bid

  if (!pid || !bid) return

  const payload = {
    pid: String(pid).trim(),
    bid: String(bid).trim(),
    ts: Date.now()
  }

  const json = JSON.stringify(payload)

  setCookie("placard_aff", json, 30)

  localStorage.setItem("placard_aff", json)

  console.log("Affiliate captured", payload)

    const sessionKey = `aff_landing_tracked_${pid}_${bid}`;
  if (!sessionStorage.getItem(sessionKey)) {
    sessionStorage.setItem(sessionKey, "1");

    fetch("/api/affiliate/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        event_type: "landing",
        pid,
        bid,
        source_page: "system",
        generated_link: window.location.href
      })
    }).catch(() => {});
  }

})();


  function drawSparkline(values) {
    const svg = document.getElementById("sparkline");
    if (!svg) return;

    const arr = (values || []).map(Number).filter(Number.isFinite);
    if (arr.length < 2) return;

    // usa mais pontos (se tiver), mas funciona com poucos também
    const pts = arr.slice(0, 30);

    const w = 100, h = 30;
    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const span = (max - min) || 1;

    const step = w / (pts.length - 1);

    const d = pts.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / span) * (h - 3) - 1.5;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");

    svg.innerHTML = `<path d="${d}" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }


  function openPushGate() {
    // se já ativou ou já recusou recentemente, não mostra
    const alreadyEnabled = localStorage.getItem("push_enabled") === "true";
    const snoozeUntil = Number(localStorage.getItem("push_snooze_until") || "0");
    if (alreadyEnabled) return;
    if (Date.now() < snoozeUntil) return;

    const gate = document.getElementById("pushGate");
    const btnEnable = document.getElementById("pushGateEnable");
    const btnSkip = document.getElementById("pushGateSkip");
    const cdEl = document.getElementById("pushGateCountdown");
    if (!gate || !btnEnable || !btnSkip || !cdEl) return;

    gate.classList.add("is-open");
    gate.setAttribute("aria-hidden", "false");

    // countdown para liberar o "Agora não"
    let left = PUSH_GATE_SKIP_SECONDS;
    btnSkip.disabled = true;
    cdEl.textContent = String(left);

    const t = setInterval(() => {
      left -= 1;
      cdEl.textContent = String(Math.max(left, 0));
      if (left <= 0) {
        clearInterval(t);
        btnSkip.disabled = false;
        btnSkip.textContent = "Agora não";
      }
    }, 6000);

    // ação: ativar
    btnEnable.onclick = async () => {
      try {
        await activatePush(); // ou enablePush()
        localStorage.setItem("push_enabled", "true");
        closePushGate();
      } catch (e) {
        // mantém aberto se falhar
        console.warn("Push gate enable failed:", e);
      }

      // marca interação
    localStorage.setItem("notif_ativado", "true");

    // dispara tutorial 10s depois (1 vez)
    if (!localStorage.getItem("tutorial_visto")) {
      //abrirTutorial(); // abre já no step1
    }

    };

    // ação: pular (mas com snooze)
    btnSkip.onclick = () => {
      // insistir depois (ex.: 5 minutos)
      localStorage.setItem("push_snooze_until", String(Date.now() + 5 * 60 * 1000));
      closePushGate();
    };
  }

  function closePushGate() {
    const gate = document.getElementById("pushGate");
    if (!gate) return;
    gate.classList.remove("is-open");
    gate.setAttribute("aria-hidden", "true");
  }

  // ✅ chama 15s depois do lead ser aceito
  function schedulePushGateAfterLead() {
    setTimeout(() => openPushGate(), 15000);
  }

  // --- Trading Terminal Tape ---
  const tapeEl = document.getElementById("terminalTape");

  function _tapeTime(){
    return new Date().toLocaleTimeString("pt-PT", {
      timeZone: "Africa/Johannesburg",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function tapePush(kind, label, text){
    if (!tapeEl) return;

    const el = document.createElement("div");
    el.className = `tape-item ${kind || "vela"}`;
    el.innerHTML = `
      <span class="k">${label}</span>
      <span class="t">${text}</span>
      <span class="ts">${_tapeTime()}</span>
    `;

    tapeEl.prepend(el);
    requestAnimationFrame(() => el.classList.add("in"));

    // fica 8s no terminal (independente do resto)
    setTimeout(() => {
      el.classList.remove("in");
      el.classList.add("out");
      el.addEventListener("animationend", () => el.remove(), { once:true });
    }, 8000);

    // limita itens
    while (tapeEl.children.length > 6) tapeEl.removeChild(tapeEl.lastElementChild);
  }


  function renderSignalCard({
    status = "wait",
    title = "ENTRADA CONFIRMADA",
    apos,
    cash,
    gales,
    badgeText
  }) {
    if (!signalSlot) return;

    // cancela timers antigos
    if (signalHideTimer) clearTimeout(signalHideTimer);
    signalHideTimer = null;

    const cls = status === "green" ? "green" : status === "loss" ? "loss" : "wait";
    const badge = badgeText || (status === "green" ? "GREEN" : status === "loss" ? "LOSS" : "AGUARDANDO");

    const cTxt = (cash === null || cash === undefined) ? "-" : Number(cash).toFixed(2) + "x";

    // ✅ Nota (só no sinal "wait" / entrada confirmada)
    const nota = (status === "wait") ? `
      <div class="signal-note">
        Tenta o sinal ${TENTAR_VEZES} vezes. Se uma das vezes chegar no <b>${cTxt}</b>, consideramos <b>GREEN</b>.
        E <b>LOSS</b> se em todas as ${TENTAR_VEZES} tentativas sair um cashout abaixo de <b>${cTxt}</b>.
      </div>
    ` : "";

    signalSlot.innerHTML = `
      <div id="signal-pop" class="signal-pop ${cls} pulse signal-enter">
        <div class="top">
          <div class="title"><span class="dot"></span> ${title}</div>
          <div class="badge">${badge}</div>
        </div>

        <div class="grid">
          <div class="cell"><span>Depois de</span><strong>${fmtX(apos)}</strong></div>
          <div class="cell"><span>Cashout</span><strong>${fmtX(cash)}</strong></div>
          <div class="cell"><span>Tentar</span><strong>${TENTAR_VEZES} Vezes</strong></div>
        </div>

        ${nota}
      </div>
    `;
  }


  function hideSignalCard(delayMs = 0) {
    if (!signalSlot) return;

    const pop = document.getElementById("signal-pop");
    if (!pop) return;

    if (signalHideTimer) clearTimeout(signalHideTimer);

    signalHideTimer = setTimeout(() => {
      pop.classList.remove("signal-enter");
      pop.classList.add("signal-exit");
      pop.classList.remove("pulse");

      pop.addEventListener("animationend", () => {
        if (signalSlot) signalSlot.innerHTML = "";
      }, { once: true });
    }, delayMs);
  }



  const so = {
    wrap: document.getElementById("signal-overlay"),
    card: document.querySelector(".signal-card"),
    status: document.getElementById("signal-status"),
    apos: document.getElementById("so-apos"),
    cash: document.getElementById("so-cash"),
    gales: document.getElementById("so-gales"),
  };

  function showSignalOverlay({apos, cash, gales}) {
    so.apos.textContent = fmtX(apos);
    so.cash.textContent = fmtX(cash);
    so.gales.textContent = gales ?? "-";
    so.status.textContent = "ENTRADA CONFIRMADA";
    so.card.className = "signal-card pulse";
    so.wrap.classList.remove("hidden");
  }

  function showResultOverlay(status, vf) {
    so.status.textContent = status === "green" ? `GREEN ${vf}x` : "LOSS";
    so.card.className = "signal-card " + status;
    setTimeout(() => hideSignalOverlay(), 8000);
  }

  function hideSignalOverlay() {
    so.wrap.classList.add("hidden");
  }

  function vibrarSinal() {
    if (!("vibrate" in navigator)) return;

    // padrão: curto → pausa → longo → pausa → curto
    navigator.vibrate([120, 80, 260, 80, 120]);
  }


  function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function pseudoNome(){
    // "pessoas" sem afirmar identidade real
    const n = randInt(12, 999);
    const prefix = pick(["Piloto", "Jogador", "Conta", "Membro"]);
    return `${prefix} #${n}`;
  }

  function formatMT(v){
    // ex: 5000 -> "5 mil"
    if (v >= 1000 && v % 1000 === 0) return `${v/1000} mil`;
    return `${v}`;
  }

  function makeToast(text){
    const stack = document.getElementById("toast-stack");
    if (!stack) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div class="row">
        <div class="title">Resultado ao vivo</div>
        <div class="tag">GREEN</div>
      </div>
      <div class="msg">${text}</div>
    `;
    stack.appendChild(el);

    // some depois de 3.8s
    setTimeout(() => {
      el.classList.add("out");
      el.addEventListener("animationend", () => el.remove(), { once:true });
    }, 16000);

    // limita
    while (stack.children.length > 4) stack.removeChild(stack.firstElementChild);
  }

  function spawnGreenSocialToasts({vf, cashout}){
    // aleatório: 1 a 3 toasts por vitória
    const qtd = randInt(1,3);

    // stakes dinâmicos comuns (parecem naturais)
    const stakes = [100,150,200,250,300,500,700,1000];
    const stake = pick(stakes);

    // lucro estimado: stake*(cashout-1) (se cashout existir)
    const lucro = (cashout && Number.isFinite(+cashout)) ? Math.round(stake * (+cashout - 1)) : randInt(200, 5000);

    const nome = pseudoNome();

    const templates = [
      `${nome} acabou de lucrar ${formatMT(lucro)} MT!`,
      `${nome} pegou ${vf?.toFixed?.(2) ?? vf}x com ${stake} MT.`,
      `${nome} entrou e bateu GREEN — ${formatMT(lucro)} MT no bolso.`,
      `${nome} aproveitou o sinal e saiu no ${cashout?.toFixed?.(2) ?? cashout}x.`,
    ];

    for (let i=0;i<qtd;i++){
      // espaçar um pouco
      setTimeout(() => makeToast(pick(templates)), i * randInt(450, 900));
    }
  }


  // Converte VAPID Base64URL -> Uint8Array (necessário para PushManager.subscribe)
  function urlBase64ToUint8Array(base64String) {
    if (!base64String || typeof base64String !== "string") return new Uint8Array();

    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function atualizarPlacarVisual() {
    try {
      const res = await secureFetch("/api/stats", { cache: "no-store" });
      const d = await res.json();

      // Atualiza os números nos cards
      const winsEl = document.getElementById("count-wins");
      const lossEl = document.getElementById("count-loss");
      const totalEl = document.getElementById("count-total");
      const percentText = document.getElementById("stat-percent-text");
      const bar = document.getElementById("stat-percent-bar");

      if (winsEl) winsEl.textContent = d.wins;
      if (lossEl) lossEl.textContent = d.loss;
      if (totalEl) totalEl.textContent = d.total;

      if (percentText) percentText.textContent = `${d.percentage}% DE ACERTOS`;
      if (bar) bar.style.width = `${d.percentage}%`;
    } catch (e) {
      console.error("Erro ao atualizar placar:", e);
    }
  }

  // === 1. LÓGICA DE CONTROLO DE ACESSO (CORRIGIDA) ===
  const gerirAcessoInicial = () => {
    const jaCadastrado = localStorage.getItem('lead_cadastrado');
    const gate = document.getElementById('leadGate');

    if (jaCadastrado === 'true') {
      if (gate) gate.remove();

    } else {
      if (gate) gate.style.display = 'flex';
    }
  };

  // === 2. ENVIO PARA O GOOGLE (UNIFICADO) ===
  async function enviarLeadParaGoogle(nome, whatsapp) {
    const GOOGLE_URL = "https://script.google.com/macros/s/AKfycbxo3o5cSyDBRGv0eV1dg2VbUtkYlLGeKyS-H_DlSMoR5IA2PDZ1K_xdT1XfBXdSQCbtwQ/exec";
    const params = new URLSearchParams();
    params.append('nome', nome);
    params.append('whatsapp', whatsapp);
    params.append('userAgent', navigator.userAgent);

    try {
      fetch(GOOGLE_URL, { method: 'POST', mode: 'no-cors', body: params });
    } catch (e) {
      console.warn("Background sync falhou");
    }
  }

  // === 3. INICIALIZAÇÃO ÚNICA (DOMContentLoaded) ===
  document.addEventListener("DOMContentLoaded", async () => {
    gerirAcessoInicial();

    // Configuração do Formulário
    const leadForm = document.getElementById('leadForm');
    if (leadForm) {
      leadForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const whatsapp = document.getElementById('leadWhatsapp').value.trim();
        const nome = document.getElementById('leadNome').value.trim();
        const errorMsg = document.getElementById('whatsError');

        const regexMZ = /^(82|83|84|85|86|87)\d{7}$/;

        if (regexMZ.test(whatsapp)) {
          if (errorMsg) errorMsg.style.display = 'none';

          localStorage.setItem('lead_cadastrado', 'true');
          const gate = document.getElementById('leadGate');
          if (gate) {
            gate.style.transition = "all 0.4s ease";
            gate.style.opacity = "0";
            gate.style.filter = "blur(10px)";
            setTimeout(() => gate.remove(), 400);
            schedulePushGateAfterLead();
            // Chamar após ativar notificações
          
          }

          if (typeof toast === 'function') toast("Acesso Desbloqueado!");
          if (typeof fbq === 'function') fbq('track', 'Lead');

          enviarLeadParaGoogle(nome, whatsapp);


        } else {
          if (errorMsg) {
            errorMsg.textContent = "Número inválido. Use 9 dígitos (ex: 840000000)";
            errorMsg.style.display = 'block';
          }
          document.getElementById('leadWhatsapp').style.borderColor = '#ff4d4d';
        }
      });
    }

    // Ativar Push
    const btnPush = document.querySelector("[data-action='ativar-push'], #cta-ativar-push");
    if (btnPush) btnPush.addEventListener("click", activatePush);
  });

  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { alert("Permita notificações"); return; }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let vapidUrl = "/vapidPublicKey.txt";
if (API_BASE_URL) vapidUrl = API_BASE_URL + vapidUrl;
let vapid = (await (await fetch(vapidUrl, { cache: "no-store" })).text()).trim();
    vapid = vapid.replace(/[\u200B-\u200D\uFEFF]/g, "");
    const appServerKey = urlBase64ToUint8Array(vapid);

    if (appServerKey.length !== 65) {
      console.error("appServerKey length =", appServerKey.length, "vapid =", vapid);
      alert("Chave VAPID inválida no front (len " + appServerKey.length + "). Atualize vapidPublicKey.txt");
      return;
    }

    const old = await reg.pushManager.getSubscription();
    if (old) { try { await old.unsubscribe(); } catch(e) { console.warn(e); } }

    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
    let subscribeUrl = "/api/subscribe";
if (API_BASE_URL) subscribeUrl = API_BASE_URL + subscribeUrl;
await fetch(subscribeUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  credentials: API_BASE_URL ? "include" : "same-origin",
  body: JSON.stringify(sub),
});
    alert("Push ativado!");
  }

  function getClientId() {
    let cid = localStorage.getItem("cid");
    if (!cid) {
      cid = (crypto.randomUUID && crypto.randomUUID()) ||
            (Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem("cid", cid);
    }
    return cid;
  }

  function formatHora(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleTimeString("pt-PT", {
      timeZone: "Africa/Johannesburg",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // -------------------- status topo --------------------
  function setStatus(online) {
    const pill = document.querySelector("[data-status='realtime']");
    if (pill) {
      const onlineSpan = pill.querySelector("#onlineCount");
      const labelText  = (online ? "" : "• Reconectando ... ");

      if (onlineSpan) {
        if (onlineSpan.previousSibling && onlineSpan.previousSibling.nodeType === Node.TEXT_NODE) {
          onlineSpan.previousSibling.nodeValue = labelText;
        } else {
          pill.insertBefore(document.createTextNode(labelText), onlineSpan);
        }
      } else {
        pill.textContent = labelText;
      }

      pill.classList.toggle("bg-green-600", online);
      pill.classList.toggle("bg-yellow-600", !online);
    }

    const subtitle = document.querySelector("[data-subtitle='connection']");
    if (subtitle) subtitle.textContent = online ? "Aguarde entrada" : "Conectando ...";
  }

  // -------------------- Velas (UI) --------------------
  const MAX_VELAS = 5;
  let ultimasVelas = [];
  let analyzingTimer = null;
  const TENTAR_VEZES = 3;


  const elVelas = document.getElementById("velas");
  const elVelasStatus = document.getElementById("velas-status");

  function setAnalyzing() {
    const el = document.getElementById("velas-status");
    if (!el) return;
    el.classList.add("analisando");
  }
  document.addEventListener("DOMContentLoaded", () => setAnalyzing(true));

  function renderVelas(arr) {
    if (!elVelas) return;
    const list = (arr || []).slice(0, MAX_VELAS);
    elVelas.innerHTML = list
      .map((v) => {
        const n = Number(v);
        const txt = Number.isFinite(n) ? n.toFixed(2) + "x" : "-";
        const isRed = Number.isFinite(n) && n < 2;
        const bg = isRed ? "#2b0f0f" : "#0f2b1a";
        const fg = isRed ? "#ff5c5c" : "#36d27a";
        return `<li class="vela-pill" style="background:${bg};color:${fg}">${txt}</li>`;
      })
      .join("");
  }

  // -------------------- Histórico (somente resultados) --------------------
  function addHistoricoLinha({ ts, status, apos_de, cashout, vela_final, key }) {
    let target = document.querySelector(".history[data-table='historico']");
    const isList = !!target;
    if (!target) target = document.getElementById("history-body");
    if (!target) return;

    if (key && isList && target.querySelector(`li[data-key="${key}"]`)) return;

    const hora = formatHora ? formatHora(ts) : (ts || new Date().toISOString()).replace("T"," ").slice(11,19);
    const fmtX2 = (n) => (n === null || n === undefined ? "-" : `${Number(n).toFixed(2)}x`);
    const statusClass = (status || "").toLowerCase() === "green" ? "green" : "loss";
    const statusText  = (status || "").toUpperCase();

    if (isList) {
      const li = document.createElement("li");
      if (key) li.dataset.key = key;
      li.dataset.status = (status || "").toLowerCase();
      li.innerHTML = `
        <div class="time">${hora}</div>
        <div class="meta">
          <span class="chip">Apos: ${fmtX2(apos_de)}</span>
          <span class="chip">Cash: ${fmtX2(cashout)}</span>
          <span class="chip">Vela: ${fmtX2(vela_final)}</span>
        </div>
        <div class="badge pill ${statusClass}">${statusText}</div>
      `;
      target.prepend(li);

      const maxRows = 5;
      while (target.children.length > maxRows) target.removeChild(target.lastElementChild);
    } else {
      const tr = document.createElement("tr");
      tr.setAttribute("data-status", (status || "").toLowerCase());
      tr.innerHTML = `
        <td>${hora}</td>
        <td>${fmtX2(apos_de)}</td>
        <td>${fmtX2(cashout)}</td>
        <td class="${statusClass}">${statusText}</td>
        <td>${fmtX2(vela_final)}</td>
        <td></td>
      `;
      target.prepend(tr);

      const maxRows = 5;
      while (target.rows && target.rows.length > maxRows) target.deleteRow(-1);
    }
  }

  // -------------------- SSE (EventSource) --------------------
  let es = null, reconnectAttempts = 0, heartbeatTimer = null;
  const MAX_BACKOFF = 15000;

  function resetHeartbeat() {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      try { es && es.close(); } catch (_) {}
      setStatus(false);
      connectSSE();
    }, 15000);  // OTIMIZADO: 15s (antes: 40s)
  }

  // Guarda o último sinal CONFIRMADO para anexar no resultado
  let lastSignal = null;

  function handleEvent(msg) {
    if (!msg || !msg.event) return;

    // ---- VELAS (tempo real) ----
    if (msg.event === "vela" || msg.event === "velas") {
      const d = msg.data || {};

      // OTIMIZADO: Removido polling desnecessário (só atualiza em resultado)
      // setTimeout(atualizarPlacarVisual, 2000);

      // 1) série completa
      let serie = null;
      if (Array.isArray(d.valores)) serie = d.valores;
      else if (Array.isArray(d.velas)) serie = d.velas;

      if (serie) {
        let arr = serie.map(Number).filter(Number.isFinite);

        // normaliza orientação para "mais recente primeiro"
        if (ultimasVelas.length && arr.length) {
          const head = ultimasVelas[0];
          const firstMatch = Math.abs(arr[0] - head) < 1e-9;
          const lastMatch  = Math.abs(arr[arr.length - 1] - head) < 1e-9;
          if (!firstMatch && lastMatch) arr.reverse();
        } else {
          // se não tiver histórico, assume que veio "antigo -> novo" e inverte
          arr.reverse();
        }

        // pills (5)
        ultimasVelas = arr.slice(0, MAX_VELAS);
        renderVelas(ultimasVelas);
        setAnalyzing(ultimasVelas.length === 0);

        // LIVE "agora"
        setLiveNow(arr[0]);

        // SPARKLINE “terminal”: precisamos de cronológico (antigo -> novo)
        trendVelas = arr.slice().reverse().slice(-TREND_N);
        renderSpark(trendVelas); // <- versão com draw/boost que te passei

        // tape
        const nowV = arr[0];
        if (Number.isFinite(nowV)) {
          tapePush("vela", "VELA", `Agora: ${nowV.toFixed(2)}x`);
        }


        return;
      }

      // 2) valor unitário
      const unit = d.valor ?? d.vela ?? d.value ?? d.v;
      const n = Number(unit);

      if (Number.isFinite(n)) {
        // pills (5)
        ultimasVelas.unshift(n);
        ultimasVelas = ultimasVelas.slice(0, MAX_VELAS);
        renderVelas(ultimasVelas);
        setAnalyzing(false);

        // LIVE "agora"
        setLiveNow(n);

        // sparkline cronológico (antigo -> novo)
        trendVelas = [ ...(trendVelas || []), n ].slice(-TREND_N);
        renderSpark(trendVelas);

        // tape
        tapePush("vela", "VELA", `Agora: ${n.toFixed(2)}x`);
      }

      return;
    }



    // ---- SINAL (formando vs confirmado) ----
    if (msg.event === "sinal") {
      const d = msg.data || {};
      const apos = asNum(d.apos_de);
      const cash = asNum(d.cashout);
      const gales = asNum(d.max_gales);
      const metaMsg = String(d.meta || "");

      // ✅ Detecta "formando" (apenas aviso visual) vs "confirmado" (entrada real)
      const tipo = String(d.tipo || "").toLowerCase();
      const metaLower = metaMsg.toLowerCase();

      // Se o texto indicar espera/padrão a formar, NUNCA tratar como entrada
      const formando =
        tipo.includes("formando") ||
        metaLower.includes("padrão detectado") ||
        metaLower.includes("padrao detectado") ||
        metaLower.includes("aguarde") ||
        metaLower.includes("a formar") ||
        metaLower.includes("formando");

      // ✅ CONFIRMADO só com flag/tipo/texto explícito e se NÃO estiver "formando"
      const confirmado = !formando && (
        (d.confirmado === true) ||
        tipo.includes("entrada_confirmada") ||
        metaLower.includes("entrada confirmada") ||
        metaLower.includes("confirmad")
      );

      // Banner SEMPRE que tiver metaMsg
      if (bannerEl && textoMetaEl) {
        if (metaMsg) {
          bannerEl.style.display = "block";
          textoMetaEl.textContent = metaMsg;
          bannerEl.style.borderLeftColor = confirmado ? "#2ecc71" : "#f1c40f";
        } else {
          bannerEl.style.display = "none";
        }
      }

      // ✅ Se NÃO confirmou: é só aviso visual. NÃO mexe em card nem lastSignal
      if (!confirmado) return;

      if (bannerEl) bannerEl.style.display = "none";


      renderSignalCard({
        status: "wait",
        title: "ENTRADA CONFIRMADA",
        apos,
        cash,
        gales,
        badgeText: "APOSTA AGORA"
      });

      vibrarSinal();




      // Atualiza card apenas quando confirmado
      setText("[data-field='apos_de']", fmtX(apos));
      setText("[data-field='cashout']", fmtX(cash));

      const galeEl = document.querySelector("[data-field='max_gales']");
      if (galeEl) {
        galeEl.innerHTML = gales === null ? "-" : `<br>${gales} ${gales === 1 ? "vez" : "vezes"}`;
      }

      const placarEl = document.querySelector("[data-field='placar']");
      if (placarEl) {
        placarEl.classList.remove("green", "loss");
        placarEl.textContent = "Aguardando…";
      }

      lastSignal = { apos_de: apos, cashout: cash, ts: d.ts || new Date().toISOString() };
      return;
    }

    // ---- RESULTADO (único handler) ----
    if (msg.event === "resultado") {
      const d = msg.data || {};
      const st = String(d.status || "").toLowerCase();
      const vf = asNum(d.vela_final);
      const apos = asNum(d.apos_de);
      const cash = asNum(d.cashout);

      // Dispara evento customizado para o popup de conversão
      if (st === "green") {
        window.dispatchEvent(new CustomEvent('sse-resultado', {
          detail: { status: 'green', data: d }
        }));
      }

      if (st === "green") {
        setTimeout(() => {
          spawnGreenSocialToasts({ vf, cashout: lastSignal?.cashout ?? null });
        }, 8000);
      }


      renderSignalCard({
        status: st === "green" ? "green" : "loss",
        title: "RESULTADO",
        apos: lastSignal?.apos_de ?? null,
        cash: lastSignal?.cashout ?? null,
        gales: null,
        badgeText: st === "green" ? `GREEN ${vf !== null ? vf.toFixed(2) + "x" : ""}` : "LOSS"
      });

      // fica 6s e some
      hideSignalCard(9000);

      const aTxt = Number.isFinite(apos) ? apos.toFixed(2) : "-";
      const cTxt = Number.isFinite(cash) ? cash.toFixed(2) : "-";
      tapePush("sinal", "ENTRADA", `Após ${aTxt}x • Cashout ${cTxt}x`);


      const placarEl = document.querySelector("[data-field='placar']");
      if (placarEl) {
        placarEl.classList.remove("green", "loss");

        if (st === "green") {
          placarEl.textContent = `GREEN${vf !== null ? " " + vf.toFixed(2) + "x" : ""}`;
          placarEl.classList.add("green");
        } else if (st === "loss") {
          placarEl.textContent = "LOSS";
          placarEl.classList.add("loss");
        } else {
          placarEl.textContent = "Aguardando…";
        }
      }

      // histórico usa o último sinal CONFIRMADO
      addHistoricoLinha({
        ts: d.ts || new Date().toISOString(),
        status: st,
        apos_de: lastSignal?.apos_de ?? null,
        cashout: lastSignal?.cashout ?? null,
        vela_final: vf,
      });

      // ao encerrar o ciclo, some o banner visual
      if (bannerEl) bannerEl.style.display = "none";

      // atualiza placar com pequeno delay
      setTimeout(() => atualizarPlacarVisual(), 1000);

      return;
    }
  }

  // bootstrap unificado trata /api/online

  async function connectSSE() {
  try { es && es.close(); } catch (_) {}
  
  const cid = getClientId();
  let streamUrl = "/api/stream?cid=" + encodeURIComponent(cid) + "&v=" + Date.now();
  
  // Se API_BASE_URL estiver definida, usa URL completa
  if (API_BASE_URL) {
    streamUrl = API_BASE_URL + streamUrl;
  }
  
  es = new EventSource(streamUrl);
 

    es.onopen = () => {
      setStatus(true);
      reconnectAttempts = 0;
      resetHeartbeat();
      if (!ultimasVelas.length) setAnalyzing(true);
    };

    es.onmessage = (ev) => {
      resetHeartbeat();
      if (!ev.data) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // stream em modo leve: mensagens chegam em JSON normal

      if (msg?.event === "online") {
        const n = msg.data?.count ?? null;
        const el = document.getElementById("onlineCount");
        if (el && n !== null) el.textContent = `· ${n} online`;
        return;
      }

      handleEvent(msg);
    };

    es.onerror = () => {
      setStatus(false);
      try { es && es.close(); } catch (_) {}
      const backoff = Math.min(1000 * Math.pow(2, reconnectAttempts++), MAX_BACKOFF);
      setTimeout(connectSSE, backoff);
    };
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      ensurePushActive().catch(()=>{});
    }
  });



  // -------------------- Push health: auto-resubscribe + alerta --------------------
  const PUSH_REFRESH_KEY = "push_last_refresh";
  const PUSH_REFRESH_EVERY_MS = 6 * 60 * 60 * 1000; // 6h

  function _userWantsPush(){
    return localStorage.getItem("push_enabled") === "true" ||
           localStorage.getItem("notif_ativado") === "true";
  }

  function _getPushBanner(){
    let el = document.getElementById("push-alert");
    if (el) return el;

    el = document.createElement("div");
    el.id = "push-alert";
    el.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;" +
      "display:none;gap:10px;align-items:center;justify-content:space-between;" +
      "padding:12px 12px;border-radius:14px;background:rgba(20,20,22,.92);" +
      "backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);" +
      "color:#fff;font:14px system-ui;";

    el.innerHTML = `
      <div class="msg" style="line-height:1.2"></div>
      <button type="button"
        style="padding:10px 12px;border-radius:12px;border:0;background:#2ecc71;color:#06150d;font-weight:700">
        Ativar
      </button>
    `;
    document.body.appendChild(el);
    return el;
  }

  function showPushBanner(text, actionLabel="Ativar"){
    // respeita snooze do teu push gate
    const snoozeUntil = Number(localStorage.getItem("push_snooze_until") || "0");
    if (Date.now() < snoozeUntil) return;

    const el = _getPushBanner();
    el.querySelector(".msg").textContent = text;
    const btn = el.querySelector("button");
    btn.textContent = actionLabel;
    btn.onclick = () => activatePush(); // gesto do user (seguro)
    el.style.display = "flex";
  }

  function hidePushBanner(){
    const el = document.getElementById("push-alert");
    if (el) el.style.display = "none";
  }

  async function _getReg(){
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function _getVapidKey(){
    let vapidUrl = "/vapidPublicKey.txt";
if (API_BASE_URL) vapidUrl = API_BASE_URL + vapidUrl;
let vapid = (await (await fetch(vapidUrl, { cache: "no-store" })).text()).trim();
    vapid = vapid.replace(/[\s"']/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
    return urlBase64ToUint8Array(vapid);
  }

  async function _refreshServerSub(sub){
    const last = Number(localStorage.getItem(PUSH_REFRESH_KEY) || "0");
    if (Date.now() - last < PUSH_REFRESH_EVERY_MS) return;

    try{
      let subscribeUrl = "/api/subscribe";
if (API_BASE_URL) subscribeUrl = API_BASE_URL + subscribeUrl;
await fetch(subscribeUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  credentials: API_BASE_URL ? "include" : "same-origin",
  body: JSON.stringify(sub),
});
      localStorage.setItem(PUSH_REFRESH_KEY, String(Date.now()));
    }catch(e){}
  }

  async function ensurePushActive(){
    try{
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

      const perm = Notification.permission;

      // Se bloqueou: só avisa se ele queria push
      if (perm === "denied"){
        if (_userWantsPush()){
          showPushBanner("Notificações bloqueadas no navegador. Ativa nas definições para não perder sinais.", "Ativar");
        }
        return;
      }

      // Se ainda não deu permissão: só avisa se ele queria push (não pedir permissão sozinho)
      if (perm !== "granted"){
        if (_userWantsPush()){
          showPushBanner("Push não está ativo. Ativa as notificações para receber sinais em tempo real.", "Ativar");
        }
        return;
      }

      // perm granted: verifica subscrição
      const reg = await _getReg();
      let sub = await reg.pushManager.getSubscription();

      // Se existe sub: refresca no backend (1x/6h) e sai
      if (sub){
        hidePushBanner();
        await _refreshServerSub(sub);
        return;
      }

      // Se NÃO existe sub: tenta auto-resubscribe (pode falhar sem gesto)
      if (_userWantsPush()){
        try{
          const appServerKey = await _getVapidKey();
          if (appServerKey.length !== 65){
            showPushBanner("Chave VAPID inválida. Recarrega a página.", "Recarregar");
            return;
          }
          sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: appServerKey });
          hidePushBanner();
          await _refreshServerSub(sub);
        }catch(e){
          // normalmente NotAllowedError (precisa clique)
          showPushBanner("Push caiu (sem subscrição). Toca em Ativar para reativar.", "Reativar");
        }
      }

    }catch(e){}
  }


  // -------------------- Push: ativação --------------------
  async function activatePush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("Push não é suportado neste navegador.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      alert("Permita notificações para ativar o Push.");
      return;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let vapidUrl = "/vapidPublicKey.txt";
    if (API_BASE_URL) vapidUrl = API_BASE_URL + vapidUrl;
    let vapid = (await (await fetch(vapidUrl, { cache: "no-store" })).text()).trim();
    vapid = vapid.replace(/[\s"']/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
    const appServerKey = urlBase64ToUint8Array(vapid);
    if (appServerKey.length !== 65) {
      alert("Chave VAPID inválida no front. Recarregue a página.");
      return;
    }

    const old = await reg.pushManager.getSubscription();
    if (old) { try { await old.unsubscribe(); } catch {} }

    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });

    // ✅ PARTE CORRIGIDA
    let subscribeUrl = "/api/subscribe";
    if (API_BASE_URL) subscribeUrl = API_BASE_URL + subscribeUrl;
    
    const resp = await fetch(subscribeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: API_BASE_URL ? "include" : "same-origin",
      body: JSON.stringify(sub),
    });
    await resp.json();
    
    alert("Push ativado com sucesso!");
    localStorage.setItem("push_enabled", "true");
    localStorage.setItem("notif_ativado", "true");
    hidePushBanner();

  } catch (e) {
    alert("Falha ao ativar Push: " + e);
  }
}

  // -------------------- DOMContentLoaded (UI e bootstraps) --------------------
  let _bootstrapped = false;

  document.addEventListener("DOMContentLoaded", async () => {
    if (_bootstrapped) return;
    _bootstrapped = true;

    const btnPush = document.querySelector("[data-action='ativar-push'], #btnAtivarPush, button#ativarPush");
    if (btnPush) btnPush.addEventListener("click", activatePush);

    const cta = document.getElementById("cta-ativar-push");
    if (cta) cta.addEventListener("click", activatePush);

    document.querySelectorAll(".filters .chip").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filters .chip").forEach(b => b.removeAttribute("aria-pressed"));
        btn.setAttribute("aria-pressed", "true");
        const f = btn.dataset.filter;
        document.querySelectorAll(".history li").forEach(li => {
          li.style.display = (f === "all" || li.dataset.status === f) ? "" : "none";
        });
      });
    });

    atualizarPlacarVisual();
    try {
      const rOnline = await secureFetch("/api/online", { cache: "no-store" });
      const jOnline = await rOnline.json();
      const el = document.getElementById("onlineCount");
      if (jOnline?.ok && el) el.textContent = `· ${jOnline.online} online`;
    } catch {}

    try {
      const resVelas = await secureFetch("/api/velas", { cache: "no-store" });
      const jVelas = await resVelas.json();
      let arr = Array.isArray(jVelas.valores) ? jVelas.valores
              : Array.isArray(jVelas.velas) ? jVelas.velas
              : [];

      arr = arr.map(Number).filter(Number.isFinite).reverse();

      if (arr.length) {
        ultimasVelas = arr.slice(0, MAX_VELAS);
        renderVelas(ultimasVelas);
        setAnalyzing(false);
        setLiveNow(arr[0]);
        drawSparkline(arr);
      } else {
        setAnalyzing(true);
      }
    } catch {
      setAnalyzing(true);
    }

    try {
      const resHist = await secureFetch("/api/ultimo-historico", { cache: "no-store" });
      const jHist = await resHist.json();
      if (jHist?.ok && jHist.data) {
        const d = jHist.data;
        const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
        addHistoricoLinha({
          ts: d.ts,
          status: d.status,
          apos_de: toNum(d.apos_de),
          cashout: toNum(d.cashout),
          vela_final: toNum(d.vela_final),
        });
      }
    } catch (e) {
      console.warn("Bootstrap data load error:", e);
    }

    connectSSE();
    ensurePushActive().catch(()=>{});
  });

  // ===============================
  // Tutorial Visual - fluxo único (Intro = Step 0)
  // ===============================

  const tutorialSteps = [
    {
      title: "1/4 — Analise em Tempo Real",
      text: "O sistema analisa o jogo em tempo real e só avisa quando encontra um padrão forte.",
      img: "/assets/tutorial/step1.png"
    },
    {
      title: "2/4 — Padrão Detectado",
      text: "Quando aparece 'Padrão Detectado', signica que podes apostar depois de 2 velas.",
      img: "/assets/tutorial/step2.png"
    },
    {
      title: "3/4 — Entrada Confirmada",
      text: "Quando surgir 'Entrada Confirmada', é o momento exato de apostar.",
      img: "/assets/tutorial/step3.png"
    },
    {
      title: "4/4 — Estatisticas do Dia",
      text: "Aqui voce consegue ver quantas VITORIAS o sistema gerou no dia e o total de sinais.",
      img: "/assets/tutorial/step4.png"
    }
  ];

  let tutorialIndex = 0;

  const tutorialOverlay = document.getElementById("tutorial-overlay");
  const tutorialTitle = document.getElementById("tutorial-title");
  const tutorialText  = document.getElementById("tutorial-text");
  const tutorialMedia = document.getElementById("tutorial-media");
  const tutorialImg   = document.getElementById("tutorial-img");
  const tutorialNext  = document.getElementById("tutorial-next");
  const tutorialCard = tutorialOverlay.querySelector(".tutorial-card");


  function abrirTutorial() {
    tutorialIndex = 0;

    // 1) prepara o conteúdo primeiro (step1)
    renderTutorialStep(false);

    // 2) mostra overlay
    tutorialOverlay.classList.remove("hidden");
    tutorialOverlay.setAttribute("aria-hidden", "false");

    // 3) animação de entrada
    tutorialCard.classList.add("is-enter");
    requestAnimationFrame(() => {
      tutorialCard.classList.remove("is-enter");
    });
  }



  function fecharTutorial() {
    tutorialNext?.blur();
    tutorialOverlay.classList.add("hidden");
    tutorialOverlay.setAttribute("aria-hidden", "true");
  }


  function renderTutorialStep(animate = true) {
    const step = tutorialSteps[tutorialIndex];

    const applyContent = () => {
      tutorialTitle.textContent = step.title || "Tutorial";
      tutorialText.textContent  = step.text || "";

      if (step.img) {
        tutorialMedia.classList.remove("hidden");

        // crossfade seguro: troca src e só volta opacity quando carregar
        tutorialCard.classList.add("swap");
        const newSrc = step.img;

        // se for o mesmo src, só remove swap
        if (tutorialImg.getAttribute("src") === newSrc) {
          tutorialCard.classList.remove("swap");
        } else {
          tutorialImg.onload = () => {
            tutorialCard.classList.remove("swap");
            tutorialImg.onload = null;
          };
          tutorialImg.src = newSrc;
        }
      } else {
        tutorialMedia.classList.add("hidden");
        tutorialImg.removeAttribute("src");
        tutorialCard.classList.remove("swap");
      }

      if (tutorialIndex === 0) {
        tutorialNext.textContent = "Próximo";
      } else if (tutorialIndex === tutorialSteps.length - 1) {
        tutorialNext.textContent = "Entendi, VAMOS OPERAR";
      } else {
        tutorialNext.textContent = "Próximo";
      }
    };

    if (!animate) {
      applyContent();
      return;
    }

    // animação de troca (leave -> troca -> enter)
    tutorialCard.classList.add("is-leave");
    setTimeout(() => {
      applyContent();
      tutorialCard.classList.remove("is-leave");
    }, 160);
  }

  tutorialNext.addEventListener("click", () => {
    tutorialIndex++;
    if (tutorialIndex >= tutorialSteps.length) {
      fecharTutorial();
      localStorage.setItem("tutorial_visto", "true");
    } else {
      renderTutorialStep(true);
    }
  });


  // Fecha clicando fora do card (opcional)
  tutorialOverlay.addEventListener("click", (e) => {
    if (e.target === tutorialOverlay) {
      fecharTutorial();
      localStorage.setItem("tutorial_visto", "true");
    }
  });

  // Disparo: chama isto no clique do botão "Ativar notificações"
  function dispararTutorialDepoisDasNotifs() {
    if (localStorage.getItem("tutorial_visto") === "true") return;
    setTimeout(() => abrirTutorial(), 10000);
  }


  const legalDocs = {

  terms: `

  <h3>Termos e Condições de Uso</h3>

  <p><strong>Sistema Cashout</strong></p>
  <p>Última atualização: 2026</p>

  <h3>1. Aceitação dos Termos</h3>

  <p>
  Ao aceder e utilizar o Sistema Cashout, o utilizador declara que leu, compreendeu e concorda com os presentes Termos e Condições.
  </p>

  <p>
  Caso não concorde com qualquer parte destes termos, o utilizador deve interromper imediatamente o uso da plataforma.
  </p>

  <h3>2. Natureza do Sistema</h3>

  <p>
  O Sistema Cashout é uma ferramenta informativa e analítica que apresenta dados e sinais baseados em padrões observados em jogos de apostas online.
  </p>

  <p>
  O objetivo do sistema é fornecer apoio informativo para análise de apostas, ajudando o utilizador a tomar decisões mais conscientes.
  </p>

  <p>
  O sistema não executa apostas, não controla resultados e não interfere com qualquer plataforma de apostas.
  </p>

  <h3>3. Ausência de Garantia de Ganhos</h3>

  <p>
  O Sistema Cashout não garante ganhos financeiros.
  </p>

  <p>
  A utilização das informações fornecidas pelo sistema não assegura resultados positivos em apostas.
  </p>

  <p>O utilizador reconhece que:</p>

  <ul>
  <li>apostas envolvem risco financeiro</li>
  <li>resultados passados não garantem resultados futuros</li>
  <li>qualquer decisão de aposta é exclusivamente da responsabilidade do utilizador</li>
  </ul>

  <h3>4. Responsabilidade do Utilizador</h3>

  <p>O utilizador é totalmente responsável por:</p>

  <ul>
  <li>todas as apostas realizadas</li>
  <li>qualquer perda financeira decorrente da utilização das informações do sistema</li>
  <li>a gestão da sua própria banca e estratégia de apostas</li>
  </ul>

  <p>
  O Sistema Cashout não se responsabiliza por perdas financeiras, danos diretos ou indiretos resultantes do uso da plataforma.
  </p>

  <h3>5. Independência de Casas de Apostas</h3>

  <p>
  O Sistema Cashout não possui qualquer vínculo, parceria ou associação oficial com casas de apostas.
  </p>

  <p>
  Qualquer referência a plataformas de apostas é feita apenas para fins informativos ou de redirecionamento.
  </p>

  <p>
  O sistema não controla, manipula ou influencia resultados de jogos de apostas.
  </p>

  <h3>6. Uso Responsável</h3>

  <p>
  O utilizador concorda em utilizar o sistema de forma responsável.
  </p>

  <p>
  O Sistema Cashout não incentiva comportamento de jogo compulsivo ou irresponsável.
  </p>

  <p>
  Caso o utilizador sinta que está a perder o controlo sobre apostas, recomenda-se procurar apoio especializado.
  </p>

  <h3>7. Afiliados e Links Externos</h3>

  <p>
  A plataforma pode incluir links de afiliados ou redirecionamentos para sites externos.
  </p>

  <p>
  O Sistema Cashout não é responsável pelo conteúdo, políticas ou funcionamento de sites externos.
  </p>

  <h3>8. Disponibilidade do Serviço</h3>

  <p>O Sistema Cashout pode:</p>

  <ul>
  <li>ser atualizado</li>
  <li>sofrer manutenção</li>
  <li>ter funcionalidades alteradas ou removidas</li>
  </ul>

  <p>
  sem aviso prévio.
  </p>

  <p>
  Não é garantido que o sistema esteja disponível continuamente.
  </p>

  <h3>9. Propriedade Intelectual</h3>

  <p>
  Todo o conteúdo do Sistema Cashout, incluindo:
  </p>

  <ul>
  <li>design</li>
  <li>algoritmos</li>
  <li>sinais</li>
  <li>estrutura da plataforma</li>
  </ul>

  <p>
  é protegido por direitos de propriedade intelectual.
  </p>

  <p>
  A reprodução ou redistribuição sem autorização é proibida.
  </p>

  <h3>10. Limitação de Responsabilidade</h3>

  <p>
  Em nenhuma circunstância o Sistema Cashout ou seus desenvolvedores serão responsáveis por:
  </p>

  <ul>
  <li>perdas financeiras</li>
  <li>danos indiretos</li>
  <li>decisões tomadas com base nas informações do sistema</li>
  </ul>

  <h3>11. Alterações aos Termos</h3>

  <p>
  Os presentes Termos e Condições podem ser atualizados a qualquer momento.
  </p>

  <p>
  O uso contínuo da plataforma após alterações implica aceitação dos novos termos.
  </p>

  <h3>12. Contacto</h3>

  <p>
  Para dúvidas ou questões relacionadas com estes Termos e Condições, o utilizador pode entrar em contacto através dos canais oficiais disponibilizados na plataforma.
  </p>

  `,

  privacy: `
  <h3>Coleta de Dados</h3>
  <p>
  O sistema pode coletar informações básicas como nome, WhatsApp e dados de acesso
  para melhorar a experiência do utilizador.
  </p>

  <h3>Uso das Informações</h3>
  <p>
  Os dados são utilizados apenas para funcionamento do sistema e comunicação
  com o utilizador.
  </p>

  <h3>Proteção</h3>
  <p>
  Utilizamos medidas de segurança para proteger os dados coletados.
  </p>
  `,

  risk: `
  <h3>Aviso de Risco</h3>

  <p>
  Apostas online envolvem risco financeiro.
  </p>

  <p>
  Nunca aposte dinheiro que não pode perder.
  </p>

  <p>
  O Sistema Cashout fornece apenas suporte informativo para análise de apostas.
  </p>

  <p>
  Utilize sempre com responsabilidade.
  </p>
  `

  }


  document.addEventListener("DOMContentLoaded", () => {

  const modal = document.getElementById("legalModal")
  const content = document.getElementById("legalContent")
  const title = document.getElementById("legalTitle")

  document.querySelectorAll(".footer-link").forEach(btn => {

  btn.onclick = () => {

  const doc = btn.dataset.doc

  title.textContent = btn.textContent
  content.innerHTML = legalDocs[doc]

  modal.style.display = "flex"

  }

  })

  document.getElementById("legalClose").onclick = () => {
  modal.style.display = "none"
  }

  })

  // ==================== LÓGICA DO POPUP DE CONVERSÃO ====================
(function() {
  const STORAGE_KEY = 'conversion_popup_count';
  const MAX_SHOWS = 2;
  const DELAY_AFTER_GREEN = 20000; // 20 segundos

  let greenDetected = false;
  let popupTimer = null;

  function getPopupCount() {
    return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  }

  function incrementPopupCount() {
    const count = getPopupCount();
    localStorage.setItem(STORAGE_KEY, String(count + 1));
  }

  function shouldShowPopup() {
    return getPopupCount() < MAX_SHOWS;
  }

  function showConversionPopup() {
    if (!shouldShowPopup()) {
      console.log('[Conversion] Popup já foi exibido 2 vezes. Não mostrando mais.');
      return;
    }

    const popup = document.getElementById('conversion-popup');
    if (!popup) return;

    popup.setAttribute('aria-hidden', 'false');
    incrementPopupCount();

    console.log(`[Conversion] Popup exibido (${getPopupCount()}/${MAX_SHOWS})`);

    // Vibração (se disponível)
    if ('vibrate' in navigator) {
      navigator.vibrate([100, 50, 100, 50, 200]);
    }
  }

  function hideConversionPopup() {
    const popup = document.getElementById('conversion-popup');
    if (!popup) return;

    popup.setAttribute('aria-hidden', 'true');
    console.log('[Conversion] Popup fechado');
  }

  function schedulePopupAfterGreen() {
    if (greenDetected) return; // Já detectou GREEN antes
    if (!shouldShowPopup()) return; // Já mostrou 2 vezes

    greenDetected = true;

    console.log('[Conversion] GREEN detectado! Popup será exibido em 20 segundos...');

    popupTimer = setTimeout(() => {
      showConversionPopup();
    }, DELAY_AFTER_GREEN);
  }

  // Event listeners
  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('conversion-close-btn');
    const ctaBtn = document.getElementById('conversion-cta-btn');
    const overlay = document.querySelector('.conversion-overlay');

    if (closeBtn) {
      closeBtn.addEventListener('click', hideConversionPopup);
    }

    if (overlay) {
      overlay.addEventListener('click', hideConversionPopup);
    }

    if (ctaBtn) {
      ctaBtn.addEventListener('click', () => {
        console.log('[Conversion] CTA clicado! Redirecionando...');
        // Popup fecha automaticamente ao clicar no link
        setTimeout(hideConversionPopup, 300);
      });
    }

    // Escuta eventos SSE de resultado GREEN
    // (integra com o código existente do app.js)
    window.addEventListener('sse-resultado', (event) => {
      const data = event.detail;
      const status = String(data.status || '').toLowerCase();

      if (status === 'green') {
        schedulePopupAfterGreen();
      }
    });

    console.log('[Conversion] Sistema de popup inicializado');
    console.log(`[Conversion] Popup exibido ${getPopupCount()}/${MAX_SHOWS} vezes`);
  });

  // Expõe funções globalmente para debug
  window.conversionPopup = {
    show: showConversionPopup,
    hide: hideConversionPopup,
    reset: () => localStorage.removeItem(STORAGE_KEY),
    getCount: getPopupCount
  };
})();

  // EXEMPLO: no teu handler do botão push, depois de ativar com sucesso:
  // localStorage.setItem("notif_ativado","true");
  // dispararTutorialDepoisDasNotifs();

  // -------------------- boot --------------------
  })();
