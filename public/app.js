const app = document.getElementById("app");
const audio = document.getElementById("ceremony-audio");
const defense = document.getElementById("defense-audio");
const musicBtn = document.getElementById("music");

const state = { ballot: null, stamp: "" };
const ui = {
  resetOpen: false,
  restartOpen: false,
  slips: false,
  studioOpen: true,
  resetWord: "",
  restartWord: "",
  overview: null,
  snap: "",
};
const pending = new Set();

let screen = "boot";
let timer = 0;
let toastTimer = 0;
let ready = false;
let mode = "synth";
let playing = false;
let starting = false;
let gesture = false;
let want = true;
let ducked = false;
let audioContext = null;
let synthNodes = [];

try {
  want = localStorage.getItem("tehax-music") !== "off";
} catch {
  want = true;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function shake(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function failMessage(error) {
  if (!error || !error.status) return "A cerimônia não respondeu.";
  return error.message || "Algo saiu do eixo.";
}

function ensureCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  audioContext = audioContext || new AudioCtx();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function sfx(kind = "click") {
  const ctx = ensureCtx();
  if (!ctx) return;
  const recipes = {
    click: [[920, 0.03, "triangle", 0.045], [1380, 0.02, "sine", 0.03]],
    enter: [[523.25, 0.07, "sine", 0.08], [783.99, 0.1, "triangle", 0.07], [1046.5, 0.16, "sine", 0.05]],
    vote: [[659.25, 0.06, "triangle", 0.08], [880, 0.12, "sine", 0.06]],
    open: [[392, 0.08, "sine", 0.09], [523.25, 0.1, "triangle", 0.08], [784, 0.18, "sine", 0.06]],
    seal: [[440, 0.08, "sine", 0.08], [329.63, 0.14, "triangle", 0.07]],
    deny: [[196, 0.1, "sawtooth", 0.05], [147, 0.14, "sine", 0.06]],
    soft: [[740, 0.025, "sine", 0.03]],
  };
  const notes = recipes[kind] || recipes.click;
  const now = ctx.currentTime;
  let t = now;
  for (const [freq, dur, type, level] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    t += dur * 0.55;
  }
}

async function api(url, { method = "GET", body, admin = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  let token = "";
  try {
    token = admin ? sessionStorage.getItem("tehax-admin") : localStorage.getItem("tehax-voter");
  } catch {
    token = "";
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error("A cerimônia não respondeu.");
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Algo saiu do eixo.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function uploadApi(form) {
  let token = "";
  try { token = sessionStorage.getItem("tehax-admin") || ""; } catch { token = ""; }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch("/api/admin/media", {
      method: "POST",
      headers,
      body: form,
      cache: "no-store",
    });
  } catch {
    const error = new Error("A cerimônia não respondeu.");
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Algo saiu do eixo.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function paintMusic() {
  if (!musicBtn) return;
  musicBtn.classList.toggle("is-off", !want || !playing);
  musicBtn.setAttribute("aria-pressed", want && playing ? "true" : "false");
  musicBtn.setAttribute("aria-label", want && playing ? "Silenciar música" : "Tocar música");
}

function stopSynth() {
  for (const node of synthNodes) {
    try { node.stop?.(); } catch { /* oscilador já encerrado */ }
    try { node.disconnect?.(); } catch { /* nó já solto */ }
  }
  synthNodes = [];
}

function startSynth() {
  if (!ensureCtx()) return;
  stopSynth();
  const now = audioContext.currentTime;
  const master = audioContext.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.09, now + 2.4);
  master.connect(audioContext.destination);
  synthNodes.push(master);
  const voices = [
    ["sine", 130.81, 0.34],
    ["sine", 196, 0.22],
    ["triangle", 261.63, 0.14],
    ["triangle", 392, 0.08],
    ["sine", 523.25, 0.04],
  ];
  for (const [type, freq, level] of voices) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = level;
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    synthNodes.push(osc);
  }
  const lfo = audioContext.createOscillator();
  const lfoGain = audioContext.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 0.025;
  lfo.connect(lfoGain);
  lfoGain.connect(master.gain);
  lfo.start();
  synthNodes.push(lfo);
}

async function playMusic() {
  if (!want || playing || starting || !ready) return;
  starting = true;
  try {
    if (mode === "file") await audio.play();
    else startSynth();
    playing = true;
  } catch {
    playing = false;
  } finally {
    starting = false;
    paintMusic();
  }
}

function silence() {
  audio.pause();
  stopSynth();
  playing = false;
  paintMusic();
}

function armMusic() {
  gesture = true;
  ensureCtx();
  if (want) playMusic();
}

function unduckMusic() {
  if (!ducked) return;
  ducked = false;
  if (mode === "file") audio.volume = 0.55;
}

function playDefense(url) {
  if (!defense || !url) return;
  sfx("soft");
  if (playing && mode === "file") {
    audio.volume = 0.12;
    ducked = true;
  }
  defense.pause();
  defense.src = url;
  defense.play().catch(() => {
    unduckMusic();
    toast("Não foi possível tocar a defesa.");
  });
}

async function bootMusic() {
  try {
    const response = await fetch("/audio/horn-of-plenty.mp3", { method: "HEAD", cache: "no-store" });
    if (response.ok) {
      audio.src = "/audio/horn-of-plenty.mp3";
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0.55;
      mode = "file";
    }
  } catch {
    mode = "synth";
  }
  ready = true;
  if (want && (gesture || mode === "file")) await playMusic();
}

audio.addEventListener("error", () => {
  if (mode !== "file") return;
  mode = "synth";
  playing = false;
  audio.removeAttribute("src");
  if (gesture && want) playMusic();
});

defense?.addEventListener("ended", unduckMusic);
defense?.addEventListener("pause", () => {
  if (defense.ended || defense.currentTime === 0) unduckMusic();
});

musicBtn?.addEventListener("click", () => {
  gesture = true;
  sfx("click");
  want = !playing;
  try { localStorage.setItem("tehax-music", want ? "on" : "off"); } catch { /* armazenamento indisponível */ }
  if (want) playMusic();
  else silence();
  paintMusic();
});

document.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Element && event.target.closest("#music")) return;
  gesture = true;
  if (want) playMusic();
});

function leave() {
  if (timer) clearInterval(timer);
  timer = 0;
}

function ballotStamp(data) {
  return JSON.stringify({ o: data.votingOpen, v: data.votes, m: data.media || {} });
}

function rememberBallot(data) {
  state.ballot = data;
  if (!state.ballot.media) state.ballot.media = {};
  state.stamp = ballotStamp(data);
}

function mediaOf(categoryId, name) {
  return state.ballot?.media?.[`${categoryId}::${name}`] || {};
}

function progressInfo() {
  const categories = state.ballot.acts.flatMap((act) => act.categories);
  const voted = categories.filter((category) => state.ballot.votes[category.id]).length;
  return { voted, total: categories.length, open: state.ballot.votingOpen };
}

function bannerText() {
  return state.ballot.votingOpen
    ? "A urna está aberta. Toque em um nome para lavrar o voto."
    : "A urna está lacrada. Os indicados já podem ser contemplados.";
}

function dockText() {
  const progress = progressInfo();
  if (!progress.open) return "Aguardando a abertura da urna";
  return `${progress.voted} de ${progress.total} lavrados`;
}

function paintProgress() {
  const banner = document.getElementById("banner");
  const dock = document.getElementById("dock");
  const seal = document.getElementById("seal");
  if (banner) banner.textContent = bannerText();
  if (dock) dock.textContent = dockText();
  if (seal) {
    seal.textContent = state.ballot.votingOpen ? "Aberta" : "Lacrada";
    seal.classList.toggle("is-open", state.ballot.votingOpen);
  }
}

function portraitHtml(categoryId, name, big = false) {
  const media = mediaOf(categoryId, name);
  const photo = media.photo
    ? `<img class="portrait-img" src="${esc(media.photo)}" alt="">`
    : `<span class="portrait-fallback" aria-hidden="true">${esc(name.slice(0, 1))}</span>`;
  const defenseBtn = media.audio
    ? `<button type="button" class="defense-btn" data-action="defense" data-src="${esc(media.audio)}" aria-label="Ouvir defesa de ${esc(name)}">▶ Defesa</button>`
    : "";
  return `<div class="portrait${big ? " is-big" : ""}">${photo}${defenseBtn}</div>`;
}

function nomineesHtml(category, throne) {
  const open = state.ballot.votingOpen;
  const choice = state.ballot.votes[category.id];
  const items = category.nominees.map((name) => {
    const selected = choice === name;
    const portrait = portraitHtml(category.id, name, throne);
    if (throne && !open) {
      return `<div class="throne">${portrait}<span class="throne-kicker">Indicado</span><span class="throne-name">${esc(name)}</span></div>`;
    }
    if (throne) {
      return `<label class="throne${selected ? " is-selected" : ""}"><input type="radio" name="${esc(category.id)}" value="${esc(name)}"${selected ? " checked" : ""}>${portrait}<span class="throne-kicker">${selected ? "Seu voto" : "Indicado"}</span><span class="throne-name">${esc(name)}</span></label>`;
    }
    if (!open) {
      return `<li class="nominee is-view">${portrait}<span class="nominee-name">${esc(name)}</span></li>`;
    }
    return `<label class="nominee${selected ? " is-selected" : ""}"><input type="radio" name="${esc(category.id)}" value="${esc(name)}"${selected ? " checked" : ""}>${portrait}<span class="mark" aria-hidden="true"></span><span class="nominee-name">${esc(name)}</span></label>`;
  }).join("");
  if (throne) {
    return `<div class="thrones"${open ? ` role="group" aria-label="${esc(category.title)}"` : ""}>${items}</div>`;
  }
  if (!open) return `<ul class="nominees">${items}</ul>`;
  return `<div class="nominees" role="group" aria-label="${esc(category.title)}">${items}</div>`;
}

function stageHtml(category) {
  const done = Boolean(state.ballot.votes[category.id]);
  return `
    <section class="stage${done ? " is-done" : ""}" data-card="${esc(category.id)}">
      <p class="ribbon">Premiação máxima</p>
      <h2>${esc(category.title)}</h2>
      ${nomineesHtml(category, true)}
      <p class="done-note${done ? "" : " is-hidden"}">Voto lavrado</p>
    </section>`;
}

function plaqueHtml(category, number, main) {
  const done = Boolean(state.ballot.votes[category.id]);
  return `
    <article class="plaque${main ? " is-main" : ""}${done ? " is-done" : ""}" data-card="${esc(category.id)}">
      <p class="plaque-no">${String(number).padStart(2, "0")}</p>
      <h3>${esc(category.title)}</h3>
      ${nomineesHtml(category, false)}
      <p class="done-note${done ? "" : " is-hidden"}">Voto lavrado</p>
    </article>`;
}

function actHtml(act) {
  let number = 0;
  const chunks = [];
  let grid = [];
  const flush = () => {
    if (!grid.length) return;
    chunks.push(`<div class="grid">${grid.join("")}</div>`);
    grid = [];
  };
  for (const category of act.categories) {
    if (category.featured) {
      flush();
      chunks.push(stageHtml(category));
    } else {
      number += 1;
      grid.push(plaqueHtml(category, number, act.id === "principais"));
    }
  }
  flush();
  return `
    <section class="act">
      <header class="act-head">
        <p class="act-numeral">${esc(act.numeral)}</p>
        <div>
          <p class="act-kicker">${esc(act.kicker)}</p>
          <h2>${esc(act.title)}</h2>
        </div>
      </header>
      ${chunks.join("")}
    </section>`;
}

function ballotHtml(animate) {
  const ballot = state.ballot;
  const open = ballot.votingOpen;
  const acts = ballot.acts
    .map((act, index) => `${index ? '<div class="rule" aria-hidden="true"></div>' : ""}${actHtml(act)}`)
    .join("");
  return `
    <div class="ballot">
      <div class="screen${animate ? " is-entering" : ""}">
        <header class="topbar">
          <img src="/logo.png" alt="">
          <div>
            <p class="who-kicker">Teha X Awards</p>
            <h1 class="who-name">${esc(ballot.voter.name)}</h1>
          </div>
          <p class="seal${open ? " is-open" : ""}" id="seal">${open ? "Aberta" : "Lacrada"}</p>
        </header>
        <div class="sheet">
          <p class="banner" id="banner" aria-live="polite">${esc(bannerText())}</p>
          ${acts}
          <footer class="colophon">
            <p>Teha X Awards · ${esc(ballot.edition)}</p>
            <button type="button" class="linkish" data-action="admin">Mesa de apuração</button>
            <button type="button" class="linkish" data-action="switch">Trocar nome</button>
          </footer>
        </div>
      </div>
      <div class="dock" id="dock">${esc(dockText())}</div>
    </div>`;
}

function paintBallot(keepScroll, animate) {
  const y = keepScroll ? window.scrollY : 0;
  app.innerHTML = ballotHtml(animate);
  window.scrollTo(0, y);
}

function renderBallot() {
  screen = "ballot";
  document.body.dataset.screen = "ballot";
  document.title = "Cédula · Teha X Awards";
  leave();
  paintBallot(false, true);
  timer = setInterval(pollBallot, 4000);
}

function splashHtml(name) {
  return `
    <div class="screen is-entering">
      <div class="gate-wrap">
        <h1><img class="crest" src="/logo.png" alt="Teha X Awards"></h1>
        <form class="gate" id="gate-form" novalidate>
          <label class="sr-only" for="nome">Seu nome</label>
          <input id="nome" name="nome" maxlength="32" autocomplete="name" enterkeyhint="done" placeholder="Seu nome" value="${esc(name)}">
          <button type="submit">Entrar</button>
        </form>
        <button type="button" class="linkish" data-action="admin">Mesa de apuração</button>
      </div>
    </div>`;
}

function renderSplash() {
  screen = "splash";
  document.body.dataset.screen = "splash";
  document.title = "Teha X Awards";
  try { sessionStorage.removeItem("tehax-admin-open"); } catch { /* segue a entrada */ }
  leave();
  let name = "";
  try { name = localStorage.getItem("tehax-name") || ""; } catch { name = ""; }
  app.innerHTML = splashHtml(name);
  if (window.matchMedia("(pointer: fine)").matches) document.querySelector("#nome")?.focus();
}

function adminLoginHtml() {
  return `
    <div class="screen is-entering">
      <div class="gate-wrap">
        <img class="crest crest-small" src="/logo.png" alt="">
        <form class="gate" id="admin-form" novalidate>
          <p class="act-kicker">Teha X Awards</p>
          <h1>Mesa de apuração</h1>
          <label class="sr-only" for="senha">Senha</label>
          <input id="senha" name="password" type="password" maxlength="80" autocomplete="current-password" placeholder="Senha">
          <button type="submit">Entrar</button>
        </form>
        <button type="button" class="linkish" data-action="splash">Voltar à entrada</button>
      </div>
    </div>`;
}

function renderAdminLogin() {
  screen = "admin-login";
  document.body.dataset.screen = "admin-login";
  document.title = "Mesa · Teha X Awards";
  try { sessionStorage.setItem("tehax-admin-open", "1"); } catch { /* a mesa segue nesta visita */ }
  leave();
  app.innerHTML = adminLoginHtml();
  if (window.matchMedia("(pointer: fine)").matches) document.querySelector("#senha")?.focus();
}

function joinPt(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function verdictOf(category) {
  const leaders = category.rows.filter((row) => row.lead).map((row) => row.name);
  if (!leaders.length) return "Ainda sem votos";
  if (category.tie) return `Empate: ${joinPt(leaders)}`;
  return `À frente: ${leaders[0]}`;
}

function resultCard(category) {
  const max = Math.max(...category.rows.map((row) => row.votes), 0);
  const rows = category.rows.map((row) => {
    const width = max ? Math.round((row.votes / max) * 100) : 0;
    return `
      <li class="${row.lead ? "is-lead" : ""}">
        <div class="tally-top"><span>${esc(row.name)}</span><strong>${row.votes}</strong></div>
        <div class="bar" aria-hidden="true"><span class="bar-fill" style="--w:${width}%"></span></div>
      </li>`;
  }).join("");
  return `
    <article class="result${category.featured ? " is-max" : ""}">
      ${category.featured ? '<p class="ribbon">Premiação máxima</p>' : ""}
      <h3>${esc(category.title)}</h3>
      <p class="verdict">${esc(verdictOf(category))}</p>
      <ul class="tally">${rows}</ul>
    </article>`;
}

function rollHtml(voters) {
  if (!voters.length) return '<p class="banner">Nenhuma cédula entrou ainda.</p>';
  return `<ul class="roll">${voters.map((voter) => `
    <li class="${voter.voted === voter.total ? "is-complete" : ""}">
      <span>${esc(voter.name)}</span>
      <small>${voter.voted}/${voter.total}</small>
      <button type="button" class="mini" data-action="release" data-id="${esc(voter.id)}" data-name="${esc(voter.name)}">Liberar</button>
    </li>`).join("")}</ul>`;
}

function slipsHtml(voters) {
  if (!voters.length) return "";
  return `<h2 class="section-label">Cédulas individuais</h2>${voters.map((voter) => `
    <article class="slip">
      <header><strong>${esc(voter.name)}</strong><span>${voter.voted}/${voter.total}</span></header>
      <ul>
        ${voter.choices.map((choice) => `<li><span>${esc(choice.title)}</span>${choice.choice ? `<strong>${esc(choice.choice)}</strong>` : "<em>em branco</em>"}</li>`).join("")}
      </ul>
    </article>`).join("")}`;
}

function formatMs(ms) {
  if (!ms) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

function studioHtml(studio) {
  if (!studio?.length) return "";
  const blocks = studio.map((category) => {
    const people = category.nominees.map((person) => `
      <article class="studio-card${category.featured ? " is-max" : ""}">
        <div class="studio-photo">
          ${person.photo ? `<img src="${esc(person.photo)}" alt="">` : `<span>${esc(person.name.slice(0, 1))}</span>`}
        </div>
        <div class="studio-meta">
          <strong>${esc(person.name)}</strong>
          <small>${esc(category.title)}</small>
          <div class="studio-actions">
            <label class="ghost file-btn">Foto<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="photo" data-category="${esc(category.id)}" data-nominee="${esc(person.name)}"></label>
            <label class="ghost file-btn">Áudio 15s<input type="file" accept="audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.ogg,.wav,.m4a" data-upload="audio" data-category="${esc(category.id)}" data-nominee="${esc(person.name)}"></label>
            ${person.audio ? `<button type="button" class="mini" data-action="defense" data-src="${esc(person.audio)}">Ouvir ${esc(formatMs(person.audioMs))}</button>` : ""}
            ${person.photo ? `<button type="button" class="mini" data-action="media-del" data-which="photo" data-category="${esc(category.id)}" data-nominee="${esc(person.name)}">Tirar foto</button>` : ""}
            ${person.audio ? `<button type="button" class="mini" data-action="media-del" data-which="audio" data-category="${esc(category.id)}" data-nominee="${esc(person.name)}">Tirar áudio</button>` : ""}
          </div>
        </div>
      </article>`).join("");
    return `
      <div class="studio-group">
        <h3 class="studio-title">${category.featured ? "Premiação máxima · " : ""}${esc(category.title)}</h3>
        <div class="studio-grid">${people}</div>
      </div>`;
  }).join("");
  return `
    <section class="studio no-print">
      <div class="studio-head">
        <h2 class="section-label">Estúdio dos indicados</h2>
        <button type="button" class="ghost" data-action="studio-toggle">${ui.studioOpen ? "Ocultar estúdio" : "Mostrar estúdio"}</button>
      </div>
      <p class="track-note">Foto (JPG/PNG/WEBP, até 2 MB) e defesa em áudio de até 15 segundos (MP3/OGG/WAV/M4A, até 900 KB).</p>
      ${ui.studioOpen ? blocks : ""}
    </section>`;
}

function votingGateHtml(open) {
  return `
    <section class="voting-gate no-print">
      <p class="act-kicker">${open ? "Votação liberada" : "Votação bloqueada"}</p>
      <h2>${open ? "A urna está aberta" : "Liberar a votação"}</h2>
      <p>${open
        ? "Os participantes já podem lavrar os votos. Você pode lacrar a urna a qualquer momento."
        : "Por enquanto todos só veem os candidatos. Quando quiser começar, libere a votação."}</p>
      <button type="button" class="${open ? "ghost edict" : "edict"} voting-cta" data-action="toggle-voting">
        ${open ? "Lacrar a urna" : "Liberar votação"}
      </button>
    </section>`;
}

function dangerHtml() {
  return `
    <section class="danger no-print">
      <h3>Arquivo da urna</h3>
      <div class="row">
        <button type="button" class="ghost" data-action="reset-show">Zerar votos</button>
        <button type="button" class="ghost" data-action="restart-show">Recomeçar cerimônia</button>
      </div>
      ${ui.resetOpen ? `
        <form id="reset-form">
          <input id="reset-word" placeholder="Digite ZERAR" autocomplete="off" spellcheck="false" value="${esc(ui.resetWord || "")}">
          <button class="ghost" type="submit">Confirmar</button>
        </form>` : ""}
      ${ui.restartOpen ? `
        <form id="restart-form">
          <input id="restart-word" placeholder="Digite RECOMECAR" autocomplete="off" spellcheck="false" value="${esc(ui.restartWord || "")}">
          <button class="ghost" type="submit">Confirmar</button>
        </form>` : ""}
    </section>`;
}

function adminHtml(animate) {
  const data = ui.overview;
  const open = data.votingOpen;
  let lastAct = "";
  const results = data.categories.map((category) => {
    const head = category.actTitle !== lastAct ? `<h2 class="section-label">${esc(category.actTitle)}</h2>` : "";
    lastAct = category.actTitle;
    return head + resultCard(category);
  }).join("");
  const track = data.trackReady
    ? "Trilha: Horn of Plenty"
    : "Para tocar Horn of Plenty, salve o instrumental em public/audio/horn-of-plenty.mp3 e recarregue.";
  return `
    <div class="screen${animate ? " is-entering" : ""}">
      <div class="sheet admin-sheet">
        <header class="admin-hero">
          <img class="crest crest-small" src="/logo.png" alt="">
          <p class="act-kicker">Teha X Awards · ${esc(data.edition)}</p>
          <h1>Apuração</h1>
          <p class="status-line">${open ? "A urna está aberta." : "A urna está lacrada."}</p>
        </header>
        ${votingGateHtml(open)}
        <div class="hero-actions no-print">
          <button type="button" class="ghost" data-action="copy">Copiar resumo</button>
          <button type="button" class="ghost" data-action="download">Baixar JSON</button>
          <button type="button" class="ghost" data-action="slips">${ui.slips ? "Ocultar cédulas" : "Ver cédulas"}</button>
          <button type="button" class="linkish" data-action="splash">Voltar à entrada</button>
        </div>
        <p class="track-note">${esc(track)}</p>
        <ul class="stats">
          <li><strong>${data.voterCount}</strong><span>cédulas</span></li>
          <li><strong>${data.complete}</strong><span>completas</span></li>
          <li><strong>${data.categoryCount}</strong><span>categorias</span></li>
          <li><strong>${data.mediaPhotos || 0}</strong><span>fotos</span></li>
          <li><strong>${data.mediaAudios || 0}</strong><span>defesas</span></li>
        </ul>
        ${studioHtml(data.studio)}
        <h2 class="section-label">Quem entrou</h2>
        ${rollHtml(data.voters)}
        ${results}
        ${ui.slips ? slipsHtml(data.voters) : ""}
        ${dangerHtml()}
      </div>
    </div>`;
}

function paintAdmin(keepScroll) {
  const y = keepScroll ? window.scrollY : 0;
  app.innerHTML = adminHtml(false);
  if (keepScroll) window.scrollTo(0, y);
}

function renderAdmin() {
  screen = "admin";
  document.body.dataset.screen = "admin";
  document.title = "Apuração · Teha X Awards";
  try { sessionStorage.setItem("tehax-admin-open", "1"); } catch { /* a mesa segue nesta visita */ }
  leave();
  app.innerHTML = adminHtml(true);
  window.scrollTo(0, 0);
  timer = setInterval(pollAdmin, 4000);
}

function applyOverview(overview) {
  ui.overview = overview;
  ui.snap = JSON.stringify(overview);
  if (screen === "admin") paintAdmin(true);
}

async function openAdmin() {
  sfx("click");
  leave();
  try { sessionStorage.setItem("tehax-admin-open", "1"); } catch { /* segue */ }
  let token = "";
  try { token = sessionStorage.getItem("tehax-admin") || ""; } catch { token = ""; }
  if (!token) {
    renderAdminLogin();
    return;
  }
  try {
    const data = await api("/api/admin/overview", { admin: true });
    ui.overview = data;
    ui.snap = JSON.stringify(data);
    renderAdmin();
  } catch {
    try { sessionStorage.removeItem("tehax-admin"); } catch { /* segue */ }
    renderAdminLogin();
  }
}

async function enterCeremony(raw) {
  armMusic();
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 32) {
    sfx("deny");
    shake("#gate-form");
    toast("Diga seu nome para entrar.");
    return;
  }
  const button = document.querySelector("#gate-form button");
  if (button) {
    button.disabled = true;
    button.textContent = "Entrando…";
  }
  try {
    let token = "";
    try { token = localStorage.getItem("tehax-voter") || ""; } catch { token = ""; }
    const data = await api("/api/session", { method: "POST", body: { name, token } });
    localStorage.setItem("tehax-voter", data.token);
    localStorage.setItem("tehax-name", data.voter.name);
    sessionStorage.setItem("tehax-inside", "1");
    rememberBallot(data);
    sfx("enter");
    renderBallot();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Entrar";
    }
    sfx("deny");
    shake("#gate-form");
    toast(failMessage(error));
  }
}

async function loginAdmin(password) {
  armMusic();
  const button = document.querySelector("#admin-form button");
  if (button) {
    button.disabled = true;
    button.textContent = "Entrando…";
  }
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: { password: String(password || "") },
    });
    sessionStorage.setItem("tehax-admin", data.token);
    sessionStorage.setItem("tehax-admin-open", "1");
    sfx("enter");
    await openAdmin();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Entrar";
    }
    sfx("deny");
    shake("#admin-form");
    toast(failMessage(error));
  }
}

