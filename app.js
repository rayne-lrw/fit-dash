(() => {
"use strict";
const $ = id => document.getElementById(id);
const C = {fg:"#e7eef4",dim:"#7d91a3",accent:"#5ec4ff",ok:"#38d996",warn:"#ffb020",crit:"#ff4d4f"};
const hex2 = n => n.toString(16).toUpperCase().padStart(2,"0");
const hex = s => (s||"").replace(/[^0-9A-Fa-f]/g,"").toUpperCase();

/* ---------- vehicle profiles ---------- */
// diesel: fuel can't be derived from airflow (lean, variable A/F), so without PID 5E it is estimated from load:
// mg/stroke ≈ mgIdle + load% × (mgMax − mgIdle). Load on diesels is torque / max torque at current rpm.
const CARS = {
  fit:{name:"Honda Fit GK5 · L15B CVT",diesel:false,disp:1.496,ve:0.85,afr:14.7,fuelD:745,tank:40,cyl:4,
    redline:6800,rpmMax:8000,rpmWarn:5500,mapMax:105,idle:760,demoDtc:"P0457",
    dtc:{P0841:"CVT 油壓開關異常",P0868:"CVT 油壓過低",P2646:"VTC/VTEC 油壓開關"}},
  santafe:{name:"Hyundai Santa Fe 2015 · 2.2 柴油 6AT 4WD",diesel:true,disp:2.199,ve:0.9,afr:14.5,fuelD:835,tank:64,cyl:4,
    mgIdle:2,mgMax:60,redline:4500,rpmMax:6000,rpmWarn:3800,mapMax:260,idle:750,demoDtc:"P0401",
    dtc:{P0087:"共軌壓力過低",P0088:"共軌壓力過高",P0093:"燃油系統大量洩漏",P0299:"渦輪增壓不足",P0234:"渦輪增壓過高",
      P0045:"渦輪增壓控制電磁閥電路",P0101:"空氣流量計訊號超出範圍",P0401:"EGR 流量不足",P0402:"EGR 流量過多",
      P2002:"DPF 效率低於門檻",P242F:"DPF 積碳過多",P2452:"DPF 壓差感知器電路",P2453:"DPF 壓差感知器訊號異常",
      P0380:"預熱塞電路",P0670:"預熱塞控制模組電路",P0700:"變速箱控制系統（請讀 TCM）",P0741:"變扭器鎖定離合器卡在分離"}},
};
let carId="fit"; try{ const c=localStorage.getItem("fitdash.car"); if(CARS[c]) carId=c; }catch(e){}
let CAR=CARS[carId], REDLINE=CAR.redline, RPM_MAX=CAR.rpmMax;

/* ---------- OBD-II mode 01 PIDs (SAE J1979) ---------- */
const w = b => b[0]*256 + b[1];
const P = {
  "01":{n:4,name:"故障燈與就緒狀態"},
  "04":{n:1,k:"load",name:"引擎負載",f:b=>b[0]*100/255},
  "05":{n:1,k:"coolant",name:"水溫",f:b=>b[0]-40},
  "06":{n:1,k:"stft",name:"短期燃油修正",f:b=>(b[0]-128)*100/128},
  "07":{n:1,k:"ltft",name:"長期燃油修正",f:b=>(b[0]-128)*100/128},
  "0A":{n:1,k:"fuelp",name:"燃油壓力",f:b=>b[0]*3},
  "0B":{n:1,k:"map",name:"進氣歧管壓力",f:b=>b[0]},
  "0C":{n:2,k:"rpm",name:"引擎轉速",f:b=>w(b)/4},
  "0D":{n:1,k:"speedRaw",name:"車速",f:b=>b[0]},
  "0E":{n:1,k:"timing",name:"點火提前角",f:b=>b[0]/2-64},
  "0F":{n:1,k:"iat",name:"進氣溫度",f:b=>b[0]-40},
  "10":{n:2,k:"maf",name:"空氣流量",f:b=>w(b)/100},
  "11":{n:1,k:"tps",name:"節氣門開度",f:b=>b[0]*100/255},
  "14":{n:1,k:"o2s1v",name:"前含氧電壓",f:b=>b[0]/200},
  "15":{n:1,k:"o2s2v",name:"後含氧電壓",f:b=>b[0]/200},
  "1C":{n:1,k:"obdstd",name:"OBD 標準",f:b=>b[0]},
  "1F":{n:2,k:"runtime",name:"本次發動時間",f:w},
  "21":{n:2,k:"milDist",name:"故障燈亮時行駛",f:w},
  "23":{n:2,k:"rail",name:"共軌壓力",f:b=>w(b)*10},
  "24":{n:2,k:"o2wrV",name:"前含氧 λ（電壓型）",f:b=>2*w(b)/65536},
  "2F":{n:1,k:"fuelLvl",name:"油箱油量",f:b=>b[0]*100/255},
  "30":{n:1,k:"warmups",name:"清碼後暖車次數",f:b=>b[0]},
  "31":{n:2,k:"clrDist",name:"清碼後行駛",f:w},
  "33":{n:1,k:"baro",name:"大氣壓力",f:b=>b[0]},
  "34":{n:2,k:"o2wrC",name:"前含氧 λ（電流型）",f:b=>2*w(b)/65536},
  "3C":{n:2,k:"cat",name:"觸媒溫度",f:b=>w(b)/10-40},
  "42":{n:2,k:"ecuV",name:"ECU 供電電壓",f:b=>w(b)/1000},
  "43":{n:2,k:"absLoad",name:"絕對負載",f:b=>w(b)*100/255},
  "44":{n:2,k:"cmdLambda",name:"目標空燃比",f:b=>2*w(b)/65536},
  "45":{n:1,k:"relTps",name:"相對節氣門",f:b=>b[0]*100/255},
  "46":{n:1,k:"ambient",name:"外氣溫度",f:b=>b[0]-40},
  "49":{n:1,k:"pedal",name:"油門踏板",f:b=>b[0]*100/255},
  "4C":{n:1,k:"cmdTps",name:"指令節氣門",f:b=>b[0]*100/255},
  "4D":{n:2,k:"milTime",name:"故障燈亮時間",f:w},
  "4E":{n:2,k:"clrTime",name:"清碼後經過時間",f:w},
  "51":{n:1,k:"fuelType",name:"燃料類型",f:b=>b[0]},
  "5C":{n:1,k:"oilT",name:"機油溫度",f:b=>b[0]-40},
  "5E":{n:2,k:"fuelRate",name:"燃油流量",f:b=>w(b)/20},
};

/* ---------- state ---------- */
const S = {};
function resetState(){
  for(const k of Object.keys(S)) delete S[k];
  S.rpm=0; S.speed=0; S.speedRaw=0;
  Object.values(HIST).forEach(a=>a.length=0);
  idleBuf.length=0; trip.last=0;
}
const HIST = {coolant:[],volt:[],iat:[],load:[],inst:[],avg:[]};
const trip = {dist:0,fuel:0,time:0,last:0,maxS:0,maxR:0,maxC:null};
const idleBuf = [];
const acc = {state:"wait",t0:0,prevT:0,prevS:0,lastZeroT:0,split60:null,last:null,best:null,hist:[],runSplit:null};
let SUP = null;            // Set of supported PIDs (null = unknown → show everything)
let mode = "off";          // off | busy | on | demo
let tab = "dash";
let elm = null, demoTimer = null, wakeLock = null, needRare = false;
let dtcState = null;       // {codes, ff, demo}
const isSup = pid => !SUP || SUP.has(pid);

/* ---------- log ---------- */
const logLines = [];
function log(s){ logLines.push(new Date().toTimeString().slice(0,8)+"  "+s); if(logLines.length>150) logLines.shift(); $("log").textContent=logLines.join("\n"); $("log").scrollTop=1e9; }

/* ---------- tach ---------- */
const CX=150, CY=128, R=112, A0=-125, A1=125;
const pt=(a,r=R)=>{ const t=a*Math.PI/180; return [CX+r*Math.sin(t), CY-r*Math.cos(t)]; };
const rpmA=v=>A0+(A1-A0)*Math.min(Math.max(v,0),RPM_MAX)/RPM_MAX;
function arc(a0,a1,r=R){ if(a1-a0<0.2) a1=a0+0.2; const [x0,y0]=pt(a0,r),[x1,y1]=pt(a1,r); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
$("arcBg").setAttribute("d",arc(A0,A1));
function drawTach(){
  $("arcRed").setAttribute("d",arc(rpmA(REDLINE),A1));
  let h="";
  for(let k=0;k<=RPM_MAX;k+=500){
    const a=rpmA(k), major=k%1000===0, [x0,y0]=pt(a,R-12), [x1,y1]=pt(a,R-(major?24:18));
    const col=k>=REDLINE?C.crit:(major?C.fg:C.dim);
    h+=`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${col}" stroke-width="${major?2:1}"/>`;
    if(major){ const [tx,ty]=pt(a,R-36); h+=`<text x="${tx.toFixed(1)}" y="${(ty+5).toFixed(1)}" text-anchor="middle" fill="${col}" font-size="15" font-family="Saira Condensed, Arial Narrow, sans-serif" font-weight="600">${k/1000}</text>`; }
  }
  const [lx,ly]=pt(0,R-56);
  h+=`<text x="${lx}" y="${ly}" text-anchor="middle" fill="${C.dim}" font-size="9" letter-spacing="1.5">×1000 r/min</text>`;
  $("ticks").innerHTML=h;
}
drawTach();

/* ---------- dash tiles ---------- */
const TILES = [
  {k:"coolant",pid:"05",label:"水溫",unit:"°C",fmt:v=>v.toFixed(0),lo:40,hi:120},
  {k:"volt",pid:"ATRV",label:"電瓶電壓",unit:"V",fmt:v=>v.toFixed(1),lo:11,hi:15.5},
  {k:"iat",pid:"0F",label:"進氣溫度",unit:"°C",fmt:v=>v.toFixed(0),lo:0,hi:80},
  {k:"load",pid:"04",label:"引擎負載",unit:"%",fmt:v=>v.toFixed(0),lo:0,hi:100},
  {k:"inst",pid:"0C",label:"瞬時油耗",unit:"km/L",fmt:v=>v.toFixed(1),lo:0,hi:30},
  {k:"avg",pid:"0C",label:"平均油耗",unit:"km/L",fmt:v=>v.toFixed(1),lo:0,hi:30},
];
$("tiles").innerHTML = TILES.map(t=>`
  <div class="tile" id="t_${t.k}" data-l="">
    <div class="head"><span class="lbl">${t.label}</span><span class="st" id="s_${t.k}">—</span></div>
    <div class="val"><span class="num" id="v_${t.k}">--</span><small id="u_${t.k}">${t.unit}</small></div>
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
      <path id="a_${t.k}" fill="${C.accent}" fill-opacity=".12"/>
      <polyline id="p_${t.k}" fill="none" stroke="${C.accent}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
    </svg>
  </div>`).join("");

/* ---------- engine tiles ---------- */
const sgn = (v,d=1) => (v>0?"+":"")+v.toFixed(d);
const ENG = [
  {g:"fuel",pid:"06",k:"stft",label:"短期燃油修正",unit:"%",fmt:v=>sgn(v),sub:"即時微調，正值代表加油",lvl:v=>Math.abs(v)>25?["crit","異常"]:Math.abs(v)>15?["warn","偏大"]:["ok","正常"]},
  {g:"fuel",pid:"07",k:"ltft",label:"長期燃油修正",unit:"%",fmt:v=>sgn(v),sub:"超過 ±10% 建議檢查",lvl:v=>Math.abs(v)>20?["crit","異常"]:Math.abs(v)>10?["warn","偏大"]:["ok","正常"]},
  {g:"fuel",pid:"44",k:"cmdLambda",label:"目標空燃比",unit:"A/F",fmt:v=>(v*CAR.afr).toFixed(1),sub:v=>"λ "+v.toFixed(3)},
  {g:"fuel",pid:"34",k:"o2wrC",label:"前含氧 A/F",unit:"A/F",fmt:v=>(v*CAR.afr).toFixed(1),sub:v=>"λ "+v.toFixed(3)},
  {g:"fuel",pid:"24",k:"o2wrV",label:"前含氧 A/F",unit:"A/F",fmt:v=>(v*CAR.afr).toFixed(1),sub:v=>"λ "+v.toFixed(3)},
  {g:"fuel",pid:"14",k:"o2s1v",label:"前含氧電壓",unit:"V",fmt:v=>v.toFixed(2),sub:"應在 0.1–0.9 V 間擺動"},
  {g:"fuel",pid:"15",k:"o2s2v",label:"後含氧電壓",unit:"V",fmt:v=>v.toFixed(2),sub:"觸媒正常時較穩定"},
  {g:"fuel",pid:"5E",k:"fuelRate",label:"燃油流量",unit:"L/h",fmt:v=>v.toFixed(2),sub:"ECU 直接回報"},
  {g:"fuel",pid:"0A",k:"fuelp",label:"燃油壓力",unit:"kPa",fmt:v=>v.toFixed(0)},
  {g:"fuel",pid:"23",k:"rail",label:"共軌壓力",unit:"MPa",fmt:v=>(v/1000).toFixed(1)},
  {g:"air",pid:"10",k:"maf",label:"空氣流量",unit:"g/s",fmt:v=>v.toFixed(1)},
  {g:"air",pid:"0B",k:"map",label:"進氣歧管壓力",unit:"kPa",fmt:v=>v.toFixed(0)},
  {g:"air",pid:"0B",k:"vac",label:"進氣真空",unit:"kPa",fmt:v=>v.toFixed(0),sub:"數值越高越省油",only:"gas"},
  {g:"air",pid:"0B",k:"boost",label:"渦輪增壓",unit:"kPa",fmt:v=>v.toFixed(0),sub:"高於大氣壓的部分",only:"diesel"},
  {g:"air",pid:"43",k:"absLoad",label:"絕對負載",unit:"%",fmt:v=>v.toFixed(0)},
  {g:"air",pid:"45",k:"relTps",label:"相對節氣門",unit:"%",fmt:v=>v.toFixed(0)},
  {g:"air",pid:"49",k:"pedal",label:"油門踏板",unit:"%",fmt:v=>v.toFixed(0)},
  {g:"air",pid:"4C",k:"cmdTps",label:"指令節氣門",unit:"%",fmt:v=>v.toFixed(0)},
  {g:"ign",pid:"0E",k:"timing",label:"點火提前角",unit:"°",fmt:v=>v.toFixed(1),sub:"偏低可能是油品或積碳"},
  {g:"ign",pid:"3C",k:"cat",label:"觸媒溫度",unit:"°C",fmt:v=>v.toFixed(0),sub:"ECU 推算值",lvl:v=>v>900?["crit","過熱"]:v>800?["warn","偏高"]:["ok","正常"]},
  {g:"ign",pid:"5C",k:"oilT",label:"機油溫度",unit:"°C",fmt:v=>v.toFixed(0),lvl:v=>v>130?["crit","過熱"]:v>120?["warn","偏高"]:["ok","正常"]},
  {g:"ign",pid:"0C",k:"idleJit",label:"怠速穩定度",unit:"rpm",fmt:v=>"±"+v.toFixed(0),sub:"停車怠速時計算",lvl:v=>v>60?["warn","抖動大"]:["ok","穩定"]},
  {g:"ign",pid:"42",k:"ecuV",label:"ECU 供電電壓",unit:"V",fmt:v=>v.toFixed(2)},
];
ENG.forEach((t,i)=>{
  t.id="e"+i;
  $("eg-"+t.g).insertAdjacentHTML("beforeend",`
    <div class="ct" id="${t.id}" data-l="">
      <div class="head"><span class="lbl">${t.label}</span><span class="st" id="${t.id}s" hidden></span></div>
      <div class="val"><span class="num" id="${t.id}v">--</span><small>${t.unit}</small></div>
      <div class="sub" id="${t.id}u">${typeof t.sub==="string"?t.sub:""}</div>
    </div>`);
});

/* ---------- environment rows (trip page) ---------- */
const fmtDur = s => { s=Math.max(0,Math.round(s)); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return h? `${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}` : `${m}:${String(x).padStart(2,"0")}`; };
const fmtMin = m => m==null?null: m>=1440? `${Math.floor(m/1440)} 天 ${Math.floor(m%1440/60)} 小時` : m>=60? `${Math.floor(m/60)} 小時 ${m%60} 分` : `${m} 分`;
const ENV = [
  {pid:"46",label:"外氣溫度",v:()=>S.ambient!=null?S.ambient.toFixed(0)+" °C":null},
  {pid:"33",label:"大氣壓力",v:()=>S.baro!=null?S.baro.toFixed(0)+" kPa":null},
  {pid:"33",label:"估算海拔",v:()=>S.baro!=null?"約 "+Math.max(0,Math.round(44330*(1-Math.pow(S.baro/101.325,0.1903))/10)*10)+" m":null},
  {pid:"1F",label:"本次發動時間",v:()=>S.runtime!=null?fmtDur(S.runtime):null},
  {pid:"05",label:"水溫",v:()=>S.coolant!=null?S.coolant.toFixed(0)+" °C":null},
  {pid:"ATRV",label:"電瓶電壓",v:()=>S.volt!=null?S.volt.toFixed(1)+" V":null},
];
$("envRows").innerHTML = ENV.map((r,i)=>`<div class="row" id="env${i}"><span>${r.label}</span><b class="num" id="env${i}v">--</b></div>`).join("");

/* ---------- vehicle info rows (diag page) ---------- */
const OBDSTD = {1:"OBD-II（美規 CARB）",2:"OBD（EPA）",3:"OBD + OBD-II",4:"OBD-I",5:"不符合 OBD",6:"EOBD（歐規）",7:"EOBD + OBD-II",8:"EOBD + OBD",9:"EOBD + OBD + OBD-II",10:"JOBD（日規）",11:"JOBD + OBD-II",12:"JOBD + EOBD",13:"JOBD + EOBD + OBD-II"};
const FUELT = {1:"汽油",2:"甲醇",3:"乙醇",4:"柴油",5:"LPG",6:"CNG",8:"電動",9:"汽油雙燃料",16:"汽油油電",17:"汽油油電"};
const INFO = [
  {pid:"VIN",label:"車身號碼 VIN",v:()=>S.vin||null},
  {pid:"1C",label:"OBD 標準",v:()=>S.obdstd!=null?(OBDSTD[S.obdstd]||"代碼 "+S.obdstd):null},
  {pid:"51",label:"燃料類型",v:()=>S.fuelType!=null?(FUELT[S.fuelType]||"代碼 "+S.fuelType):null},
  {pid:"31",label:"清碼後行駛",v:()=>S.clrDist!=null?S.clrDist.toLocaleString()+" km":null},
  {pid:"4E",label:"清碼後經過",v:()=>fmtMin(S.clrTime)},
  {pid:"30",label:"清碼後暖車次數",v:()=>S.warmups!=null?S.warmups+" 次":null},
  {pid:"21",label:"故障燈亮時行駛",v:()=>S.milDist!=null?S.milDist+" km":null},
  {pid:"4D",label:"故障燈亮時間",v:()=>fmtMin(S.milTime)},
];
$("infoRows").innerHTML = INFO.map((r,i)=>`<div class="row" id="inf${i}"><span>${r.label}</span><b id="inf${i}v">--</b></div>`).join("");

/* ---------- speed correction ---------- */
let spdCorr=0;
try{ const v=parseFloat(localStorage.getItem("fitdash.spdCorr")); if(isFinite(v)) spdCorr=Math.max(-15,Math.min(15,v)); }catch(e){}
function setCorr(v){
  spdCorr=Math.round(Math.max(-15,Math.min(15,v))*2)/2;
  try{ localStorage.setItem("fitdash.spdCorr",String(spdCorr)); }catch(e){}
  S.speed=(S.speedRaw||0)*(1+spdCorr/100);
  render();
}
$("corrDn").onclick=()=>setCorr(spdCorr-0.5);
$("corrUp").onclick=()=>setCorr(spdCorr+0.5);
$("corrV").onclick=()=>setCorr(0);

/* ---------- tabs ---------- */
function setTab(p){
  tab=p;
  document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected", b.dataset.p===p ? "true":"false"));
  ["dash","eng","trip","diag"].forEach(x=>$("pg-"+x).hidden = x!==p);
  try{ localStorage.setItem("fitdash.tab",p); }catch(e){}
  if(p==="diag") needRare=true;
  render();
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.p)));

/* ---------- fuel ---------- */
function fuelLph(){
  S.fuelEst=false;
  if(!S.rpm) return 0;
  if(S.fuelRate!=null && isSup("5E")) return S.fuelRate;
  if(S.load!=null && S.load<10 && S.rpm>1300 && S.speed>15) return 0; // decel fuel cut
  if(CAR.diesel){
    if(S.load==null) return null;
    S.fuelEst=true;
    const mg=CAR.mgIdle+(CAR.mgMax-CAR.mgIdle)*Math.min(S.load,100)/100;
    return (S.rpm/2*CAR.cyl*60)*mg/1e3/CAR.fuelD;   // injections/h × g → L/h
  }
  let maf = (S.maf!=null && isSup("10")) ? S.maf : null;
  if(maf==null && S.map!=null){
    const T=(S.iat ?? 30)+273.15;
    maf=(S.rpm/120)*(S.map*CAR.disp/(8.314*T))*28.97*CAR.ve;
  }
  if(maf==null) return null;
  return maf*3600/(CAR.afr*CAR.fuelD);
}

/* ---------- levels ---------- */
function level(k,v){
  const run=S.rpm>400;
  switch(k){
    case "coolant": if(v>=108) return ["crit","過熱"]; if(v>=102) return ["warn","偏高"]; if(v<70) return ["info","暖車中"]; return ["ok","正常"];
    case "volt": if(v<11.8||v>15.2) return ["crit",v>15.2?"過充":"電壓過低"]; if(run&&v<13.2) return ["warn","充電偏低"]; if(!run&&v<12.3) return ["warn","電瓶偏弱"]; return ["ok",run?"充電中":"正常"];
    case "iat": if(v>=65) return ["warn","偏高"]; return ["ok","正常"];
    case "load": if(v>=85) return ["info","高負載"]; return ["ok","—"];
    case "inst": return ["", S.speed<3?(S.fuelEst?"怠速 · 估算":"怠速 L/h"):(S.fuelEst?"估算":"即時")];
    case "avg": return ["", trip.dist<0.5?"累積中":"本趟"];
  }
  return ["",""];
}
function pushHist(k,v){ if(v==null||!isFinite(v)) return; const a=HIST[k]; a.push(v); if(a.length>90) a.shift(); }
function spark(k,lo,hi){
  const a=HIST[k]; if(a.length<2) return;
  const n=a.length, mn=Math.min(lo,...a), mx=Math.max(hi,...a);
  const pts=a.map((v,i)=>[(i+90-n)/89*100, 24-((v-mn)/(mx-mn||1))*22]);
  const s=pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  $("p_"+k).setAttribute("points",s);
  $("a_"+k).setAttribute("d",`M${pts[0][0].toFixed(1)} 26 L${s.replace(/ /g," L")} L${pts[n-1][0].toFixed(1)} 26Z`);
}

/* ---------- 0-100 timer ---------- */
function accUpdate(now){
  const sp=S.speed;
  if(acc.state==="run"){
    if(acc.runSplit==null && sp>=60 && acc.prevS<60) acc.runSplit = acc.prevT + (60-acc.prevS)/(sp-acc.prevS||1)*(now-acc.prevT) - acc.t0;
    if(sp>=100){
      const tc = acc.prevT + (100-acc.prevS)/(sp-acc.prevS||1)*(now-acc.prevT);
      const r=(tc-acc.t0)/1000;
      acc.last=r; acc.split60=acc.runSplit!=null?acc.runSplit/1000:null;
      acc.best = acc.best==null ? r : Math.min(acc.best,r);
      acc.hist.unshift(r); acc.hist=acc.hist.slice(0,6);
      acc.state="done";
    } else if(sp===0 || now-acc.t0>40000){ acc.state = sp===0 ? "ready" : "wait"; }
  } else if(sp===0){ acc.state="ready"; acc.lastZeroT=now; }
  else if(acc.state==="ready" && sp>0){ acc.state="run"; acc.t0=(acc.lastZeroT+now)/2; acc.runSplit=null; }
  acc.prevT=now; acc.prevS=sp;
}

/* ---------- per-cycle sample ---------- */
function sample(){
  const now=performance.now();
  S.speed = (S.speedRaw||0) * (1 + spdCorr/100);
  const lph=fuelLph();
  if(trip.last){
    const dt=Math.min((now-trip.last)/1000,5);
    if(S.rpm>0){ trip.time+=dt; trip.dist+=S.speed*dt/3600; if(lph!=null) trip.fuel+=lph*dt/3600; }
  }
  trip.last=now;
  trip.maxS=Math.max(trip.maxS,S.speed||0); trip.maxR=Math.max(trip.maxR,S.rpm||0);
  if(S.coolant!=null) trip.maxC = trip.maxC==null?S.coolant:Math.max(trip.maxC,S.coolant);
  S.lph=lph;
  S.inst=(lph==null)?null:(S.speed<3?lph:(lph<0.05?99.9:Math.min(S.speed/lph,99.9)));
  S.avg=trip.fuel>0.01?trip.dist/trip.fuel:null;
  S.vac = S.map!=null ? Math.max(0,(S.baro ?? 101)-S.map) : null;
  S.boost = S.map!=null ? Math.max(0,S.map-(S.baro ?? 101)) : null;
  if(S.speed===0 && S.rpm>400){ if(!S._stopT) S._stopT=now; } else S._stopT=0;
  if(S._stopT && now-S._stopT>4000 && S.rpm<1400 && (S.tps??0)<25){ idleBuf.push(S.rpm); if(idleBuf.length>30) idleBuf.shift(); }
  if(idleBuf.length>=8){ const m=idleBuf.reduce((a,b)=>a+b,0)/idleBuf.length; S.idleJit=Math.sqrt(idleBuf.reduce((a,b)=>a+(b-m)*(b-m),0)/idleBuf.length); }
  accUpdate(now);
  ["coolant","volt","iat","load"].forEach(k=>pushHist(k,S[k]));
  if(S.speed>=3) pushHist("inst",Math.min(S.inst??0,40));
  pushHist("avg",S.avg);
  render();
}

/* ---------- render ---------- */
const show = (el,on) => { if(el) el.hidden = !on; };
function render(){
  const alerts=[];
  const connected = mode==="on"||mode==="demo";

  // dash tiles (always evaluated for alerts)
  TILES.forEach(t=>{
    const v=S[t.k], el=$("t_"+t.k);
    if(v==null){ $("v_"+t.k).textContent="--"; $("s_"+t.k).textContent=connected?"無資料":"—"; el.dataset.l=""; return; }
    $("v_"+t.k).textContent=t.fmt(v);
    if(t.k==="inst") $("u_inst").textContent=S.speed<3?"L/h":"km/L";
    const [l,txt]=level(t.k,v); el.dataset.l=l; $("s_"+t.k).textContent=txt;
    if(l==="warn"||l==="crit") alerts.push([l,`${t.label} ${txt}（${t.fmt(v)} ${t.unit}）`]);
    if(tab==="dash") spark(t.k,t.lo,t.hi);
  });
  // engine tiles
  ENG.forEach(t=>{
    const el=$(t.id); const sup=isSup(t.pid) && (!t.only || t.only===(CAR.diesel?"diesel":"gas")); show(el,sup); if(!sup) return;
    const v=S[t.k];
    if(v==null||!isFinite(v)){ $(t.id+"v").textContent="--"; el.dataset.l=""; show($(t.id+"s"),false); return; }
    $(t.id+"v").textContent=t.fmt(v);
    if(typeof t.sub==="function") $(t.id+"u").textContent=t.sub(v);
    if(t.lvl){ const [l,txt]=t.lvl(v); el.dataset.l=l; $(t.id+"s").textContent=txt; show($(t.id+"s"),true);
      if(l==="warn"||l==="crit") alerts.push([l,`${t.label} ${txt}（${t.fmt(v)} ${t.unit}）`]); }
  });
  if(S.rpm>=REDLINE) alerts.unshift(["crit","轉速接近紅線"]);
  if(S.mil) alerts.unshift(["crit",`引擎故障燈亮${S.dtcCount?`（${S.dtcCount} 筆故障碼）`:""}`]);
  if(S.fuelLvl!=null && S.fuelLvl<12) alerts.push(["warn",`油量偏低（${S.fuelLvl.toFixed(0)}%）`]);

  // dash bars
  $("tpsV").textContent=S.tps==null?"--":S.tps.toFixed(0); $("tpsB").style.width=(S.tps??0)+"%";
  $("mapV").textContent=S.map==null?"--":S.map.toFixed(0); $("mapB").style.width=Math.min((S.map??0)/CAR.mapMax*100,100)+"%";
  $("spd").textContent=Math.round(S.speed||0);
  $("corrV").textContent=(spdCorr>0?"+":"")+spdCorr.toFixed(1)+"%";
  $("corrV").dataset.on = spdCorr!==0 ? "1" : "";
  $("corrRaw").textContent = spdCorr===0 ? "未補正" : `原始 ${Math.round(S.speedRaw||0)} → 顯示 ${Math.round(S.speed||0)} km/h`;

  // trip
  $("tDist").textContent=trip.dist.toFixed(1);
  $("tFuel").textContent=trip.fuel.toFixed(2);
  $("tTime").textContent=fmtDur(trip.time);
  $("tAvg").textContent=trip.time>10?Math.round(trip.dist/(trip.time/3600)):0;
  $("tEco").textContent=S.avg!=null?S.avg.toFixed(1):"--";
  $("tMaxS").textContent=Math.round(trip.maxS); $("tMaxR").textContent=Math.round(trip.maxR/10)*10;
  $("tMaxC").textContent=trip.maxC!=null?trip.maxC.toFixed(0):"--";
  // 0-100
  const st=$("accState");
  if(acc.state==="run"){ $("accT").innerHTML=((performance.now()-acc.t0)/1000).toFixed(1)+"<small> 秒</small>"; st.textContent="計時中…"; st.className="acc-state run"; }
  else { $("accT").innerHTML=(acc.last!=null?acc.last.toFixed(1):"--.-")+"<small> 秒</small>";
    st.className="acc-state"+(acc.state==="done"?" done":"");
    st.textContent = acc.state==="ready" ? "準備好了，起步就開始計時" : acc.state==="done" ? "完成！停車後可再測一次" : "停車後起步，會自動開始計時"; }
  $("acc60").textContent=acc.split60!=null?acc.split60.toFixed(1)+" 秒":"--";
  $("accBest").textContent=acc.best!=null?acc.best.toFixed(1)+" 秒":"--";
  $("accHist").innerHTML=acc.hist.map(x=>`<span>${x.toFixed(1)}</span>`).join("");
  // fuel level + env
  show($("fuelBox"),isSup("2F"));
  if(S.fuelLvl!=null){ $("fuelLvlV").textContent=S.fuelLvl.toFixed(0); $("fuelLvlB").style.width=S.fuelLvl+"%";
    $("fuelLvlB").style.background = S.fuelLvl<12?C.warn:C.accent;
    $("fuelLvlL").textContent=`約 ${(S.fuelLvl/100*CAR.tank).toFixed(0)} L` + (S.avg?` · 可再跑約 ${Math.round(S.fuelLvl/100*CAR.tank*S.avg)} km`:""); }
  ENV.forEach((r,i)=>{ const sup=r.pid==="ATRV"||isSup(r.pid); show($("env"+i),sup); if(sup) $("env"+i+"v").textContent=r.v()??"--"; });

  // diag: MIL, readiness, info
  const milEl=$("mil");
  if(S.mil==null){ milEl.textContent="引擎燈：—"; milEl.className="mil"; }
  else { milEl.textContent=S.mil?"引擎燈：亮":"引擎燈：熄"; milEl.className=S.mil?"mil on":"mil"; }
  renderMon();
  INFO.forEach((r,i)=>{ const sup=r.pid==="VIN"||isSup(r.pid); show($("inf"+i),sup); if(sup) $("inf"+i+"v").textContent=r.v()??"--"; });

  // alert strip
  const box=$("alerts");
  if(mode==="off") box.innerHTML=`<span class="chip info">插上 OBD 接頭並發動引擎，再按「連接 OBD」；或先用示範模式查看畫面</span>`;
  else if(!alerts.length) box.innerHTML=`<span class="chip ok">車況正常</span>`;
  else box.innerHTML=alerts.slice(0,5).map(([l,t])=>`<span class="chip ${l}">${t}</span>`).join("");
}

const MON_CONT=[["失火偵測",0],["燃油系統",1],["綜合元件",2]];
const MON_NC=[["觸媒",0],["觸媒加熱",1],["蒸發系統",2],["二次空氣",3],["含氧感知器",5],["含氧加熱器",6],["EGR／VVT",7]];
const MON_CI=[["NMHC 觸媒",0],["NOx／SCR",1],["增壓系統",3],["排氣感知器",5],["DPF",6],["EGR／VVT",7]];
function renderMon(){
  const m=S.mon, box=$("monBox");
  if(!m){ box.innerHTML=`<span class="muted">連線後顯示各項自我檢測是否完成。</span>`; $("monSum").textContent=""; return; }
  const [,B,Cb,D]=m; const items=[];
  MON_CONT.forEach(([n,i])=>{ if(B&(1<<i)) items.push([n,!(B&(1<<(i+4)))]); });
  (B&0x08?MON_CI:MON_NC).forEach(([n,i])=>{ if(Cb&(1<<i)) items.push([n,!(D&(1<<i))]); });
  const done=items.filter(x=>x[1]).length;
  $("monSum").textContent=items.length?`${done} / ${items.length} 完成`:"";
  box.innerHTML = items.length ? items.map(([n,ok])=>`<div class="${ok?"y":"n"}"><span>${n}</span><i>${ok?"完成":"未完成"}</i></div>`).join("") : `<span class="muted">ECU 未回報就緒項目。</span>`;
}

// smooth tach
let dispRpm=0;
(function frame(){
  dispRpm += ((S.rpm||0)-dispRpm)*0.25;
  if(tab==="dash"){
    const av=$("arcVal"); av.setAttribute("d",arc(A0,rpmA(dispRpm)));
    av.setAttribute("stroke",dispRpm>=REDLINE?C.crit:(dispRpm>=CAR.rpmWarn?C.warn:C.accent));
    $("rpmTxt").textContent=Math.round(dispRpm/10)*10;
  }
  if(tab==="trip" && acc.state==="run") $("accT").innerHTML=((performance.now()-acc.t0)/1000).toFixed(1)+"<small> 秒</small>";
  requestAnimationFrame(frame);
})();

/* ---------- status ---------- */
function setMode(m,txt){
  mode=m; $("pill").dataset.s = m==="off"&&txt ? "err" : m;
  $("pillTxt").textContent = txt || ({off:"未連線",busy:"連線中…",on:"已連線",demo:"示範模式"}[m]);
  $("btnConn").textContent = m==="on"||m==="busy" ? "中斷連線" : "連接 OBD";
  $("btnDemo").textContent = m==="demo" ? "停止示範" : "示範模式";
  const live = m==="on"||m==="demo";
  $("btnDtc").disabled = $("btnClr").disabled = $("btnInfo").disabled = !live;
  $("car").disabled = $("tport").disabled = m==="on"||m==="busy";
  render();
}
function renderSupList(){
  const el=$("supList");
  if(!SUP){ el.innerHTML=`<span class="muted">連線後才知道這台車支援哪些項目。</span>`; return; }
  const list=[...SUP].filter(p=>P[p]).sort();
  el.innerHTML=list.map(p=>`<span><b>${p}</b>${P[p].name}</span>`).join("") + `<span class="muted">${mode==="demo"?"（示範資料）":`共 ${SUP.size} 項`}</span>`;
  $("btnSup").textContent=`支援項目（${list.length}）`;
}
$("btnSup").onclick=()=>{ renderSupList(); $("supList").hidden=!$("supList").hidden; };

/* ---------- ELM327 transport: shared command/prompt handling ---------- */
class Elm {
  constructor(){ this.buf=""; this.waiter=null; this.chain=Promise.resolve(); this.dec=new TextDecoder(); this.enc=new TextEncoder(); }
  feed(text){
    this.buf+=text;
    const i=this.buf.indexOf(">");
    if(i>=0&&this.waiter){ const out=this.buf.slice(0,i); this.buf=this.buf.slice(i+1); const wt=this.waiter; this.waiter=null; wt(out); }
  }
  lost(what){ if(elm!==this) return; log(what+"已斷線"); if(mode==="on"||mode==="busy") stopAll("連線中斷"); }
  send(cmd,timeout=2500){
    const run=()=>new Promise(async res=>{
      this.buf="";
      const t=setTimeout(()=>{ this.waiter=null; res(null); },timeout);
      this.waiter=s=>{ clearTimeout(t); res(s); };
      try{ await this.write(this.enc.encode(cmd+"\r")); }
      catch(e){ clearTimeout(t); this.waiter=null; res(null); }
    });
    const p=this.chain.then(run); this.chain=p.catch(()=>{});
    return p.then(r=>r==null?null:r.replace(/\r/g,"\n").split("\n").map(x=>x.trim()).filter(x=>x&&!/^SEARCHING/i.test(x)).join("\n"));
  }
}

/* ---------- BLE (Web Bluetooth) ---------- */
const SERVICES = [0xfff0,0xffe0,0x18f0,0xffb0,0xfee0,"e7810a71-73ae-499d-8c15-faa9aef0c3f2"];
class ElmBle extends Elm {
  async open(){
    this.dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:SERVICES});
    log("裝置："+(this.dev.name||this.dev.id));
    this.dev.addEventListener("gattserverdisconnected",()=>this.lost("藍牙"));
    const server=await this.dev.gatt.connect();
    for(const s of await server.getPrimaryServices()){
      let tx=null, rx=null;
      try{ for(const c of await s.getCharacteristics()){
        if(!tx&&(c.properties.write||c.properties.writeWithoutResponse)) tx=c;
        if(!rx&&(c.properties.notify||c.properties.indicate)) rx=c; } }catch(e){ continue; }
      if(tx&&rx){ this.tx=tx; this.rx=rx; log("服務 "+s.uuid); break; }
    }
    if(!this.tx) throw new Error("找不到 ELM327 的通訊通道，接頭可能不是 BLE 版");
    await this.rx.startNotifications();
    this.rx.addEventListener("characteristicvaluechanged",e=>this.feed(this.dec.decode(e.target.value,{stream:true})));
  }
  async write(data){
    if(this.tx.properties.writeWithoutResponse&&this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(data);
    else await this.tx.writeValue(data);
  }
  close(){ try{ this.dev?.gatt?.disconnect(); }catch(e){} }
}

