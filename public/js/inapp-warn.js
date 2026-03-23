(function(){
  function isInAppBrowser(){
    var ua = (navigator.userAgent || "").toLowerCase();
    return ua.includes("instagram") || ua.includes("fbav") || ua.includes("fban");
  }
  function isIOS(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  }
  function storageGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function storageSet(k,v){ try { localStorage.setItem(k,v); } catch(e){} }

  var SNOOZE_HOURS = 6;
  var snoozeUntil = Number(storageGet("inapp_warn_snooze_until") || "0");
  if (!isInAppBrowser()) return;
  if (Date.now() < snoozeUntil) return;

  var warn = document.getElementById("inAppWarn");
  var guide = document.getElementById("inAppGuide");
  var msg = document.getElementById("inAppMsg");
  var stepsText = document.getElementById("inAppStepsText");
  var stepsList = document.getElementById("inAppSteps");

  if (!warn || !guide || !msg || !stepsText || !stepsList) return;

  msg.textContent = isIOS()
    ? "Para notificações funcionarem bem, abre no Safari. O navegador do Facebook/Instagram limita notificações."
    : "Para notificações funcionarem bem, abre no Chrome. O navegador do Facebook/Instagram limita notificações.";

  warn.style.display = "block";

  function buildSteps(){
    stepsList.innerHTML = "";
    if (isIOS()){
      stepsText.textContent = "No iPhone, faz assim:";
      ["Toca no menu (⋯) ou no botão Partilhar (⬆️).",
       "Escolhe “Abrir no Safari”.",
       "No Safari, volta a ativar as notificações."]
      .forEach(function(s){
        var li = document.createElement("li");
        li.textContent = s;
        stepsList.appendChild(li);
      });
    } else {
      stepsText.textContent = "No Android, faz assim:";
      ["Toca no menu (⋯) no canto do navegador do Facebook/Instagram.",
       "Escolhe “Abrir no Chrome” (ou “Abrir no navegador”).",
       "No Chrome, volta a ativar as notificações."]
      .forEach(function(s){
        var li = document.createElement("li");
        li.textContent = s;
        stepsList.appendChild(li);
      });
    }
  }

  async function copyLink(){
    var url = location.href;
    var btn = document.getElementById("inAppCopy");
    try{
      await navigator.clipboard.writeText(url);
      if (btn){ btn.textContent = "Link copiado ✅"; setTimeout(()=>btn.textContent="Copiar link do sistema", 2200); }
    }catch(e){
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position="fixed";
      ta.style.left="-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (btn){ btn.textContent = "Link copiado ✅"; setTimeout(()=>btn.textContent="Copiar link do sistema", 2200); }
    }
  }

  document.getElementById("inAppCopy")?.addEventListener("click", copyLink);
  document.getElementById("inAppHow")?.addEventListener("click", function(){
    buildSteps();
    guide.style.display = "block";
  });
  document.getElementById("inAppGuideClose")?.addEventListener("click", function(){
    guide.style.display = "none";
  });
  document.getElementById("inAppClose")?.addEventListener("click", function(){
    warn.style.display = "none";
    storageSet("inapp_warn_snooze_until", String(Date.now() + SNOOZE_HOURS*60*60*1000));
  });

  guide.addEventListener("click", function(e){
    if (e.target === guide) guide.style.display = "none";
  });
})();