function switchName() {
  sfx("click");
  try { sessionStorage.removeItem("tehax-inside"); } catch { /* segue */ }
  renderSplash();
  const input = document.querySelector("#nome");
  if (input) {
    input.focus();
    input.select();
  }
}

function paintVote(categoryId) {
  const choice = state.ballot.votes[categoryId];
  const root = app.querySelector(`[data-card="${CSS.escape(categoryId)}"]`);
  if (!root) return;
  root.classList.toggle("is-done", Boolean(choice));
  const note = root.querySelector(".done-note");
  if (note) note.classList.toggle("is-hidden", !choice);
  root.querySelectorAll('input[type="radio"]').forEach((input) => {
    const on = input.value === choice;
    input.checked = on;
    input.closest(".nominee, .throne")?.classList.toggle("is-selected", on);
    const kicker = input.closest(".throne")?.querySelector(".throne-kicker");
    if (kicker) kicker.textContent = on ? "Seu voto" : "Indicado";
  });
  paintProgress();
}

async function cast(categoryId, candidate) {
  if (!state.ballot?.votingOpen || pending.has(categoryId)) return;
  if (state.ballot.votes[categoryId] === candidate) return;
  pending.add(categoryId);
  const previous = state.ballot.votes[categoryId];
  state.ballot.votes[categoryId] = candidate;
  state.stamp = ballotStamp(state.ballot);
  paintVote(categoryId);
  try {
    const data = await api("/api/votes", { method: "POST", body: { categoryId, candidate } });
    state.ballot.votes = data.votes;
    state.stamp = ballotStamp(state.ballot);
    paintVote(categoryId);
    sfx("vote");
    toast("Voto lavrado");
  } catch (error) {
    if (previous) state.ballot.votes[categoryId] = previous;
    else delete state.ballot.votes[categoryId];
    state.stamp = ballotStamp(state.ballot);
    sfx("deny");
    if (error.status === 423) {
      state.ballot.votingOpen = false;
      toast(failMessage(error));
      paintBallot(true, false);
    } else {
      paintVote(categoryId);
      toast(failMessage(error));
    }
  } finally {
    pending.delete(categoryId);
  }
}

