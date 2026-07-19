/* 共通ヘルパー: 全ページで読み込む */
const DATA_URL = "https://admin.ginmakuichiro.net/data/schedule.json";
const DATA_FALLBACK = "/data/schedule.json";
const DOW = ["日","月","火","水","木","金","土"];
const pad = n => String(n).padStart(2,"0");

function parseDate(s){ const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); }

const TYPE_LABELS = {band:"バンド", band_support:"バンド(サポート)", solo_acoustic:"ソロ弾き語り", solo:"ソロ"};
function isBandType(t){ return t === "band" || t === "band_support"; }
function typeLabelOf(e){ return e.type === "other" ? (e.typeLabel || "出演") : (TYPE_LABELS[e.type] || "バンド"); }
function tagHtml(e){
  return `<span class="tag ${isBandType(e.type) ? "tag-band" : "tag-solo"}">${typeLabelOf(e)}</span>`;
}

function ticketsOf(e){
  return (e.tickets && e.tickets.length) ? e.tickets
    : [e.adv ? {name:"前売", price:e.adv} : null, e.door ? {name:"当日", price:e.door} : null].filter(Boolean);
}

function detailsHtml(e){
  const parts = [];
  if(e.open || e.start){
    parts.push([e.open ? `OPEN ${e.open}` : "", e.start ? `START ${e.start}` : ""].filter(Boolean).join(" / "));
  }
  const fee = ticketsOf(e).map(t => `${t.name} ¥${Number(t.price).toLocaleString()}`).join(" / ");
  if(fee) parts.push(fee);
  if(e.note) parts.push(e.note);
  return parts.length ? `<div class="detail">${parts.join("　｜　")}</div>` : "";
}

function eventUrl(e){ return e.id ? `/event?id=${e.id}` : ""; }

function schedItemHtml(e, extraClass=""){
  const d = parseDate(e.date);
  const url = eventUrl(e);
  const title = url ? `<a class="title-link" href="${url}">${e.title}</a>` : e.title;
  return `<li class="sched-item ${extraClass}">
    <div class="s-date">
      <span class="d">${d.getDate()}</span>
      <span class="m">${d.getFullYear()}.${pad(d.getMonth()+1)}</span>
      <span class="w">${DOW[d.getDay()]}</span>
    </div>
    <div class="s-main">
      <div class="title">${title}　${tagHtml(e)}</div>
      <div class="venue">${e.venue}</div>
      ${detailsHtml(e)}
    </div>
    <div class="s-link">${url ? `<a href="${url}">詳細</a>` : ""}</div>
  </li>`;
}

async function loadJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
async function loadSchedule(){
  try{ return await loadJson(DATA_URL); }
  catch(e){ console.warn("APIに接続できないためローカルデータを使用", e); return loadJson(DATA_FALLBACK); }
}
