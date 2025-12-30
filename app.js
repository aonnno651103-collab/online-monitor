// app.js (Google Sites / GitHub Pages 安定版：index.html に合わせた修正版)

const CV_MAIN = document.getElementById("cvMain");
const CTX_MAIN = CV_MAIN.getContext("2d");
const CV_BRANCH = document.getElementById("cvBranch");
const CTX_BRANCH = CV_BRANCH.getContext("2d");

const clockEl = document.getElementById("clock");
const runningCountEl = document.getElementById("runningCount");
const badgeDayEl = document.getElementById("badgeDay");
const legendEl = document.getElementById("legend");

const toggleBtn = document.getElementById("toggle");
const btnNow = document.getElementById("btnNow");
const btnNow2 = document.getElementById("btnNow2");
const btnFirst = document.getElementById("btnFirst");
const btnWeekday = document.getElementById("btnWeekday");
const btnHoliday = document.getElementById("btnHoliday");

// modal（index.htmlに合わせる）
const modalBack = document.getElementById("modalBack");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

// ---- 設定 ----
const DATA_WEEKDAY_URL = "./out/tosaden_weekday.json";
const DATA_HOLIDAY_URL = "./out/tosaden_holiday.json";

// 列車の見た目
const TRAIN_R = 12;
const TRAIN_FONT = "12px sans-serif";

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

// ---- 状態 ----
let DATA = null;
let nowSec = 0;
let playing = true;        // index.htmlのボタンが「❚❚」なので最初は再生に合わせる
let raf = null;

let baseSpeed = 1;         // x1 = 実時間
let speedMul = 0.5;        // index.htmlでx0.5がactive想定
let MAIN_RUNNING = 0;
let BR_RUNNING = 0;

let forceType = null;      // "weekday" / "holiday" を強制する（null=自動）

function clampNow(){
  if(!DATA) return;
  const s0 = DATA.meta.serviceStartSec;
  const s1 = DATA.meta.serviceEndSec;
  if(nowSec < s0) nowSec = s0;
  if(nowSec > s1) nowSec = s1;
}

function syncToRealTime(){
  const d = new Date();
  nowSec = d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds();
  clampNow();
}

// ---- Canvasを表示サイズに合わせる（ぼやけ/ズレ対策）----
function fitCanvasToCSS(canvas){
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

// ---- データ読み込み ----
async function loadData(){
  const type = forceType || getTodayType();
  const url = (type==="holiday") ? DATA_HOLIDAY_URL : DATA_WEEKDAY_URL;

  badgeDayEl.textContent = (type==="holiday") ? "土日祝" : "平日";
  badgeDayEl.className = (type==="holiday") ? "badge holiday" : "badge weekday";

  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  DATA = await res.json();

  // 正規化
  if(Array.isArray(DATA.trips)){
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
  if(!DATA) return;
  const map = DATA.meta?.routeLegend || {};
  const keys = Object.keys(map);
  legendEl.textContent = keys.length ? keys.map(k=>`${k}:${map[k]}`).join(" / ") : "";
}

// ---- 描画 ----
function clear(ctx, w, h){ ctx.clearRect(0,0,w,h); }

function drawAxis(ctx, axisStations, w, x0, x1, y){
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();

  const n = axisStations.length;
  for(let i=0;i<n;i++){
    const st = axisStations[i];
    const x = x0 + (x1-x0) * (i/(n-1));
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#777";
    ctx.beginPath();
    ctx.moveTo(x, y-8);
    ctx.lineTo(x, y+8);
    ctx.stroke();

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(st, x, y+10);
  }
}

function interpPos(tr, sec){
  const stops = tr.stops || [];
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
  let running = 0;
  for(const tr of trips){
    const p = interpPos(tr, nowSec);
    if(!p) continue;

    const n = axisStations.length;
    const x = x0 + (x1-x0) * (p.axisIndex/(n-1));
    const y = rowY;

    // 円
    ctx.beginPath();
    ctx.fillStyle = tr.color || "#3498db";
    ctx.strokeStyle = "#1f4e79";
    ctx.lineWidth = 2;
    ctx.arc(x, y, TRAIN_R, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // ラベル
    const label = tr.label || tr.no || "";
    if(label){
      ctx.font = TRAIN_FONT;
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y);
    }

    // 停車中表示
    if(p.stopped && p.atStation){
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#2c3e50";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(p.atStation, x, y-TRAIN_R-6);
    }

    tr[hitProp] = {x, y, r: TRAIN_R + 8};
    running++;
  }
  return running;
}

function renderMain(){
  const w = CV_MAIN.width, h = CV_MAIN.height;
  clear(CTX_MAIN, w, h);
  if(!DATA) return;

  const axis = DATA.meta.axisStations.main || [];
  const y = Math.round(h*0.58);
  drawAxis(CTX_MAIN, axis, w, 80, w-80, y);

  const trips = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="main");
  MAIN_RUNNING = drawTripsOnAxis(CTX_MAIN, axis, w, {x0:80, x1:w-80, rowY:y-40}, trips, "_hit");
}

function renderBranch(){
  const w = CV_BRANCH.width, h = CV_BRANCH.height;
  clear(CTX_BRANCH, w, h);
  if(!DATA) return;

  const axis = DATA.meta.axisStations.branch || [];
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
  if(!clockEl || !runningCountEl) return;
  clockEl.textContent = secToClock(nowSec);
  renderMain();
  renderBranch();
  runningCountEl.textContent = String((MAIN_RUNNING||0) + (BR_RUNNING||0));
}

// ---- モーダル ----
function isMajorStop(name){ return MAJOR_SET.has(normStation(name)); }

function showModal(trip){
  if(!modal || !modalBack || !modalBody) return;

  modalTitle.textContent = trip.name || trip.label || trip.no || "列車";
  modalBody.innerHTML = "";

  const p = interpPos(trip, nowSec);
  const pDiv = document.createElement("div");
  pDiv.className = "row";
  pDiv.textContent = p ? (p.stopped ? `停車中：${p.atStation||""}` : "走行中") : "情報なし";
  modalBody.appendChild(pDiv);

  const table = document.createElement("table");
  table.className = "tbl";
  for(const st of (trip.stops || [])){
    const name = normStation(st.station);
    const arr = st.arrSec != null ? secToClock(st.arrSec) : "";
    const dep = st.depSec != null ? secToClock(st.depSec) : "";
    const txt = (arr && dep && arr!==dep) ? `${arr} / ${dep}` : (arr || dep || "");

    const tr = document.createElement("tr");
    if(isMajorStop(name)) tr.classList.add("major");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    td1.textContent = name;
    td2.textContent = txt;
    tr.appendChild(td1); tr.appendChild(td2);
    table.appendChild(tr);
  }
  modalBody.appendChild(table);

  modalBack.hidden = false;
  modal.hidden = false;
}
function closeModal(){
  if(modalBack) modalBack.hidden = true;
  if(modal) modal.hidden = true;
}
if(modalBack){
  modalBack.addEventListener("click", (e)=>{ if(e.target===modalBack) closeModal(); });
}
if(modalClose){
  modalClose.addEventListener("click", closeModal);
}

// ---- クリック判定 ----
function hitTest(tr, mx, my, mode){
  const h = (mode==="branch") ? tr._hit_branch : tr._hit;
  if(!h) return false;
  const dx = mx - h.x, dy = my - h.y;
  return (dx*dx + dy*dy) <= (h.r*h.r);
}

CV_MAIN.addEventListener("click", (e)=>{
  if(!DATA) return;
  const r = CV_MAIN.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CV_MAIN.width / r.width);
  const my = (e.clientY - r.top) * (CV_MAIN.height / r.height);
  for(const tr of (DATA.displayTrips || DATA.trips || [])){
    if(hitTest(tr, mx, my, "main")){
      showModal(tr);
      return;
    }
  }
});