async function pollBallot() {
  if (screen !== "ballot") return;
  try {
    const data = await api("/api/session");
    const stamp = ballotStamp(data);
    if (stamp === state.stamp) return;
    const wasOpen = state.ballot?.votingOpen;
    rememberBallot(data);
    if (screen !== "ballot") return;
    if (wasOpen !== data.votingOpen) {
      sfx(data.votingOpen ? "open" : "seal");
      toast(data.votingOpen ? "A urna foi aberta." : "A urna foi lacrada.");
    }
    paintBallot(true, false);
  } catch (error) {
    if (error.status === 401 && screen === "ballot") {
      try {
        localStorage.removeItem("tehax-voter");
        localStorage.removeItem("tehax-name");
        sessionStorage.removeItem("tehax-inside");
      } catch { /* segue para a entrada */ }
      toast("Sua cédula não está mais na mesa.");
      renderSplash();
    }
  }
}

async function pollAdmin() {
  if (screen !== "admin") return;
  if (document.activeElement?.matches("input, textarea, select")) return;
  try {
    const data = await api("/api/admin/overview", { admin: true });
    const snap = JSON.stringify(data);
    if (snap === ui.snap) return;
    ui.snap = snap;
    ui.overview = data;
    if (screen === "admin") paintAdmin(true);
  } catch (error) {
    if (error.status === 401 && screen === "admin") {
      try { sessionStorage.removeItem("tehax-admin"); } catch { /* segue */ }
      toast("A mesa expirou.");
      renderAdminLogin();
    }
  }
}