/* ---------- Classic Bluetooth SPP / USB (Web Serial) ---------- */
const SPP = "00001101-0000-1000-8000-00805f9b34fb";
let serialPick = false;    // true → skip the remembered port and show the picker
class ElmSerial extends Elm {
  async open(){
    let port=null;
    if(!serialPick){ const ports=await navigator.serial.getPorts(); port=ports[ports.length-1]||null; if(port) log("使用上次授權的接頭"); }
    serialPick=false;
    if(!port) port=await navigator.serial.requestPort({allowedBluetoothServiceClassIds:[SPP]});
    const info=port.getInfo?.()||{};
    log("裝置："+(info.bluetoothServiceClassId?"藍牙序列埠":info.usbVendorId?`USB ${hex2(info.usbVendorId>>8)}${hex2(info.usbVendorId&255)}`:"序列埠"));
    this.port=port;
    try{ await port.open({baudRate:38400}); }
    catch(e){ serialPick=true; throw new Error("接頭開啟失敗（"+e.message+"）。確認接頭已配對且通電；再按一次「連接 OBD」可重選接頭"); }
    this.reader=port.readable.getReader(); this.writer=port.writable.getWriter();
    (async()=>{
      try{ for(;;){ const {value,done}=await this.reader.read(); if(done) break; if(value) this.feed(this.dec.decode(value,{stream:true})); } }catch(e){}
      if(!this.closing) this.lost("序列埠");
    })();
  }
  async write(data){ await this.writer.write(data); }
  async close(){
    this.closing=true;
    try{ await this.reader?.cancel(); }catch(e){}
    try{ this.reader?.releaseLock(); }catch(e){}
    try{ this.writer?.releaseLock(); }catch(e){}
    try{ await this.port?.close(); }catch(e){}
  }
}

