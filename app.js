console.log("TURNBACK_WAIT_FINAL loaded");
console.log("RESET_WORKING_BUILD loaded");
// app.js
// out/tosaden_weekday.json / out/tosaden_holiday.json を読み込み、時刻を進めて列車位置を表示

const CV_MAIN = document.getElementById("cvMain");
const CTX_MAIN = CV_MAIN.getContext("2d");

const CV_BRANCH = document.getElementById("cvBranch");
const CTX_BRANCH = CV_BRANCH.getContext("2d");

const clockEl = document.getElementById("clock");
const runningCountEl = document.getElementById("runningCount");
const badgeDayEl = document.getElementById("badgeDay");
const legendEl = document.getElementById("legend");

const toggleBtn = document.getElementById("toggle");


// ---- Google Sites / iframe 安定化: Canvas を実表示サイズに合わせる ----
// CSSでcanvasが伸縮されると「ぼやけ」「クリック位置ずれ」「環境差」が出やすいので、
// 実際の表示サイズ（getBoundingClientRect）に合わせて canvas の内部解像度を更新する。
// ※DPRスケールは導入せず、既存の座標系(=canvas内部px)を維持して最小変更で安定化します。
function fitCanvasToCSS(canvas){
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if(canvas.width !== w) canvas.width = w;
  if(canvas.height !== h) canvas.height = h;
}

function resizeAll(){
  // まだDOMに描画されていないタイミングだとrectが0になることがあるのでガード
  try{
    fitCanvasToCSS(CV_MAIN);
    fitCanvasToCSS(CV_BRANCH);
  }catch(_){}
  // 既にデータがあるなら即再描画
  if(typeof render === "function") render();
}
window.addEventListener("resize", resizeAll);


const modalBack = document.getElementById("modalBack");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalTable = document.getElementById("modalTable");
const modalClose = document.getElementById("modalClose");
const modalJumpNow = document.getElementById("modalJumpNow");

// ---- 設定 ----
const DATA_WEEKDAY_URL = "./out/tosaden_weekday.json";
const DATA_HOLIDAY_URL = "./out/tosaden_holiday.json";

// 表示する「主要停留場」（モーダルに赤字で表示）
const MAJOR_STATIONS = [
  "高知駅前","はりまや橋","県庁前","高知城前","堀詰","宝永町","知寄町","知寄町三丁目",
  "後免町","後免東町","後免中町","後免西町","領石通","北浦","船戸","篠原","住吉通",
  "東新木","田辺島通","鹿児","舟戸","デンテツターミナルビル前","高須","県立美術館通",
  "葛島橋東詰","西高須","県立美術館通","高須","一条橋","梅の辻","枡形","上町一丁目",
  "上町二丁目","上町四丁目","旭町一丁目","旭町三丁目","鏡川橋","蛍橋","旭駅前通",
  "旭町三丁目","旭町一丁目","上町四丁目","上町二丁目","上町一丁目","枡形","梅の辻",
  "はりまや橋","堀詰","高知城前","県庁前","高知駅前","桟橋通五丁目","桟橋通四丁目",
  "桟橋通三丁目","桟橋通二丁目","桟橋通一丁目"
];

// 表記揺れをまとめる（必要なら増やす）
const ST_ALIAS = {
  "デンテツターミナルビル前": "デンテツターミナルビル前",
  "電鉄ターミナルビル前": "デンテツターミナルビル前"
};

// 列車の見た目
const TRAIN_R = 12;
const TRAIN_FONT = "12px sans-serif";

// 主要停留場で停車中の列車は縦に並べる（重なり防止）
const STACK_AT_MAJOR = true;
const STACK_GAP_PX = 26; // 1両分の縦間隔

// スピード（1秒あたり何秒進むか）
let speed = 60; // 1秒で1分進む

// ---- 状態 ----
let DATA = null;
let nowSec = 0;      // その日の開始からの秒
let playing = false;
let raf = null;

let MAIN_RUNNING = 0;
let BR_RUNNING = 0;

// ---- ユーティリティ ----
function normStation(s){
  if(!s) return "";
  const t = String(s).trim();
  return ST_ALIAS[t] || t;
}

// 正規化後の主要停留場セット（モーダルで赤字）
const MAJOR_SET = new Set(MAJOR_STATIONS.map(s=>normStation(s)));

function pad2(n){ return String(n).padStart(2,"0"); }

function clampNow(){
  if(!DATA) return;
  const s0 = DATA.meta.serviceStartSec;
  const s1 = DATA.meta.serviceEndSec;
  if(nowSec < s0) nowSec = s0;
  if(nowSec > s1) nowSec = s1;
}

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
  // 簡易：土日=holiday扱い。祝日は別途判定するなら拡張。
  return (dow===0 || dow===6) ? "holiday" : "weekday";
}