async function toggleVoting() {
  const open = !ui.overview.votingOpen;
  try {
    const data = await api("/api/admin/voting", { method: "POST", admin: true, body: { open } });
    applyOverview(data.overview);
    sfx(open ? "open" : "seal");
    toast(open ? "Votação liberada." : "Votação bloqueada.");
  } catch (error) {
    sfx("deny");
    toast(failMessage(error));
    if (error.status === 401) {
      try { sessionStorage.removeItem("tehax-admin"); } catch { /* segue */ }
      renderAdminLogin();
    }
  }
}

async function resetVotes() {
  const word = document.querySelector("#reset-word")?.value || "";
  try {
    const data = await api("/api/admin/reset", { method: "POST", admin: true, body: { confirm: word } });
    ui.resetOpen = false;
    ui.resetWord = "";
    applyOverview(data.overview);
    sfx("seal");
    toast("Votos zerados.");
  } catch (error) {
    sfx("deny");
    toast(failMessage(error));
  }
}

async function restartCeremony() {
  const word = document.querySelector("#restart-word")?.value || "";
  try {
    const data = await api("/api/admin/restart", { method: "POST", admin: true, body: { confirm: word } });
    ui.restartOpen = false;
    ui.restartWord = "";
    applyOverview(data.overview);
    sfx("seal");
    toast("Cerimônia recomeçada.");
  } catch (error) {
    sfx("deny");
    toast(failMessage(error));
  }
}