/* ---------- transport choice ---------- */
const CAN = {ble:!!navigator.bluetooth, serial:!!navigator.serial};
let tport = CAN.ble ? "ble" : "serial";
try{ const t=localStorage.getItem("fitdash.tport"); if(CAN[t]) tport=t; }catch(e){}
$("capLine").textContent=`BLE ${CAN.ble?"✅":"❌"}　傳統藍牙／USB ${CAN.serial?"✅":"❌"}`;
$("tport").hidden = !(CAN.ble && CAN.serial);
$("tport").value = tport;
$("tport").onchange=()=>{ tport=$("tport").value; try{ localStorage.setItem("fitdash.tport",tport); }catch(e){} };
const bad = r => !r || /NO DATA|ERROR|UNABLE|STOPPED|\?/i.test(r);
function bytesFor(resp,pid,prefix="41",skip=0){
  if(bad(resp)) return null;
  for(const line of resp.split("\n")){
    const h=hex(line); const i=h.indexOf(prefix+pid); if(i<0) continue;
    const out=[]; for(let j=i+prefix.length+2+skip*2;j+1<h.length&&out.length<4;j+=2) out.push(parseInt(h.substr(j,2),16));
    if(out.length) return out;
  }
  return null;
}
async function readPid(pid){
  if(SUP && !SUP.has(pid)) return false;
  const r=await elm.send("01"+pid); const b=bytesFor(r,pid); const d=P[pid];
  if(!b||b.length<d.n) return false;
  if(pid==="01"){ S.mil=!!(b[0]&0x80); S.dtcCount=b[0]&0x7f; S.mon=b.slice(0,4); }
  else S[d.k]=d.f(b);
  return true;
}
async function readVolt(){ const v=await elm.send("ATRV"); const m=v&&v.match(/(\d+(\.\d+)?)\s*V/i); if(m) S.volt=parseFloat(m[1]); }