// ---- データ読み込み ----
async function loadData(){
  const type = getTodayType();
  const url = (type==="holiday") ? DATA_HOLIDAY_URL : DATA_WEEKDAY_URL;

  badgeDayEl.textContent = (type==="holiday") ? "土日祝" : "平日";
  badgeDayEl.className = (type==="holiday") ? "badge holiday" : "badge weekday";

  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`fetch failed: ${res.status}`);
  DATA = await res.json();

  // 主要停留場名の正規化
  if(DATA && Array.isArray(DATA.trips)){
    for(const tr of DATA.trips){
      tr.from = normStation(tr.from);
      tr.to = normStation(tr.to);
      tr.via = normStation(tr.via);
      if(Array.isArray(tr.stops)){
        for(const st of tr.stops){
          st.station = normStation(st.station);
        }
      }
    }
  }

  buildLegend();
}

// ---- 凡例 ----
function buildLegend(){
  if(!DATA) return;
  const map = DATA.meta?.routeLegend || {};
  const keys = Object.keys(map);
  if(keys.length===0){
    legendEl.textContent = "";
    return;
  }
  const parts = [];
  for(const k of keys){
    parts.push(`${k}:${map[k]}`);
  }
  legendEl.textContent = parts.join(" / ");
}

// ---- 時刻同期 ----
function syncToRealTime(){
  if(!DATA) return;
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  nowSec = h*3600 + m*60 + s;
  clampNow();
}

// ---- 描画 helpers ----
function clear(ctx, w, h){
  ctx.clearRect(0,0,w,h);
}

function drawAxis(ctx, axisStations, w, h, x0, x1, y){
  // 軸線
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();

  // 駅目盛り
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
  // tr.stops: [{station, arrSec, depSec, axisIndex}]
  // 軸上位置は axisIndex を基準に線形補間
  const stops = tr.stops || [];
  if(stops.length===0) return null;

  // 停車中ならその駅に固定
  for(const st of stops){
    const a = st.arrSec ?? st.timeSec ?? null;
    const d = st.depSec ?? st.timeSec ?? null;
    if(a!=null && d!=null && a<=sec && sec<=d){
      return {axisIndex: st.axisIndex, stopped:true, atStation: st.station};
    }
  }

  // 区間走行を探す
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

function drawTripsOnAxis(ctx, axisStations, w, h, {x0,x1,rowY,gap}, trips, hitProp){
  let running = 0;

  // 主要停留場で停車している列車を縦積みするためのカウンタ
  const majorStack = new Map(); // station -> count

  for(const tr of trips){
    const p = interpPos(tr, nowSec);
    if(!p) continue;

    const n = axisStations.length;
    const x = x0 + (x1-x0) * (p.axisIndex/(n-1));

    // y位置（停車重なり対策）
    let y = rowY;
    if(STACK_AT_MAJOR && p.stopped && p.atStation && MAJOR_SET.has(p.atStation)){
      const c = majorStack.get(p.atStation) || 0;
      majorStack.set(p.atStation, c+1);
      y = rowY - (c * STACK_GAP_PX);
    }

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

    // 停車中なら薄い帯で強調
    if(p.stopped){
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#eaf2ff";
      ctx.fillRect(x-22, y-22, 44, 44);
      ctx.globalAlpha = 1.0;

      // 駅名
      if(p.atStation){
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#2c3e50";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(p.atStation, x, y-TRAIN_R-6);
      }
    }

    // クリック判定用のヒット領域
    tr[hitProp] = {x, y, r: TRAIN_R + 8};
    running++;
  }
  return running;
}

function renderMain(){
  const w = CV_MAIN.width, h = CV_MAIN.height;
  clear(CTX_MAIN, w, h);

  if(!DATA) return;

  // 背景
  CTX_MAIN.fillStyle = "rgba(0,0,0,0)";
  CTX_MAIN.fillRect(0,0,w,h);

  const axis = DATA.meta.axisStations.main || [];
  const y = Math.round(h*0.58);

  drawAxis(CTX_MAIN, axis, w, h, 80, w-80, y);

  const trips = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="main");
  MAIN_RUNNING = drawTripsOnAxis(
    CTX_MAIN,
    axis, w, h,
    {x0:80, x1:w-80, rowY:y-40, gap:0},
    trips,
    "_hit"
  );
}

