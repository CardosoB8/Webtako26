// Toast curtinho
const toastEl = document.getElementById("toast");
function toast(msg){ if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 2200);
}

// Haptics (Android) no clique de botões principais
["openGame","pushbtn"].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener("click", ()=>navigator.vibrate?.(20));
});

// Bottom shortcuts (apenas scroll para as seções)
document.getElementById("nav-home")?.addEventListener("click", ()=>{
  document.querySelector(".highlight")?.scrollIntoView({behavior:"smooth", block:"start"});
});
document.getElementById("nav-history")?.addEventListener("click", ()=>{
  document.querySelector(".history")?.scrollIntoView({behavior:"smooth", block:"start"});
});
document.getElementById("nav-push")?.addEventListener("click", ()=>{
  document.querySelector("[data-action='ativar-push']")?.focus();
  toast("Ative o Push para receber alertas mesmo fechado");
});

// Link fixo do jogo (sem precisar configurar manualmente)
const GAME_URL = "http://segredodo100x.com/casapato"; // http://media1.placard.co.mz/redirect.aspx?pid=2953&bid=1514 <-- coloque aqui o link correto do jogo

document.getElementById("openGame")?.addEventListener("click", ()=>{
  window.open("/go", "_blank"); 
});

// Filtro do histórico (o app.js insere <li data-status="green|loss">)
document.querySelectorAll(".filters .chip").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".filters .chip").forEach(b=>b.removeAttribute("aria-pressed"));
    btn.setAttribute("aria-pressed","true");
    const f = btn.dataset.filter;
    document.querySelectorAll(".history li").forEach(li=>{
      li.style.display = (f==="all" || li.dataset.status===f) ? "" : "none";
    });
  });
});