async function detectSupport(){
  const set=new Set();
  for(let base=0; base<=0xC0; base+=0x20){
    const pid=hex2(base), r=await elm.send("01"+pid, base===0?8000:3000);
    log("01"+pid+" → "+(r??"逾時"));
    if(bad(r)) break;
    let any=false;
    for(const line of r.split("\n")){
      const h=hex(line), i=h.indexOf("41"+pid); if(i<0) continue;
      const seg=h.substr(i+4,8); if(seg.length<8) continue; any=true;
      const bits=parseInt(seg,16)>>>0;
      for(let k=0;k<32;k++) if(bits&(1<<(31-k))) set.add(hex2(base+k+1));
    }
    if(!any || !set.has(hex2(base+0x20))) break;
  }
  return set;
}
async function readVin(){
  const r=await elm.send("0902",5000); log("0902 → "+(r??"逾時"));
  if(bad(r)) return null;
  const h=r.split("\n").map(l=>hex(l.replace(/^\s*[0-9A-F]:/i,""))).filter(l=>l.length>3).join("");
  const i=h.indexOf("4902"); if(i<0) return null;
  let body=h.slice(i+4); if(body.startsWith("01")) body=body.slice(2);
  let s=""; for(let j=0;j+1<body.length;j+=2){ const c=parseInt(body.substr(j,2),16); if(c>=0x30&&c<=0x5A) s+=String.fromCharCode(c); }
  return s.length>=17?s.slice(-17):(s||null);
}