function renderBranch(){
  const w = CV_BRANCH.width, h = CV_BRANCH.height;
  clear(CTX_BRANCH, w, h);

  if(!DATA) return;

  const axis = DATA.meta.axisStations.branch || [];
  const yMid = Math.round(h*0.58);
  const gap = 52;

  // 枝線 2本
  drawAxis(CTX_BRANCH, axis, w, h, 80, w-80, yMid - gap);
  drawAxis(CTX_BRANCH, axis, w, h, 80, w-80, yMid + gap);

  const tripsUp = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="branch_up");
  const tripsDn = (DATA.displayTrips || DATA.trips || []).filter(t=>t.route==="branch_dn");

  const r1 = drawTripsOnAxis(
    CTX_BRANCH,
    axis, w, h,
    {x0:80, x1:w-80, rowY:(yMid - gap)-40, gap:0},
    tripsUp,
    "_hit_branch"
  );
  const r2 = drawTripsOnAxis(
    CTX_BRANCH,
    axis, w, h,
    {x0:80, x1:w-80, rowY:(yMid + gap)-40, gap:0},
    tripsDn,
    "_hit_branch"
  );
  BR_RUNNING = r1 + r2;
}

function render(){
  if(!DATA) return;
  clockEl.textContent = secToClock(nowSec);
  renderMain();
  renderBranch();
  runningCountEl.textContent = String((MAIN_RUNNING||0) + (BR_RUNNING||0));
}

// ---- タップで主要駅時刻表 ----
function isMajorStop(stName){
  return MAJOR_SET.has(normStation(stName));
}

function makeRow(label, v, isMajor){
  const tr = document.createElement("tr");
  if(isMajor) tr.classList.add("major");
  const td1 = document.createElement("td");
  const td2 = document.createElement("td");
  td1.textContent = label;
  td2.textContent = v;
  tr.appendChild(td1);
  tr.appendChild(td2);
  return tr;
}

function showModal(trip){
  modalTitle.textContent = trip.name || trip.label || trip.no || "列車";
  while(modalTable.firstChild) modalTable.removeChild(modalTable.firstChild);

  // 現在位置と近傍
  const p = interpPos(trip, nowSec);
  if(p){
    modalTable.appendChild(makeRow("現在", p.stopped ? `停車中: ${p.atStation||""}` : "走行中", false));
  }

  // 停留場時刻表
  const stops = trip.stops || [];
  for(const st of stops){
    const name = normStation(st.station);
    const arr = st.arrSec != null ? secToClock(st.arrSec) : "";
    const dep = st.depSec != null ? secToClock(st.depSec) : "";
    let txt = "";
    if(arr && dep && arr!==dep) txt = `${arr} / ${dep}`;
    else txt = arr || dep || "";

    modalTable.appendChild(makeRow(name, txt, isMajorStop(name)));
  }

  modalBack.classList.add("show");
}

function closeModal(){
  modalBack.classList.remove("show");
}

modalBack.addEventListener("click", (e)=>{
  if(e.target === modalBack) closeModal();
});
modalClose.addEventListener("click", closeModal);

modalJumpNow.addEventListener("click", ()=>{
  syncToRealTime();
  render();
});

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
  for(const tr of (DATA.displayTrips || DATA.trips)){
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
  for(const tr of (DATA.displayTrips || DATA.trips)){
    if(hitTest(tr, mx, my, "branch")){
      showModal(tr);
      return;
    }
  }
});

// ---- 再生/停止 ----
toggleBtn.addEventListener("click", ()=>{
  playing = !playing;
  toggleBtn.textContent = playing ? "⏸" : "▶";
});

let lastTs = null;
function loop(ts){
  if(lastTs==null) lastTs = ts;
  const dt = (ts - lastTs) / 1000.0;
  lastTs = ts;

  if(playing && DATA){
    // dtは1フレームで約0.016秒。ここでMath.floorすると speed<60 だと一生進まない。
    // 小数のまま積算し、表示は secToClock() で整数化する。
    nowSec = nowSec + dt * speed;
    clampNow();
    render();
  }

  raf = requestAnimationFrame(loop);
}

(async function init(){
  await loadData();
  // 起動直後は「現在時刻に同期」して停止しておく（好みで）
  syncToRealTime();
  playing = false;
  toggleBtn.textContent = "▶";

  // iframe/Google Sitesでもレイアウトに合わせて描画する
  resizeAll();
  raf = requestAnimationFrame(loop);

  // ---- Google Sites / iframe 対策: rAFが間引かれても最低限動かす保険 ----
  // タブ非アクティブや埋め込み環境でrequestAnimationFrameが極端に遅くなることがあるため、
  // playing中は1秒に1回だけ「進めて描画」するフォールバックを入れる。
  setInterval(() => {
    try{
      if(!DATA) return;
      if(!playing) return;
      nowSec = nowSec + 1 * speed;
      clampNow();
      render();
    }catch(_){ /* 何もしない */ }
  }, 1000);
})();