async function releaseVoter(id, name) {
  if (!window.confirm(`Liberar ${name}? Os votos dessa cédula saem da urna.`)) return;
  try {
    const data = await api("/api/admin/release", { method: "POST", admin: true, body: { id } });
    applyOverview(data.overview);
    sfx("soft");
    toast(`${name} saiu da cerimônia.`);
  } catch (error) {
    sfx("deny");
    toast(failMessage(error));
  }
}

async function deleteMedia(categoryId, nominee, which) {
  try {
    const data = await api("/api/admin/media/delete", {
      method: "POST",
      admin: true,
      body: { categoryId, nominee, which },
    });
    applyOverview(data.overview);
    sfx("soft");
    toast("Mídia removida.");
  } catch (error) {
    sfx("deny");
    toast(failMessage(error));
  }
}

function probeAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    const done = (ms, error) => {
      URL.revokeObjectURL(url);
      probe.removeAttribute("src");
      if (error) reject(error);
      else resolve(ms);
    };
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      if (!Number.isFinite(probe.duration) || probe.duration === Infinity) {
        done(0, new Error("Duração ilegível."));
        return;
      }
      done(Math.round(probe.duration * 1000));
    };
    probe.onerror = () => done(0, new Error("Áudio inválido."));
    probe.src = url;
  });
}