let CORE=[], SLOW=[], RARE=[], ENGP=[];
function buildLists(){
  const f=a=>a.filter(p=>isSup(p));
  CORE=f(["0C","0D","04","11","0B", isSup("5E")?"5E":"10"]);
  SLOW=f(["05","0F","01","2F","46","33"]);
  RARE=f(["1F","21","30","31","4D","4E","42"]);
  ENGP=[...new Set(ENG.map(t=>t.pid))].filter(p=>isSup(p) && !CORE.includes(p) && p!=="42");
}

async function connect(){
  if(!CAN.ble && !CAN.serial){ setMode("off","瀏覽器不支援藍牙"); log("此瀏覽器沒有 Web Bluetooth 也沒有 Web Serial：請用 Android Chrome / Edge、電腦版 Chrome，或 iOS 的 Bluefy（僅 BLE）"); return; }
  stopDemo(); resetState(); SUP=null; dtcState=null; showDtc(); setMode("busy");
  elm = tport==="serial" ? new ElmSerial() : new ElmBle();
  log("連線方式："+(tport==="serial"?"傳統藍牙／USB（序列埠）":"BLE"));
  try{
    await elm.open();
    for(const c of ["ATZ","ATE0","ATL0","ATS0","ATH0","ATAT1","ATSP0"]){ const r=await elm.send(c,c==="ATZ"?4000:2000); log(c+" → "+(r??"逾時")); }
    const set=await detectSupport();
    if(!set.size) throw new Error("ECU 無回應，請確認引擎已發動（或鑰匙轉到 ON）");
    SUP=set; buildLists(); renderSupList();
    log("協定："+((await elm.send("ATDP"))||"?")+"　支援 "+SUP.size+" 項："+[...SUP].join(" "));
    setMode("on"); requestWake();
    for(const p of ["1C","51"]) await readPid(p);
    S.vin=await readVin();
    needRare=true;
    pollLoop();
  }catch(e){
    log("失敗："+e.message); const old=elm; elm=null; old?.close(); SUP=null;
    const msg=e.name==="NotFoundError"?"已取消選擇":(e.name==="SecurityError"||/permission|policy/i.test(e.message))?"此頁面環境封鎖藍牙":"連線失敗";
    setMode("off",msg);
    if(msg==="此頁面環境封鎖藍牙") log("請改用 GitHub Pages 上的網址，在 Chrome 開啟");
  }
}
async function pollLoop(){
  let i=0, fails=0, rr=0;
  while(mode==="on"&&elm){
    let ok=0;
    for(const p of CORE){ if(mode!=="on") return; ok+=await readPid(p)?1:0; }
    if(tab==="eng" && ENGP.length){ for(let j=0;j<Math.min(4,ENGP.length);j++) await readPid(ENGP[rr++%ENGP.length]); }
    if(i%5===0){ for(const p of SLOW) await readPid(p); await readVolt(); if(tab==="eng") await readPid("42"); }
    if(needRare||i%40===0){ needRare=false; for(const p of RARE) await readPid(p); }
    fails=ok?0:fails+1;
    if(fails>=8){ stopAll("ECU 無回應"); return; }
    sample(); i++;
  }
}
function stopAll(txt){ const old=elm; elm=null; old?.close(); releaseWake(); setMode("off",txt); }