CV_BRANCH.addEventListener("click", (e)=>{
  if(!DATA) return;
  const r = CV_BRANCH.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (CV_BRANCH.width / r.width);
  const my = (e.clientY - r.top) * (CV_BRANCH.height / r.height);
  for(const tr of (DATA.displayTrips || DATA.trips || [])){
    if(hitTest(tr, mx, my, "branch")){
      showModal(tr);
      return;
    }
  }
});

// ---- UI：再生/停止 ----
function updatePlayButton(){
  toggleBtn.textContent = playing ? "❚❚" : "▶";
}
updatePlayButton();

toggleBtn.addEventListener("click", ()=>{
  playing = !playing;
  updatePlayButton();
});

// ---- UI：現在へ ----
function jumpNow(){
  syncToRealTime();
  render();
}
btnNow?.addEventListener("click", jumpNow);
btnNow2?.addEventListener("click", jumpNow);

// ---- UI：始発へ ----
btnFirst?.addEventListener("click", ()=>{
  if(!DATA) return;
  nowSec = DATA.meta.serviceStartSec;
  render();
});

// ---- UI：スキップ ----
document.querySelectorAll("button[data-skip]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const v = Number(btn.getAttribute("data-skip") || "0");
    nowSec += v;
    clampNow();
    render();
  });
});

// ---- UI：速度 ----
document.querySelectorAll("button.speed[data-speed]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("button.speed").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    speedMul = Number(btn.getAttribute("data-speed") || "1");
  });
});

// ---- UI：平日/土日祝切替 ----
btnWeekday?.addEventListener("click", async ()=>{
  forceType = "weekday";
  await loadData();
  render();
});
btnHoliday?.addEventListener("click", async ()=>{
  forceType = "holiday";
  await loadData();
  render();
});

// ---- ループ ----
let lastTs = null;
function loop(ts){
  if(lastTs==null) lastTs = ts;
  const dt = (ts - lastTs) / 1000.0;
  lastTs = ts;

  if(playing && DATA){
    const sp = baseSpeed * speedMul; // x1=実時間
    nowSec += dt * sp;
    clampNow();
    render();
  }
  raf = requestAnimationFrame(loop);
}

(async function init(){
  try{
    await loadData();
    syncToRealTime();
    resizeAll();
    render();
    raf = requestAnimationFrame(loop);

    // iframe/バックグラウンドでrAFが間引かれても最低限進める保険
    setInterval(() => {
      if(!DATA) return;
      if(!playing) return;
      const sp = baseSpeed * speedMul;
      nowSec += 1 * sp;
      clampNow();
      render();
    }, 1000);

  }catch(err){
    console.error(err);
    // 画面にも最低限出す
    if(legendEl) legendEl.textContent = "データ読み込み失敗: " + String(err?.message || err);
  }
})();