async function handleUpload(input) {
  const file = input.files?.[0];
  const kind = input.dataset.upload;
  const categoryId = input.dataset.category;
  const nominee = input.dataset.nominee;
  input.value = "";
  if (!file || !kind || !categoryId || !nominee) return;
  try {
    const form = new FormData();
    form.append("categoryId", categoryId);
    form.append("nominee", nominee);
    form.append("kind", kind);
    form.append("file", file, file.name);
    if (kind === "audio") {
      const ms = await probeAudioDuration(file);
      if (ms > 15500) {
        sfx("deny");
        toast("A defesa precisa ter no máximo 15 segundos.");
        return;
      }
      form.append("audioMs", String(ms));
    }
    toast(kind === "photo" ? "Enviando foto…" : "Enviando áudio…");
    const data = await uploadApi(form);
    applyOverview(data.overview);
    sfx("vote");
    toast(kind === "photo" ? "Foto publicada." : "Defesa publicada.");
  } catch (error) {
    sfx("deny");
    toast(failMessage(error));
  }
}

function summaryText() {
  const data = ui.overview;
  const lines = [`TEHA X AWARDS ${data.edition}`, data.votingOpen ? "Urna aberta" : "Urna lacrada", ""];
  let act = "";
  for (const category of data.categories) {
    if (category.actTitle !== act) {
      act = category.actTitle;
      lines.push(act.toUpperCase(), "");
    }
    lines.push(category.title, verdictOf(category));
    for (const row of category.rows) lines.push(`${row.votes}  ${row.name}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function copySummary() {
  const text = summaryText();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      sfx("soft");
      toast("Resumo copiado.");
      return;
    }
  } catch { /* tenta o caminho antigo */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  sfx(ok ? "soft" : "deny");
  toast(ok ? "Resumo copiado." : "O resumo está no JSON.");
}

function downloadOverview() {
  const blob = new Blob([JSON.stringify(ui.overview, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "apuracao-teha-x-awards.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  sfx("soft");
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || !app.contains(target)) return;
  const action = target.dataset.action;
  if (action === "defense") {
    event.preventDefault();
    event.stopPropagation();
    playDefense(target.dataset.src);
    return;
  }
  if (action === "admin") openAdmin();
  else if (action === "splash") {
    sfx("click");
    renderSplash();
  } else if (action === "switch") switchName();
  else if (action === "toggle-voting") toggleVoting();
  else if (action === "copy") copySummary();
  else if (action === "download") downloadOverview();
  else if (action === "studio-toggle") {
    sfx("click");
    ui.studioOpen = !ui.studioOpen;
    paintAdmin(true);
  } else if (action === "media-del") {
    deleteMedia(target.dataset.category, target.dataset.nominee, target.dataset.which);
  } else if (action === "slips") {
    sfx("click");
    ui.slips = !ui.slips;
    paintAdmin(true);
  } else if (action === "reset-show") {
    sfx("click");
    ui.resetOpen = !ui.resetOpen;
    paintAdmin(true);
  } else if (action === "restart-show") {
    sfx("click");
    ui.restartOpen = !ui.restartOpen;
    paintAdmin(true);
  } else if (action === "release") releaseVoter(target.dataset.id, target.dataset.name);
});

app.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.upload) {
    handleUpload(input);
    return;
  }
  if (input.type !== "radio") return;
  cast(input.name, input.value);
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "gate-form") enterCeremony(new FormData(form).get("nome"));
  else if (form.id === "admin-form") loginAdmin(new FormData(form).get("password"));
  else if (form.id === "reset-form") resetVotes();
  else if (form.id === "restart-form") restartCeremony();
});

app.addEventListener("input", (event) => {
  if (event.target.id === "reset-word") ui.resetWord = event.target.value;
  if (event.target.id === "restart-word") ui.restartWord = event.target.value;
});

async function boot() {
  paintMusic();
  const musicReady = bootMusic();
  try {
    if (sessionStorage.getItem("tehax-admin-open") === "1") {
      await openAdmin();
    } else if (sessionStorage.getItem("tehax-inside") === "1" && localStorage.getItem("tehax-voter")) {
      try {
        const data = await api("/api/session");
        rememberBallot(data);
        renderBallot();
      } catch {
        localStorage.removeItem("tehax-voter");
        localStorage.removeItem("tehax-name");
        sessionStorage.removeItem("tehax-inside");
        renderSplash();
      }
    } else {
      renderSplash();
    }
  } catch {
    renderSplash();
  } finally {
    await musicReady;
  }
}

boot();