/* ---------- DTC + freeze frame ---------- */
const DTC_TXT = {
  P0420:"觸媒轉換器效率低於門檻", P0171:"混合比過稀", P0172:"混合比過濃",
  P0300:"多缸失火", P0301:"第 1 缸失火", P0302:"第 2 缸失火", P0303:"第 3 缸失火", P0304:"第 4 缸失火",
  P0128:"水溫上升過慢（節溫器）", P0505:"怠速控制系統異常", P0507:"怠速轉速過高",
  P0455:"蒸發系統大量洩漏（油箱蓋）", P0456:"蒸發系統微量洩漏", P0457:"油箱蓋未鎖緊",
  P0135:"前含氧感知器加熱器", P0141:"後含氧感知器加熱器", P0113:"進氣溫度感知器電壓過高",
  P0118:"水溫感知器電壓過高", P0562:"系統電壓過低", P0563:"系統電壓過高", P0335:"曲軸位置感知器", P0340:"凸輪軸位置感知器",
  P0134:"前含氧感知器無反應", P0137:"後含氧感知器電壓過低",
};
const dtcStr=(a,b)=>"PCBU"[a>>6]+((a>>4)&3)+(a&15).toString(16).toUpperCase()+hex2(b);
function decodeDtc(resp,svc="43"){
  if(bad(resp)) return [];
  const h=resp.split("\n").map(l=>hex(l.replace(/^\s*[0-9A-F]:/i,""))).filter(l=>l.length>3).join("");
  const i=h.indexOf(svc); if(i<0) return [];
  let body=h.slice(i+2);
  const n=parseInt(body.slice(0,2),16);
  if(!isNaN(n)&&n<=20&&body.length>=2+n*4) body=body.slice(2,2+n*4);
  const out=[];
  for(let j=0;j+3<body.length;j+=4){ const a=parseInt(body.substr(j,2),16), b=parseInt(body.substr(j+2,2),16); if(a||b) out.push(dtcStr(a,b)); }
  return [...new Set(out)];
}
const FF_FIELDS=[["0C","轉速","rpm",v=>v.toFixed(0)],["0D","車速","km/h",v=>v.toFixed(0)],["05","水溫","°C",v=>v.toFixed(0)],["04","負載","%",v=>v.toFixed(0)],
  ["06","短期修正","%",v=>sgn(v)],["07","長期修正","%",v=>sgn(v)],["0B","進氣壓力","kPa",v=>v.toFixed(0)],["0F","進氣溫度","°C",v=>v.toFixed(0)]];
