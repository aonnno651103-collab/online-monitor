/* app.js - GitHub Pages / Google Sites 安定版（要素が無くても落ちない＋ダーク背景対応）
 * - out/tosaden_weekday.json / out/tosaden_holiday.json を読み込み
 * - 在線（線路＋列車）をCanvasに描画
 * - UI要素が存在しない場合は自動的にスキップ（addEventListenerで落ちない）
 * - ダークテーマでも見えるように軸・文字・列車色を明るめに調整
 */

console.log("app.js safe dark build loaded");

// ====== DOM helpers（null安全） ======
const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => {
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
  return el;
};
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

// ====== Elements（無ければnullのまま） ======
const CV_MAIN = $("cvMain");
const CV_BRANCH = $("cvBranch");
const CTX_MAIN = CV_MAIN?.getContext?.("2d") || null;
const CTX_BRANCH = CV_BRANCH?.getContext?.("2d") || null;

const clockEl = $("clock");
const runningCountEl = $("runningCount");
const badgeDayEl = $("badgeDay");
const legendEl = $("legend");

const toggleBtn = $("toggle");
const btnNow = $("btnNow");
const btnNow2 = $("btnNow2");
const btnFirst = $("btnFirst");
const btnWeekday = $("btnWeekday");
const btnHoliday = $("btnHoliday");

// modal（index側の構造差を吸収）
const modalBack = $("modalBack");
const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const modalClose = $("modalClose");
const modalJumpNow = $("modalJumpNow");

// ====== Config ======
const DATA_WEEKDAY_URL = "./out/tosaden_weekday.json";
const DATA_HOLIDAY_URL = "./out/tosaden_holiday.json";

const TRAIN_R = 12;
const TRAIN_FONT = "12px sans-serif";

// ダーク背景向けの見える色
const COLOR_AXIS = "#cfd8dc";      // 主線
const COLOR_TICK = "#b0bec5";      // 目盛り
const COLOR_TEXT = "#e8eaed";      // 駅名など
const COLOR_TRAIN_FILL = "#4ea3ff"; // デフォ列車色
const COLOR_TRAIN_STROKE = "#e8eaed";
const COLOR_STOP_MAJOR = "#ff6b6b";
const COLOR_STOP_NORMAL = "#e8eaed";

// 主要停留場（赤字）
const MAJOR_STATIONS = [
  "高知駅前","はりまや橋","県庁前","高知城前","堀詰","宝永町","知寄町","知寄町三丁目",
  "後免町","後免東町","後免中町","後免西町","領石通","北浦","船戸","篠原","住吉通",
  "東新木","田辺島通","鹿児","舟戸","デンテツターミナルビル前","高須","県立美術館通",
  "葛島橋東詰","西高須","一条橋","梅の辻","枡形","上町一丁目",
  "上町二丁目","上町四丁目","旭町一丁目","旭町三丁目","鏡川橋","蛍橋","旭駅前通",
  "桟橋通五丁目","桟橋通四丁目","桟橋通三丁目","桟橋通二丁目","桟橋通一丁目"
];
const ST_ALIAS = {
  "電鉄ターミナルビル前": "デンテツターミナルビル前"
};

function normStation(s){
  if(!s) return "";
  const t = String(s).trim();
  return ST_ALIAS[t] || t;
}
const MAJOR_SET = new Set(MAJOR_STATIONS.map(normStation));

