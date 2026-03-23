/* ========================================
   CURSO PROMO - JavaScript
   Popup após GREEN + debug completo
======================================== */

(function() {
  'use strict';

  const CONFIG = {
    storageKey: 'curso_popup_total_shown',
    maxShows: 2,
    delayAfterGreen: 5000,
    debug: true
  };

  let popupActive = false;
  let popupTimer = null;
  let greenDetectedCount = 0;
  let popupScheduledCount = 0;
  let popupShownThisSession = 0;

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[CursoPromo]', ...args);
    }
  }

  function getShowCount() {
    return parseInt(localStorage.getItem(CONFIG.storageKey) || '0', 10);
  }

  function incrementShowCount() {
    const count = getShowCount() + 1;
    localStorage.setItem(CONFIG.storageKey, String(count));
    return count;
  }

  function canShowPopup() {
    return getShowCount() < CONFIG.maxShows;
  }

  function getState() {
    return {
      active: popupActive,
      timerPending: !!popupTimer,
      totalShownPermanent: getShowCount(),
      shownThisSession: popupShownThisSession,
      greenDetectedCount,
      popupScheduledCount,
      canShow: canShowPopup(),
      maxShows: CONFIG.maxShows
    };
  }

  function printState(label = 'STATE') {
    console.table({
      label,
      active: popupActive,
      timerPending: !!popupTimer,
      totalShownPermanent: getShowCount(),
      shownThisSession: popupShownThisSession,
      greenDetectedCount,
      popupScheduledCount,
      canShow: canShowPopup(),
      maxShows: CONFIG.maxShows
    });
  }

  function createPopupHTML() {
    if (document.getElementById('cursoPopupOverlay')) {
      log('Popup já existe no DOM.');
      return;
    }

    if (!canShowPopup()) {
      log('Limite de exibições atingido. Popup não será criado.');
      return;
    }

    const popupHTML = `
      <div id="cursoPopupOverlay" class="curso-popup-overlay">
        <div class="curso-popup">
          <button class="curso-popup-close" id="cursoPopupClose" aria-label="Fechar">&times;</button>

          <div class="curso-popup-header">
            <div class="curso-popup-emoji">🚀</div>
            <h3>O SINAL BATEU. VISTE ISSO?</h3>
          </div>

          <div class="curso-popup-body">
            <p class="curso-popup-question">
              Agora imagina estar com a conta ativa para aproveitar o próximo sinal.
            </p>

            <div class="curso-popup-features">
              <div class="curso-popup-feature">
                <div class="curso-popup-feature-icon">📝</div>
                <div class="curso-popup-feature-text">
                  <strong>Criar sua conta</strong>
                  Leva menos de 15 segundos
                </div>
              </div>

              <div class="curso-popup-feature">
                <div class="curso-popup-feature-icon">💳</div>
                <div class="curso-popup-feature-text">
                  <strong>Deposita 100 MT</strong>
                  Só para testar o sistema
                </div>
              </div>
            </div>

            <a href="/go" target="_blank" class="curso-popup-cta" id="cursoPopupCTA">
              CRIAR CONTA E TESTAR AGORA
            </a>

            <button class="curso-popup-skip" id="cursoPopupSkip">
              Ainda não quero criar conta
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', popupHTML);

    document.getElementById('cursoPopupClose')?.addEventListener('click', closePopup);
    document.getElementById('cursoPopupSkip')?.addEventListener('click', closePopup);
    document.getElementById('cursoPopupOverlay')?.addEventListener('click', function(e) {
      if (e.target === this) closePopup();
    });

    document.getElementById('cursoPopupCTA')?.addEventListener('click', function() {
      trackEvent('afiliado_popup_cta_click');
      log('CTA clicado.');
      closePopup();
    });

    log('Popup criado no DOM.');
  }

  function ensurePopupExists() {
    let overlay = document.getElementById('cursoPopupOverlay');
    if (!overlay && canShowPopup()) {
      createPopupHTML();
      overlay = document.getElementById('cursoPopupOverlay');
    }
    return overlay;
  }

  function showPopup() {
    if (!canShowPopup()) {
      log(`Limite atingido (${getShowCount()}/${CONFIG.maxShows}). Não mostrando.`);
      printState('showPopup:block_limit');
      return;
    }

    if (popupActive) {
      log('Popup já está ativo. Ignorando showPopup.');
      printState('showPopup:already_active');
      return;
    }

    const overlay = ensurePopupExists();
    if (!overlay) {
      log('Overlay não encontrado. Popup não pode ser exibido.');
      printState('showPopup:no_overlay');
      return;
    }

    popupActive = true;
    popupShownThisSession += 1;
    const count = incrementShowCount();

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    trackEvent('afiliado_popup_shown');
    log(`Popup exibido (${count}/${CONFIG.maxShows}) | sessão=${popupShownThisSession}`);
    printState('showPopup:success');
  }

  function closePopup() {
    const overlay = document.getElementById('cursoPopupOverlay');

    if (overlay) {
      overlay.classList.remove('active');
    }

    document.body.style.overflow = '';
    popupActive = false;

    if (popupTimer) {
      clearTimeout(popupTimer);
      popupTimer = null;
    }

    if (!canShowPopup()) {
      log('Limite atingido. Removendo popup do DOM.');
      if (overlay) overlay.remove();
    }

    printState('closePopup');
  }

  function trackEvent(eventName) {
    log('trackEvent:', eventName);
    if (typeof fbq === 'function') {
      fbq('trackCustom', eventName);
    }
  }

  function onGreenResult(payload) {
    greenDetectedCount += 1;
    log('GREEN detectado.', payload || {});
    printState('onGreenResult:before');

    if (!canShowPopup()) {
      log('Não pode mostrar mais popup.');
      return;
    }

    if (popupActive) {
      log('Popup já ativo, não vou reagendar.');
      return;
    }

    if (popupTimer) {
      log('Já existe timer pendente, não vou criar outro.');
      return;
    }

    popupScheduledCount += 1;
    log(`Popup será exibido em ${CONFIG.delayAfterGreen / 1000}s`);

    popupTimer = setTimeout(function() {
      popupTimer = null;
      showPopup();
    }, CONFIG.delayAfterGreen);

    printState('onGreenResult:scheduled');
  }

  function init() {
    log('Inicializado.');
    printState('init:start');

    if (!canShowPopup()) {
      log('Limite já atingido. Sistema inativo.');
      return;
    }

    createPopupHTML();

    window.addEventListener('sse-resultado', function(event) {
      const data = event.detail || {};
      const status = String(data.status || '').toLowerCase();

      log('Evento sse-resultado recebido:', data);

      if (status === 'green') {
        onGreenResult(data);
      }
    });

    log(`Sistema ativo | exibições permanentes: ${getShowCount()}/${CONFIG.maxShows}`);
    printState('init:done');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.CursoPromo = {
    show: showPopup,
    close: closePopup,
    getCount: getShowCount,
    canShow: canShowPopup,
    getState,
    reset: function() {
      localStorage.removeItem(CONFIG.storageKey);
      popupActive = false;

      if (popupTimer) {
        clearTimeout(popupTimer);
        popupTimer = null;
      }

      const overlay = document.getElementById('cursoPopupOverlay');
      if (overlay) overlay.remove();

      greenDetectedCount = 0;
      popupScheduledCount = 0;
      popupShownThisSession = 0;

      createPopupHTML();

      log('Reset completo.');
      printState('reset');
    }
  };

})(); 