async function readFF(){
  const r=await elm.send("020200",3000); log("020200 → "+(r??"逾時"));
  const b=bytesFor(r,"02","42",1); if(!b||b.length<2||(!b[0]&&!b[1])) return null;
  const vals={};
  for(const [p] of FF_FIELDS){ if(!isSup(p)) continue; const rr=await elm.send("02"+p+"00",3000); const bb=bytesFor(rr,p,"42",1); if(bb&&bb.length>=P[p].n) vals[p]=P[p].f(bb); }
  return {code:dtcStr(b[0],b[1]),vals};
}
function showDtc(){
  const el=$("dtcList"), ffb=$("ffBox");
  if(!dtcState){ el.innerHTML=`<span class="muted">連線後按「讀取」查詢 ECU 故障碼。</span>`; ffb.hidden=true; return; }
  const {codes,ff,demo}=dtcState;
  el.innerHTML = codes.length ? codes.map(([c,kind])=>`<div class="dtc"><code>${c}</code><span>${CAR.dtc[c]||DTC_TXT[c]||"請查詢原廠維修手冊"}</span><em>${kind}</em></div>`).join("") + (demo?`<span class="muted">示範資料</span>`:"")
    : `<span class="muted">沒有故障碼。</span>`;
  if(ff && Object.keys(ff.vals).length){
    ffb.hidden=false; $("ffTitle").textContent=`凍結資料：${ff.code} 發生當下的車況`;
    $("ffGrid").innerHTML=FF_FIELDS.filter(([p])=>ff.vals[p]!=null).map(([p,n,u,fmt])=>`<div><span>${n}</span><b>${fmt(ff.vals[p])}</b> <small class="muted">${u}</small></div>`).join("");
  } else ffb.hidden=true;
}
$("btnDtc").onclick=async()=>{
  if(mode==="demo"){ const c=CAR.demoDtc; dtcState={codes:[[c,"確認"]],ff:{code:c,vals:CAR.diesel?{"0C":1720,"0D":62,"05":88,"04":38,"0B":142,"0F":36}:{"0C":812,"0D":0,"05":86,"04":21,"06":1.6,"07":2.3,"0B":31,"0F":34}},demo:true}; showDtc(); return; }
  $("dtcList").innerHTML=`<span class="muted">讀取中…</span>`;
  const r3=await elm.send("03",5000); log("03 → "+(r3??"逾時"));
  const r7=await elm.send("07",5000); log("07 → "+(r7??"逾時"));
  const conf=decodeDtc(r3,"43"), pend=decodeDtc(r7,"47");
  const codes=[...conf.map(c=>[c,"確認"]), ...pend.filter(c=>!conf.includes(c)).map(c=>[c,"待確認"])];
  const ff = codes.length ? await readFF() : null;
  dtcState={codes,ff,demo:false}; showDtc();
};
$("btnClr").onclick=()=>{ $("clrConfirm").hidden=false; };
$("clrNo").onclick=()=>{ $("clrConfirm").hidden=true; };
$("clrYes").onclick=async()=>{
  $("clrConfirm").hidden=true;
  if(mode==="demo"){ S.mil=false; S.dtcCount=0; dtcState={codes:[],ff:null,demo:true}; showDtc(); render(); return; }
  const r=await elm.send("04",5000); log("04 → "+(r??"逾時"));
  dtcState=null; showDtc();
  $("dtcList").innerHTML=/44/.test(hex(r))?`<span class="muted">已清除。若問題仍在，故障碼會再次出現。</span>`:`<span class="muted">清除失敗，請在引擎熄火、鑰匙 ON 的狀態再試一次。</span>`;
  await readPid("01"); needRare=true; render();
};
$("btnInfo").onclick=async()=>{ if(mode==="on"){ needRare=true; if(!S.vin) S.vin=await readVin(); } };