function pad2(n){ return String(n).padStart(2,"0"); }
function secToClock(sec){
  sec = Math.floor(sec);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function getTodayType(){
  const d = new Date();
  const dow = d.getDay(); // 0=Sun
  return (dow===0 || dow===6) ? "holiday" : "weekday";
}

// ====== State ======
let DATA = null;
let nowSec = 0;
let playing = true;    // 初期は再生
let raf = null;

let baseSpeed = 1;     // 実時間
let speedMul = 0.5;    // デフォルトx0.5（UIがそうなりがち）
let forceType = null;  // "weekday" / "holiday" / null

let MAIN_RUNNING = 0;
let BR_RUNNING = 0;

// ====== Safety: canvas resize to CSS size ======
function fitCanvasToCSS(canvas){
  if(!canvas) return;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if(canvas.width !== w) canvas.width = w;
  if(canvas.height !== h) canvas.height = h;
}
function resizeAll(){
  try{
    fitCanvasToCSS(CV_MAIN);
    fitCanvasToCSS(CV_BRANCH);
  }catch(_){}
  render();
}
window.addEventListener("resize", resizeAll);

// ====== Data ======
function clampNow(){
  if(!DATA?.meta) return;
  const s0 = DATA.meta.serviceStartSec ?? 0;
  const s1 = DATA.meta.serviceEndSec ?? 24*3600-1;
  if(nowSec < s0) nowSec = s0;
  if(nowSec > s1) nowSec = s1;
}

function syncToRealTime(){
  const d = new Date();
  nowSec = d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds();
  clampNow();
}

async function loadData(){
  const type = forceType || getTodayType();
  const url = (type==="holiday") ? DATA_HOLIDAY_URL : DATA_WEEKDAY_URL;

  if(badgeDayEl){
    badgeDayEl.textContent = (type==="holiday") ? "土日祝" : "平日";
    badgeDayEl.className = (type==="holiday") ? "badge holiday" : "badge weekday";
  }

  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  DATA = await res.json();

  // 正規化
  if(Array.isArray(DATA?.trips)){
    for(const tr of DATA.trips){
      tr.from = normStation(tr.from);
      tr.to = normStation(tr.to);
      if(Array.isArray(tr.stops)){
        for(const st of tr.stops){
          st.station = normStation(st.station);
        }
      }
    }
  }
  buildLegend();
  clampNow();
}

function buildLegend(){
  if(!legendEl) return;
  const map = DATA?.meta?.routeLegend || {};
  const keys = Object.keys(map);
  legendEl.textContent = keys.length ? keys.map(k=>`${k}:${map[k]}`).join(" / ") : "";
}

// ====== Render primitives ======
function clear(ctx, w, h){
  ctx.clearRect(0,0,w,h);
}

function drawAxis(ctx, axisStations, w, x0, x1, y){
  if(!ctx || !axisStations?.length) return;

  // 軸線（見える色）
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLOR_AXIS;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();

  // 駅目盛り＆駅名（見える色）
  const n = axisStations.length;
  for(let i=0;i<n;i++){
    const st = axisStations[i];
    const x = x0 + (x1-x0) * (i/(n-1));

    ctx.lineWidth = 2;
    ctx.strokeStyle = COLOR_TICK;
    ctx.beginPath();
    ctx.moveTo(x, y-8);
    ctx.lineTo(x, y+8);
    ctx.stroke();

    ctx.font = "14px sans-serif";
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(st, x, y+10);
  }
}

function interpPos(tr, sec){
  const stops = tr?.stops || [];
  if(stops.length===0) return null;

  // 停車中固定
  for(const st of stops){
    const a = st.arrSec ?? st.timeSec ?? null;
    const d = st.depSec ?? st.timeSec ?? null;
    if(a!=null && d!=null && a<=sec && sec<=d){
      return {axisIndex: st.axisIndex, stopped:true, atStation: st.station};
    }
  }

  // 走行区間
  for(let i=0;i<stops.length-1;i++){
    const s0 = stops[i];
    const s1 = stops[i+1];
    const t0 = (s0.depSec ?? s0.timeSec);
    const t1 = (s1.arrSec ?? s1.timeSec);
    if(t0==null || t1==null) continue;
    if(t0<=sec && sec<=t1){
      const p0 = s0.axisIndex;
      const p1 = s1.axisIndex;
      if(p0==null || p1==null) return null;
      const r = (sec - t0) / Math.max(1, (t1 - t0));
      return {axisIndex: p0 + (p1-p0)*r, stopped:false, atStation:null};
    }
  }
  return null;
}

function drawTripsOnAxis(ctx, axisStations, w, {x0,x1,rowY}, trips, hitProp){
  if(!ctx || !axisStations?.length) return 0;
  let running = 0;

  for(const tr of trips){
    const p = interpPos(tr, nowSec);
    if(!p) continue;

    const n = axisStations.length;
    const x = x0 + (x1-x0) * (p.axisIndex/(n-1));
    const y = rowY;

    // 列車（見える色）
    ctx.beginPath();
    ctx.fillStyle = tr.color || COLOR_TRAIN_FILL;
    ctx.strokeStyle = COLOR_TRAIN_STROKE;
    ctx.lineWidth = 2;
    ctx.arc(x, y, TRAIN_R, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // ラベル
    const label = tr.label || tr.no || "";
    if(label){
      ctx.font = TRAIN_FONT;
      ctx.fillStyle = "#0b0b0b"; // 塗りが明るいので文字は黒寄りが見やすい
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y);
    }

    // 停車駅名
    if(p.stopped && p.atStation){
      ctx.font = "12px sans-serif";
      ctx.fillStyle = MAJOR_SET.has(normStation(p.atStation)) ? COLOR_STOP_MAJOR : COLOR_STOP_NORMAL;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(p.atStation, x, y-TRAIN_R-6);
    }

    tr[hitProp] = {x, y, r: TRAIN_R + 10};
    running++;
  }
  return running;
}

function renderMain(){
  if(!CTX_MAIN || !CV_MAIN || !DATA) return;
  const w = CV_MAIN.width, h = CV_MAIN.height;
  clear(CTX_MAIN, w, h);

  const axis = DATA?.meta?.axisStations?.main || [];
  if(axis.length === 0) return;

  const y = Math.round(h*0.58);
  drawAxis(CTX_MAIN, axis, w, 80, w-80, y);

  const trips = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="main");
  MAIN_RUNNING = drawTripsOnAxis(CTX_MAIN, axis, w, {x0:80, x1:w-80, rowY:y-40}, trips, "_hit");
}

function renderBranch(){
  if(!CTX_BRANCH || !CV_BRANCH || !DATA) return;
  const w = CV_BRANCH.width, h = CV_BRANCH.height;
  clear(CTX_BRANCH, w, h);

  const axis = DATA?.meta?.axisStations?.branch || [];
  if(axis.length === 0) return;

  const yMid = Math.round(h*0.58);
  const gap = 52;

  drawAxis(CTX_BRANCH, axis, w, 80, w-80, yMid-gap);
  drawAxis(CTX_BRANCH, axis, w, 80, w-80, yMid+gap);

  const tripsUp = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="branch_up");
  const tripsDn = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="branch_dn");

  const r1 = drawTripsOnAxis(CTX_BRANCH, axis, w, {x0:80, x1:w-80, rowY:(yMid-gap)-40}, tripsUp, "_hit_branch");
  const r2 = drawTripsOnAxis(CTX_BRANCH, axis, w, {x0:80, x1:w-80, rowY:(yMid+gap)-40}, tripsDn, "_hit_branch");
  BR_RUNNING = r1 + r2;
}

function render(){
  if(clockEl) clockEl.textContent = secToClock(nowSec);
  renderMain();
  renderBranch();
  if(runningCountEl) runningCountEl.textContent = String((MAIN_RUNNING||0) + (BR_RUNNING||0));
}

// ====== Modal (柔軟対応) ======
function openModal(trip){
  if(!modalBack || !modal) return;

  let titleEl = modalTitle;
  let bodyEl = modalBody;

  if(!titleEl){
    titleEl = document.createElement("div");
    titleEl.id = "modalTitle";
    titleEl.style.fontSize = "18px";
    titleEl.style.fontWeight = "700";
    titleEl.style.marginBottom = "8px";
    modal.appendChild(titleEl);
  }
  if(!bodyEl){
    bodyEl = document.createElement("div");
    bodyEl.id = "modalBody";
    modal.appendChild(bodyEl);
  }

  titleEl.textContent = trip.name || trip.label || trip.no || "列車";
  bodyEl.innerHTML = "";

  const p = interpPos(trip, nowSec);
  const pDiv = document.createElement("div");
  pDiv.textContent = p ? (p.stopped ? `停車中：${p.atStation||""}` : "走行中") : "情報なし";
  pDiv.style.marginBottom = "10px";
  bodyEl.appendChild(pDiv);

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  for(const st of (trip.stops || [])){
    const name = normStation(st.station);
    const arr = st.arrSec != null ? secToClock(st.arrSec) : "";
    const dep = st.depSec != null ? secToClock(st.depSec) : "";
    const txt = (arr && dep && arr!==dep) ? `${arr} / ${dep}` : (arr || dep || "");

    const trEl = document.createElement("tr");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    td1.textContent = name;
    td2.textContent = txt;

    td1.style.padding = "6px 8px";
    td2.style.padding = "6px 8px";
    td2.style.textAlign = "right";
    td1.style.borderBottom = "1px solid rgba(255,255,255,0.12)";
    td2.style.borderBottom = "1px solid rgba(255,255,255,0.12)";

    if(MAJOR_SET.has(name)){
      td1.style.color = COLOR_STOP_MAJOR;
      td1.style.fontWeight = "700";
    }else{
      td1.style.color = COLOR_TEXT;
    }
    td2.style.color = COLOR_TEXT;

    trEl.appendChild(td1);
    trEl.appendChild(td2);
    table.appendChild(trEl);
  }
  bodyEl.appendChild(table);

  modalBack.hidden = false;
  modal.hidden = false;
}

function closeModal(){
  if(modalBack) modalBack.hidden = true;
  if(modal) modal.hidden = true;
}