/* ---------- demo ---------- */
const DEMO_SUP="01 04 05 06 07 0B 0C 0D 0E 0F 11 13 15 1C 1F 20 21 2E 2F 30 31 33 34 3C 40 42 43 44 45 46 47 49 4A 4C 4D 4E 51".split(" ");
const DEMO_SUP_D="01 04 05 0B 0C 0D 0F 10 11 1C 1F 20 21 23 2F 30 31 33 40 42 43 46 49 4D 4E 51".split(" ");
function startDemo(){
  if(elm) stopAll(); resetState(); SUP=new Set(CAR.diesel?DEMO_SUP_D:DEMO_SUP); dtcState=null; showDtc(); renderSupList();
  const dz=CAR.diesel;
  Object.assign(S,{coolant:46,iat:31,volt:14.2,mil:false,dtcCount:0,load:20,tps:12,map:dz?101:32,mon:dz?[0x00,0x0F,0xE9,0x40]:[0x00,0x07,0x65,0x04],
    vin:"DEMO0000000000000",obdstd:dz?6:1,fuelType:dz?4:1,clrDist:1834,clrTime:3120,warmups:96,milDist:0,milTime:0,fuelLvl:63,ambient:27,baro:100,runtime:0,cat:250,ecuV:14.1});
  let target=0,t=0;
  setMode("demo");
  demoTimer=setInterval(()=>{
    t+=0.2;
    if(S.speedRaw===0 && target===0 && Math.random()<0.02) target=100;
    else if(Math.random()<0.01) target=[0,30,45,60,80][Math.floor(Math.random()*5)];
    const d=target-S.speedRaw, up=d>2;
    S.speedRaw=Math.max(0,S.speedRaw+Math.sign(d)*Math.min(Math.abs(d),up?(target===100?1.9:0.9):1.6));
    if(S.speedRaw>=100) target=60;
    const base=S.speedRaw<2?CAR.idle:(dz?950+S.speedRaw*9:1100+S.speedRaw*14), rt=up?base+(dz?900+Math.random()*600:1700+Math.random()*900):base;
    S.rpm+=(rt-S.rpm)*0.15+(Math.random()-.5)*(S.speedRaw<2?24:30);
    S.tps=up?30+Math.random()*25:(d<-2?10:14+S.speedRaw*0.08);
    S.relTps=Math.max(0,S.tps-11); S.pedal=up?S.tps+5:(d<-2?0:8+S.speedRaw*0.1); S.cmdTps=S.tps;
    S.load=d<-2&&S.speedRaw>15?5:(up?55+Math.random()*25:18+S.speedRaw*0.2); S.absLoad=S.load*0.9;
    S.map=dz?101+Math.max(0,S.load-25)*1.9:25+S.load*0.75;
    if(dz){ S.maf=S.rpm*CAR.disp/120*1.18*(S.map/101)*CAR.ve; S.rail=30000+S.load*1300+(Math.random()-.5)*2000; }
    S.coolant=Math.min(S.coolant+(S.coolant<89?0.06:0)+(Math.random()-.5)*0.05,92);
    S.iat=30+(S.speedRaw<5?6:0)+Math.sin(t/20);
    S.volt=14.1+(Math.random()-.5)*0.15; S.ecuV=S.volt-0.1;
    S.stft=(Math.random()-.5)*6; S.ltft=2.3;
    S.cmdLambda=up&&S.load>70?0.88:1.0; S.o2wrC=S.cmdLambda+(Math.random()-.5)*0.03;
    S.o2s2v=0.62+(Math.random()-.5)*0.06;
    S.timing=S.speedRaw<2?8+Math.random()*3:(up?14+Math.random()*6:28+Math.random()*6);
    S.cat=Math.min(S.cat+(S.cat<620?1.5:0)+(Math.random()-.5)*2,700);
    S.runtime+=0.2; S.fuelLvl=Math.max(5,S.fuelLvl-0.0004);
    sample();
  },200);
}
function stopDemo(){ if(demoTimer){ clearInterval(demoTimer); demoTimer=null; } }

/* ---------- misc ---------- */
async function requestWake(){ try{ wakeLock=await navigator.wakeLock?.request("screen"); }catch(e){} }
function releaseWake(){ try{ wakeLock?.release(); }catch(e){} wakeLock=null; }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"&&(mode==="on"||mode==="demo")) requestWake(); });
$("btnConn").onclick=()=>{ if(mode==="on"||mode==="busy") stopAll(); else connect(); };
$("btnDemo").onclick=()=>{ if(mode==="demo"){ stopDemo(); releaseWake(); resetState(); SUP=null; dtcState=null; showDtc(); setMode("off"); } else { startDemo(); requestWake(); } };
$("btnReset").onclick=()=>{ Object.assign(trip,{dist:0,fuel:0,time:0,last:0,maxS:0,maxR:0,maxC:null}); HIST.avg.length=0; render(); };
$("btnAccClr").onclick=()=>{ Object.assign(acc,{last:null,best:null,split60:null,hist:[]}); render(); };
$("btnFs").onclick=async()=>{ try{ document.fullscreenElement?await document.exitFullscreen():await document.documentElement.requestFullscreen(); }catch(e){} };

const carSel=$("car");
carSel.innerHTML=Object.entries(CARS).map(([id,c])=>`<option value="${id}">${c.name}</option>`).join("");
carSel.value=carId;
carSel.onchange=()=>{
  if(mode==="on"||mode==="busy"){ carSel.value=carId; return; }
  carId=carSel.value; CAR=CARS[carId]; REDLINE=CAR.redline; RPM_MAX=CAR.rpmMax;
  try{ localStorage.setItem("fitdash.car",carId); }catch(e){}
  drawTach(); dispRpm=0;
  Object.assign(trip,{dist:0,fuel:0,time:0,last:0,maxS:0,maxR:0,maxC:null});
  Object.assign(acc,{state:"wait",last:null,best:null,split60:null,hist:[]});
  dtcState=null; showDtc();
  setCorr(0);
  if(mode==="demo"){ stopDemo(); startDemo(); } else { resetState(); render(); }
};

let saved="dash"; try{ saved=localStorage.getItem("fitdash.tab")||"dash"; }catch(e){}
setTab(["dash","eng","trip","diag"].includes(saved)?saved:"dash");
startDemo();
})();