modalBack?.addEventListener("click", (e)=>{ if(e.target===modalBack) closeModal(); });
modalClose?.addEventListener("click", closeModal);
modalJumpNow?.addEventListener("click", ()=>{ syncToRealTime(); render(); });

// ====== Hit test ======
function hitTest(tr, mx, my, mode){
  const h = (mode==="branch") ? tr._hit_branch : tr._hit;
  if(!h) return false;
  const dx = mx - h.x, dy = my - h.y;
  return (dx*dx + dy*dy) <= (h.r*h.r);
}

CV_MAIN?.addEventListener("click", (e)=>{
  if(!DATA || !CV_MAIN) return;
  const r = CV_MAIN.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CV_MAIN.width / Math.max(1, r.width));
  const my = (e.clientY - r.top) * (CV_MAIN.height / Math.max(1, r.height));
  for(const tr of (DATA.displayTrips || DATA.trips || [])){
    if(hitTest(tr, mx, my, "main")){
      openModal(tr);
      return;
    }
  }
});

CV_BRANCH?.addEventListener("click", (e)=>{
  if(!DATA || !CV_BRANCH) return;
  const r = CV_BRANCH.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CV_BRANCH.width / Math.max(1, r.width));
  const my = (e.clientY - r.top) * (CV_BRANCH.height / Math.max(1, r.height));
  for(const tr of (DATA.displayTrips || DATA.trips || [])){
    if(hitTest(tr, mx, my, "branch")){
      openModal(tr);
      return;
    }
  }
});

// ====== UI wiring（存在するものだけ） ======
function updatePlayButton(){
  if(!toggleBtn) return;
  toggleBtn.textContent = playing ? "❚❚" : "▶";
}
updatePlayButton();

toggleBtn?.addEventListener("click", ()=>{
  playing = !playing;
  updatePlayButton();
});

function jumpNow(){
  syncToRealTime();
  render();
}
btnNow?.addEventListener("click", jumpNow);
btnNow2?.addEventListener("click", jumpNow);

btnFirst?.addEventListener("click", ()=>{
  if(!DATA?.meta) return;
  nowSec = DATA.meta.serviceStartSec ?? 0;
  clampNow();
  render();
});

btnWeekday?.addEventListener("click", async ()=>{
  try{
    forceType = "weekday";
    await loadData();
    render();
  }catch(err){
    console.error(err);
    if(legendEl) legendEl.textContent = "平日データ読み込み失敗: " + (err?.message || err);
  }
});

btnHoliday?.addEventListener("click", async ()=>{
  try{
    forceType = "holiday";
    await loadData();
    render();
  }catch(err){
    console.error(err);
    if(legendEl) legendEl.textContent = "土日祝データ読み込み失敗: " + (err?.message || err);
  }
});

// data-skip ボタン（存在するなら）
qsa("button[data-skip]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const v = Number(btn.getAttribute("data-skip") || "0");
    nowSec += v;
    clampNow();
    render();
  });
});

// 速度ボタン（存在するなら）
qsa("button.speed[data-speed], .speed[data-speed]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    qsa("button.speed, .speed").forEach(b=>b.classList?.remove?.("active"));
    btn.classList?.add?.("active");
    speedMul = Number(btn.getAttribute("data-speed") || "1");
  });
});

// ダイヤ切替（data-daytypeを使うUIがあれば対応）
qsa("[data-daytype]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const t = btn.getAttribute("data-daytype"); // "weekday"/"holiday"
    if(t !== "weekday" && t !== "holiday") return;
    try{
      forceType = t;
      await loadData();
      render();
    }catch(err){
      console.error(err);
    }
  });
});

// ====== Main loop ======
let lastTs = null;
function loop(ts){
  if(lastTs==null) lastTs = ts;
  const dt = (ts - lastTs) / 1000.0;
  lastTs = ts;

  if(playing && DATA){
    const sp = baseSpeed * speedMul;
    nowSec += dt * sp;
    clampNow();
    render();
  }
  raf = requestAnimationFrame(loop);
}

// rAFが間引かれる環境（iframe等）用の保険
setInterval(() => {
  try{
    if(!DATA) return;
    if(!playing) return;
    const sp = baseSpeed * speedMul;
    nowSec += 1 * sp;
    clampNow();
    render();
  }catch(_){}
}, 1000);

// ====== Init ======
(async function init(){
  try{
    await loadData();
    syncToRealTime();
    resizeAll();
    render();
    raf = requestAnimationFrame(loop);
  }catch(err){
    console.error(err);
    if(legendEl) legendEl.textContent = "データ読み込み失敗: " + (err?.message || err);
  }
})();
