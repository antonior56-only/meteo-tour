'use strict';
const C = MeteoCore;
const $ = id => document.getElementById(id);
const TTL = 10 * 60 * 1000;
const STORE = { favorites:'weather_favs_v9', settings:'meteo_settings_v1', cache:'meteo_data_v10' };
const PRESETS = [
  ['Palermo',38.1157,13.3613],['Segesta',37.9414,12.8322],['Mazara del Vallo',37.6489,12.5895],
  ['Agrigento',37.3111,13.5765],['Piazza Armerina',37.3838,14.3676],['Ragusa',36.9269,14.7253],
  ['Siracusa',37.0755,15.2866],['Catania',37.5079,15.0830],['Taormina',37.8522,15.2883],['Milo',37.7243,15.1169]
].map(([name,lat,lon])=>({name,lat,lon,countryCode:'IT'}));
function read(key) { try{return JSON.parse(localStorage.getItem(key));}catch{return null;} }
function write(key,value) { try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;} }
const saved=read(STORE.settings)||{};
let lang=saved.lang==='en'?'en':'it';
let celsius=typeof saved.celsius==='boolean'?saved.celsius:lang==='it';
let favorites=C.cleanFavorites(read(STORE.favorites),PRESETS);
let cache=read(STORE.cache);
if(!cache||typeof cache!=='object'||Array.isArray(cache))cache={};
let locationNow=null, weather=null, air=null, marine=null;
let currentToken=null, busy=false, lastAttempt=0, failure=false, selectedDay=null, modalTrigger=null;
let auxStatus={air:'empty',marine:'empty'};
const gate=new C.RequestGate(), searchGate=new C.RequestGate();
const charts={};
let activeChart='tempHumidity';
let radarForecastHours=24;
let toastTimer, toastHideTimer, suggestionTimer, suggestionResults=[], suggestionIndex=-1;
let installPrompt=null, officialMode=null, updateWorker=null, updatingApp=false;
const L=(it,en)=>lang==='it'?it:en;
const t=()=>i18n[lang];
const n=(v,d=0)=>C.formatNumber(v,d,lang);
const temp=v=>C.finite(v)?`${n(C.toTemp(v,celsius))}${celsius?'°C':'°F'}`:'—';
const wind=v=>C.finite(v)?`${n(C.toWind(v,celsius))} ${celsius?'km/h':'mph'}`:'—';
const unit=(v,u,d=0)=>C.finite(v)?`${n(v,d)} ${u}`:'—';
const text=(id,value)=>{if($(id))$(id).textContent=value;};
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function metric(label,value){return `<div class="metric"><span class="metric-label">${escapeHTML(label)}</span><span class="metric-value">${escapeHTML(value)}</span></div>`;}
function persistSettings(){write(STORE.settings,{lang,celsius,location:locationNow});}
function persistCache(){
  const entries=Object.entries(cache).filter(([,v])=>v&&typeof v==='object').sort((a,b)=>(b[1].weather?.fetchedAt||0)-(a[1].weather?.fetchedAt||0)).slice(0,24);
  cache=Object.fromEntries(entries);
  if(!write(STORE.cache,cache)){
    // Keep the selected city if the browser's storage quota is small.
    if(locationNow&&cache[C.cacheKey(locationNow)])write(STORE.cache,{[C.cacheKey(locationNow)]:cache[C.cacheKey(locationNow)]});
  }
}
function cachedPart(place,key,validator){const c=cache[C.cacheKey(place)]?.[key];return C.validComponent(c,validator)?c:null;}
function savePart(place,key,value){const k=C.cacheKey(place);if(!cache[k]||typeof cache[k]!=='object')cache[k]={};cache[k][key]=value;persistCache();}
function downloaded(c){return c?new Date(c.fetchedAt).toLocaleString(lang==='it'?'it-IT':'en-US',{dateStyle:'short',timeStyle:'short'}):'—';}
function componentStatus(c,status){
  if(status==='loading')return L('Aggiornamento in corso…','Updating…');
  if(!c)return navigator.onLine===false?L('Offline · nessun dato salvato','Offline · no saved data'):L('Dati non disponibili. Riprova con Aggiorna.','Data unavailable. Use Refresh to retry.');
  return `${status==='error'||!C.isFresh(c,TTL)?L('Dati salvati · ','Saved data · '):''}${L('Scaricati: ','Downloaded: ')}${downloaded(c)}`;
}
function showToast(message,type='info'){
  clearTimeout(toastTimer);clearTimeout(toastHideTimer);
  text('toast',message);$('toast').dataset.type=type;$('toast').classList.remove('hidden','opacity-0');
  toastTimer=setTimeout(()=>{$('toast').classList.add('opacity-0');toastHideTimer=setTimeout(()=>$('toast').classList.add('hidden'),220);},4500);
}
function setBusy(value){busy=value;$('loadingSpinner').classList.toggle('hidden',!value);$('loadingSpinner').hidden=!value;$('refreshBtn').disabled=value||!locationNow; $('mainContent').setAttribute('aria-busy',String(value));renderStatus();}
function renderStatus(){
  let state='online',message=L('Online','Online');
  if(navigator.onLine===false){state='offline';message=L('Offline · visualizzi gli ultimi dati salvati, se disponibili','Offline · showing last saved data where available');}
  else if(busy)message=L('Aggiornamento in corso…','Updating…');
  else if(failure){state='error';message=L('Aggiornamento non riuscito · riprova','Update failed · please retry');}
  else if(weather&&!C.isFresh(weather,TTL)){state='stale';message=L('Dati non aggiornati','Data is out of date');}
  else if(weather)message=L('Online · dati aggiornati','Online · data up to date');
  else message=L('Scegli una città o usa la tua posizione','Choose a city or use your location');
  $('statusBar').dataset.state=state;text('connectionStatus',message);
  if(updateWorker)text('refreshBtn',L('Nuova versione · Ricarica','New version · Reload'));
}
function applyTranslations(){
  document.documentElement.lang=lang;document.title=t().appTitle;
  const labels={appTitle:t().appTitle,searchBtnLabel:t().searchBtn,lblHumidity:t().humidity,lblWind:t().wind,lblPressure:L('Pressione al suolo','Surface pressure'),lblDew:t().dew,lblAqi:'AQI '+L('europeo','European'),lblUv:t().uv,lblSunrise:t().sunrise,lblSunset:t().sunset,lblFeelsLike:t().feelsLike,lblChartTitle:t().chartTitle,lblForecastTitle:t().forecastTitle,lblForecastHint:t().dayDetail.tapHint,lblChartTempSeries:t().temperature,lblChartHumiditySeries:t().humidity,chartParamTemp:`🌡️💧 ${t().chartBtnTempHumidity}`,chartParamRain:L('🌧️ Precipitazioni','🌧️ Precipitation'),refreshBtn:L('↻ Aggiorna','↻ Refresh'),langBtn:lang.toUpperCase(),unitBtn:celsius?'°C':'°F',dayDetailBottomClose:t().dayDetail.close,dayDetailTrendLabel:t().dayDetail.hourlyTrend,iosInstallHintText:t().iosInstallHint,airTitle:L('Qualità dell’aria','Air quality'),pollenTitle:L('Pollini','Pollen'),marineTitle:L('Meteo mare','Marine weather'),marineBadge:L('Mare vicino','Nearby sea'),officialTitle:'Meteo & Radar',closeOfficialBtn:t().dayDetail.close,radarForecastTitle:L('Precipitazioni previste','Precipitation forecast')};
  Object.entries(labels).forEach(([id,value])=>text(id,value));
  text('officialTitle','Meteo & Radar');
  text('loadMeteoRadarBtn',L('Radar in app','In-app radar'));
  text('meteoRadarLink',L('Radar esterno','External radar'));
  $('radarRangeControls').setAttribute('aria-label',L('Fascia della previsione','Forecast range'));
  $('radarForecastHours').setAttribute('aria-label',L('Previsione oraria delle precipitazioni','Hourly precipitation forecast'));
  $('cityInput').placeholder=t().searchPlaceholder;
  const arias={cityInput:t().ariaSearch,searchBtn:t().ariaSearch,geoBtn:t().ariaGeo,unitBtn:t().ariaUnit,langBtn:t().ariaLang,installBtn:t().ariaInstall,dayDetailClose:t().dayDetail.close,iosInstallHintClose:t().dayDetail.close,loadingSpinner:t().loading};
  Object.entries(arias).forEach(([id,label])=>{$(id).setAttribute('aria-label',label);$(id).title=label;});
  $('suggestions').setAttribute('aria-label',L('Città','Cities'));
  text('installBtn',`📥 ${t().installBtnLabel}`);
  $('lblProvider').innerHTML='<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo · CC BY 4.0</a>';
  text('pollenNote',L('Granuli/m³. Disponibilità limitata all’Europa e alla stagione pollinica. “—” indica un dato mancante.','Grains/m³. Availability is limited to Europe and pollen season. “—” means missing data.'));
  text('marineNote',L('Previsione sul punto marino del modello entro 30 km: non è una misura sulla spiaggia né un’indicazione di sicurezza per la navigazione.','Forecast for a model sea point within 30 km: not a beach measurement or a navigation safety assessment.'));
  text('officialSource','Fonte dati radar: Meteo & Radar / WetterOnline');
  renderFavorites();renderAll();
}
const ICONS={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',56:'🌧️',57:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',66:'🌧️',67:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',77:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'❄️',95:'⛈️',96:'⛈️',99:'⛈️'};
function weatherInfo(code,isDay=true){return {text:C.finite(code)?(t().weather[code]||t().weather.def):L('Dato non disponibile','Data unavailable'),icon:C.finite(code)?(!isDay&&code<=2?(code===2?'☁️':'🌙'):ICONS[code]||'🌡️'):'—'};}
function compass(deg){return C.finite(deg)?t().dayDetail.compass[Math.round(((deg%360)+360)%360/45)%8]:'—';}
function aqiInfo(value){
  if(!C.finite(value)||value<0)return {label:'—',color:'#94a3b8'};
  const keys=['good','fair','moderate','poor','veryPoor','extreme'],colors=['#4ade80','#a3e635','#facc15','#fb923c','#f87171','#c084fc'];
  const i=value<=20?0:value<=40?1:value<=60?2:value<=80?3:value<=100?4:5;return {label:t().aqiLevels[keys[i]],color:colors[i]};
}
function renderWeather(){
  const d=weather?.data,c=d?.current||{},daily=d?.daily||{},here=locationNow;
  text('cityName',here?.name||L('Scegli una città','Choose a city'));
  text('cityCoords',here?`Lat: ${here.lat.toFixed(2)}, Lon: ${here.lon.toFixed(2)}`:'');
  text('currentTemp',temp(c.temperature_2m));text('currentApparentTemp',temp(c.apparent_temperature));
  text('currentHumidity',unit(c.relative_humidity_2m,'%'));text('currentWind',wind(c.wind_speed_10m));
  text('currentGust',C.finite(c.wind_gusts_10m)?`${t().gustLabel}: ${wind(c.wind_gusts_10m)}`:'');
  text('currentPressure',unit(c.surface_pressure,'hPa'));text('currentDew',temp(c.dew_point_2m));
  const direction=$('windDirIcon');direction.style.transform=`rotate(${C.finite(c.wind_direction_10m)?c.wind_direction_10m:0}deg)`;
  direction.hidden=!C.finite(c.wind_direction_10m);direction.title=L('Vento da ','Wind from ')+compass(c.wind_direction_10m);
  text('currentSunrise',C.localClock(daily.sunrise?.[0]));text('currentSunset',C.localClock(daily.sunset?.[0]));
  const info=weatherInfo(c.weather_code,c.is_day!==0);text('weatherIcon',info.icon);text('weatherDesc',d?info.text:L('In attesa di dati','Waiting for data'));
  const uv=c.uv_index;const uvKey=!C.finite(uv)?null:uv<3?'low':uv<6?'moderate':uv<8?'high':uv<11?'veryHigh':'extreme';
  text('currentUv',uvKey?`${n(uv,1)} · ${t().uvLevels[uvKey]}`:'—');text('uvAdvice',uvKey?t().uvAdvice[uvKey]:'');
  text('lastUpdated',weather?`${L('Scaricato sul dispositivo: ','Downloaded to device: ')}${downloaded(weather)}`:'');
  text('dataTime',d?`${L('Dati meteo: ','Weather data: ')}${C.calendarDate(c.time,lang)} ${C.localClock(c.time)} · ${d.timezone||'GMT'}`:'');
  renderAqiSummary();renderForecast();renderCharts();renderRadarForecast();checkFavorite();
}
function renderAqiSummary(){const v=air?.data.current?.european_aqi,info=aqiInfo(v);text('currentAqi',C.finite(v)?`${n(v)} · ${info.label}`:'—');$('currentAqi').style.color=info.color;}
function renderForecast(){
  const container=$('dailyForecastContainer');container.replaceChildren();const d=weather?.data.daily;
  if(!d)return;
  d.time.slice(0,4).forEach((date,i)=>{
    const info=weatherInfo(d.weather_code?.[i]),button=document.createElement('button');button.type='button';button.className='forecast-card';button.dataset.dayIndex=String(i);
    const rain=unit(d.precipitation_sum?.[i],'mm',1),prob=unit(d.precipitation_probability_max?.[i],'%');
    button.innerHTML=`<span class="forecast-date">${escapeHTML(C.calendarDate(date,lang))}</span><span class="forecast-icon" aria-hidden="true">${info.icon}</span><span class="forecast-temp">${temp(d.temperature_2m_max?.[i])} / ${temp(d.temperature_2m_min?.[i])}</span><span class="forecast-rain">🌧️ ${rain} · ${prob}</span>`;
    button.setAttribute('aria-label',`${C.calendarDate(date,lang,true)}: ${info.text}, ${temp(d.temperature_2m_max?.[i])} / ${temp(d.temperature_2m_min?.[i])}, ${L('precipitazioni','precipitation')} ${rain}, ${prob}`);
    button.addEventListener('click',()=>openDay(i,button));container.appendChild(button);
  });
}
function destroyChart(id){try{charts[id]?.destroy();}catch{}delete charts[id];const cv=$(id);cv?.parentElement?.querySelector('.chart-fallback')?.remove();cv?.classList.remove('hidden');}
function drawFallbackChart(cv,labels,values,label,color,kind,bounds){
  const width=Math.max(280,cv.parentElement.clientWidth||600),height=Math.max(120,cv.parentElement.clientHeight||180),left=42,right=10,top=10,bottom=28,plotW=width-left-right,plotH=height-top-bottom;
  const numeric=values.map((value,index)=>C.finite(value)?{value,index}:null).filter(Boolean),range=C.range(values);
  const fallback=document.createElement('div');fallback.className='chart-fallback';fallback.setAttribute('role','img');fallback.setAttribute('aria-label',cv.getAttribute('aria-label')||label);cv.classList.add('hidden');cv.parentElement.appendChild(fallback);
  if(!range){fallback.innerHTML=`<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#cbd5e1" font-size="14">${escapeHTML(L('Nessun dato','No data'))}</text></svg>`;return;}
  let min=C.finite(bounds.min)?bounds.min:(bounds.beginAtZero?0:range[0]),max=C.finite(bounds.max)?bounds.max:range[1];if(min===max){min-=1;max+=1;}else if(!C.finite(bounds.min)&&!bounds.beginAtZero){const pad=(max-min)*.12;min-=pad;max+=pad;}
  const x=index=>left+(values.length<2?plotW/2:index*plotW/(values.length-1)),y=value=>top+(max-value)*plotH/(max-min);
  const grid=Array.from({length:5},(_,i)=>{const value=max-(max-min)*i/4,py=top+plotH*i/4;return `<line x1="${left}" y1="${py}" x2="${width-right}" y2="${py}" stroke="#475569" stroke-width="1"/><text x="${left-6}" y="${py+4}" text-anchor="end" fill="#cbd5e1" font-size="11">${escapeHTML(n(value,0))}</text>`;}).join('');
  const tickCount=Math.min(6,labels.length),tickIndexes=[...new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(labels.length-1)/Math.max(1,tickCount-1))))];
  const ticks=tickIndexes.map(index=>`<text x="${x(index)}" y="${height-7}" text-anchor="middle" fill="#cbd5e1" font-size="11">${escapeHTML(labels[index]||'')}</text>`).join('');
  let marks='';
  if(kind==='bar'){const barWidth=Math.max(2,plotW/Math.max(1,values.length)*.65);marks=numeric.map(({value,index})=>`<rect x="${x(index)-barWidth/2}" y="${y(value)}" width="${barWidth}" height="${Math.max(0,top+plotH-y(value))}" rx="2" fill="${color}" opacity=".85"/>`).join('');}
  else{const points=numeric.map(({value,index})=>`${x(index)},${y(value)}`).join(' ');marks=`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`+numeric.map(({value,index})=>`<circle cx="${x(index)}" cy="${y(value)}" r="2.7" fill="${color}"/>`).join('');}
  fallback.innerHTML=`<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${marks}${ticks}</svg>`;
}
function drawChart(id,labels,values,label,color,kind='line',bounds={}){
  destroyChart(id);const cv=$(id),valid=C.numeric(values),r=C.range(values);
  cv.setAttribute('role','img');cv.setAttribute('aria-label',`${label}: ${r?`${n(r[0],1)} – ${n(r[1],1)}`:L('nessun dato','no data')}. ${valid.length}/${values.length} ${L('valori disponibili','values available')}.`);
  if(typeof Chart!=='function'){drawFallbackChart(cv,labels,values,label,color,kind,bounds);return;}
  try{
    charts[id]=new Chart(cv.getContext('2d'),{type:kind,data:{labels,datasets:[{label,data:values.map(v=>C.finite(v)?v:null),borderColor:color,backgroundColor:color+'30',borderWidth:3,fill:kind==='line',tension:0,pointRadius:2,pointHoverRadius:4,spanGaps:false}]},options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{y:{...bounds,grid:{color:'#475569'},ticks:{color:'#cbd5e1',font:{size:11}}},x:{grid:{display:false},ticks:{color:'#cbd5e1',maxTicksLimit:6,font:{size:11}}}},plugins:{legend:{display:false}}}});
  }catch(e){console.warn('Chart unavailable',e);drawFallbackChart(cv,labels,values,label,color,kind,bounds);}
}
function renderCharts(){
  ['hourlyChartTemp','hourlyChartHumidity','hourlyChartRain'].forEach(destroyChart);
  $('tempHumidityView').classList.toggle('hidden',activeChart!=='tempHumidity');$('rainView').classList.toggle('hidden',activeChart!=='rain');
  ['Temp','Rain'].forEach(key=>{const active=(key==='Temp')===(activeChart==='tempHumidity');$('chartParam'+key).setAttribute('aria-pressed',String(active));$('chartParam'+key).classList.toggle('bg-cyan-600',active);});
  $('chartNotice').classList.add('hidden');if(!weather)return;
  const d=weather.data,h=d.hourly,current=d.current.time.slice(0,13)+':00';let start=h.time.findIndex(x=>x>=current);if(start<0)start=0;
  const hours=h.time.slice(start,start+24),labels=hours.map(C.localClock);
  const vals=key=>hours.map((_,i)=>h[key]?.[start+i]);
  if(activeChart==='tempHumidity'){
    drawChart('hourlyChartTemp',labels,vals('temperature_2m').map(v=>C.toTemp(v,celsius)),`${t().temperature} ${celsius?'°C':'°F'}`,'#38bdf8');
    drawChart('hourlyChartHumidity',labels,vals('relative_humidity_2m'),`${t().humidity} %`,'#fb923c','line',{min:0,max:100});
  }else{
    drawChart('hourlyChartRain',labels,vals('precipitation'),L('Precipitazioni mm','Precipitation mm'),'#818cf8','bar',{beginAtZero:true});
    if(charts.hourlyChartRain){charts.hourlyChartRain.options.plugins.tooltip={callbacks:{afterLabel:ctx=>{const p=h.precipitation_probability?.[start+ctx.dataIndex];return C.finite(p)?`${L('Probabilità','Probability')}: ${n(p)}%`:'';}}};charts.hourlyChartRain.update();}
  }
}
function renderAir(){
  const d=air?.data,c=d?.current||{};text('airStatus',componentStatus(air,auxStatus.air)+(d?` · ${C.localClock(c.time)} ${d.timezone||'GMT'}`:''));
  const info=aqiInfo(c.european_aqi);
  $('airMetrics').innerHTML=metric('AQI '+L('europeo','European'),C.finite(c.european_aqi)?`${n(c.european_aqi)} · ${info.label}`:'—')+[['PM₂.₅','pm2_5'],['PM₁₀','pm10'],['NO₂','nitrogen_dioxide'],['O₃','ozone'],['SO₂','sulphur_dioxide']].map(([label,key])=>metric(label,unit(c[key],'µg/m³',1))).join('');
  $('pollenMetrics').innerHTML=[[L('Graminacee','Grass'),'grass_pollen'],[L('Olivo','Olive'),'olive_pollen'],[L('Betulla','Birch'),'birch_pollen'],[L('Ambrosia','Ragweed'),'ragweed_pollen'],[L('Ontano','Alder'),'alder_pollen'],[L('Artemisia','Mugwort'),'mugwort_pollen']].map(([label,key])=>metric(label,unit(c[key],L('granuli/m³','grains/m³')))).join('');
  renderAqiSummary();
}
function renderMarine(){
  $('marineMetrics').replaceChildren();$('marineForecast').replaceChildren();
  if(!marine){text('marineStatus',componentStatus(null,auxStatus.marine));return;}
  const d=marine.data;
  if(!locationNow||!C.nearbyMarine(d,locationNow)){
    text('marineStatus',auxStatus.marine==='error'?L('Verifica del mare vicino non riuscita. Riprova con Aggiorna.','Nearby sea check failed. Use Refresh to retry.'):L('Nessun punto marino con dati entro 30 km. La località può essere interna oppure il modello non copre il tratto costiero.','No sea point with data within 30 km. The location may be inland or the coastal area may not be covered.'));return;
  }
  const c=d.current,dist=C.haversine(locationNow,{lat:d.latitude,lon:d.longitude});
  text('marineStatus',`${componentStatus(marine,auxStatus.marine)} · ${L('Punto marino a circa','Sea point about')} ${n(dist)} km (${d.latitude.toFixed(2)}, ${d.longitude.toFixed(2)}). ${C.localClock(c.time)} ${d.timezone||'GMT'}`);
  $('marineMetrics').innerHTML=metric(L('Altezza onde','Wave height'),unit(c.wave_height,'m',1))+metric(L('Periodo onde','Wave period'),unit(c.wave_period,'s',1))+metric(L('Onde da','Waves from'),compass(c.wave_direction))+metric(L('Temperatura acqua','Water temperature'),C.finite(c.sea_surface_temperature)?`${n(C.toTemp(c.sea_surface_temperature,celsius),1)} ${celsius?'°C':'°F'}`:'—');
  const h=d.hourly;if(h?.time){const indices=h.time.map((x,i)=>({x,i})).filter(({x})=>x>=c.time.slice(0,13)+':00').slice(0,12).filter((_,i)=>i%3===0);$('marineForecast').innerHTML=indices.map(({x,i})=>metric(`${C.localClock(x)} · ${L('onde','waves')}`,unit(h.wave_height?.[i],'m',1))).join('');}
}
function renderRadarForecast(){
  const container=$('radarForecastHours'),h=weather?.data.hourly,current=weather?.data.current?.time;
  document.querySelectorAll('[data-radar-hours]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.radarHours)===radarForecastHours)));
  container.replaceChildren();
  if(!h?.time?.length||!current){text('radarForecastStatus',L('Scegli una città per visualizzare la previsione oraria.','Choose a city to view the hourly forecast.'));return;}
  const currentHour=current.slice(0,13)+':00';let start=h.time.findIndex(value=>value>=currentHour);if(start<0)start=0;
  const end=Math.min(start+radarForecastHours,h.time.length),items=[];
  for(let i=start;i<end;i++){
    const iso=h.time[i],date=C.calendarDate(iso.slice(0,10),lang),clock=C.localClock(iso),info=weatherInfo(h.weather_code?.[i],h.is_day?.[i]!==0);
    const rain=unit(h.precipitation?.[i],'mm',1),probability=unit(h.precipitation_probability?.[i],'%');
    const label=`${date} ${clock}: ${info.text}, ${L('precipitazioni','precipitation')} ${rain}, ${L('probabilità','probability')} ${probability}`;
    items.push(`<article class="radar-hour" aria-label="${escapeHTML(label)}"><span class="radar-hour-time">${escapeHTML(date)}<br>${escapeHTML(clock)}</span><span class="radar-hour-icon" aria-hidden="true">${info.icon}</span><span class="radar-hour-rain">${escapeHTML(rain)}</span><span class="radar-hour-probability">${escapeHTML(L('Prob.','Prob.'))} ${escapeHTML(probability)}</span></article>`);
  }
  container.innerHTML=items.join('');
  const count=end-start;text('radarForecastStatus',L(`Previsione oraria per le prossime ${count} ore. Scorri lateralmente per vedere tutta la fascia.`,`Hourly forecast for the next ${count} hours. Scroll sideways to view the full range.`));
}
function renderOfficial(){
  const name=locationNow?.name||L('la località','the location');
  text('officialNote',L(`Radar centrato su ${name}.`,`Radar centred on ${name}.`));
  const radar=C.radarUrl(locationNow,lang,celsius,weather?.data.timezone||'UTC');
  $('loadMeteoRadarBtn').disabled=!radar;
  $('meteoRadarLink').href=radar||'https://www.meteoeradar.it/radar-meteo';
  if(officialMode==='meteoRadar'&&radar&&$('officialFrame').src!==radar)$('officialFrame').src=radar;
  text('frameHelp',L('Il contenuto proviene dal sito del fornitore. Se non compare, usa il collegamento “Apri” qui sopra.','Content comes from the provider’s website. If it does not appear, use the “Open” link above.'));
  if(officialMode)text('frameStatus',`Meteo & Radar · ${name}`);
}
function renderAll(){renderWeather();renderAir();renderMarine();renderOfficial();renderStatus();if(selectedDay!==null)renderDay(selectedDay);}
function checkFavorite(){
  const available=!!weather&&C.validLocation(locationNow),fav=available&&favorites.some(p=>C.sameLocation(p,locationNow));
  $('favBtn').disabled=!available;text('favBtn',fav?'❤️':'🤍');$('favBtn').setAttribute('aria-pressed',String(fav));$('favBtn').setAttribute('aria-label',fav?t().ariaFavRemove:t().ariaFavAdd);$('favBtn').title=fav?t().ariaFavRemove:t().ariaFavAdd;
}
function renderFavorites(){
  const bar=$('favoritesBar');bar.replaceChildren();
  favorites.forEach(p=>{const btn=document.createElement('button');btn.className='bg-slate-700/80 hover:bg-slate-600 border border-slate-600 text-xs px-3 py-1.5 rounded-full';btn.textContent='⭐ '+p.name.split(',')[0];btn.title=p.name;btn.addEventListener('click',()=>selectLocation(p));bar.appendChild(btn);});
  if(favorites.length<20){const b=document.createElement('button');b.className='text-link text-xs px-2';b.textContent='+ '+t().addOriginCity;b.addEventListener('click',()=>$('cityInput').focus());bar.appendChild(b);}
}
function invalidateSuggestions(){clearTimeout(suggestionTimer);searchGate.begin();suggestionResults=[];suggestionIndex=-1;$('suggestions').replaceChildren();$('suggestions').classList.add('hidden');$('cityInput').setAttribute('aria-expanded','false');$('cityInput').removeAttribute('aria-activedescendant');}
function startSelection(){invalidateSuggestions();closeDay(false);currentToken=gate.begin();failure=false;lastAttempt=Date.now();setBusy(false);return currentToken;}
async function selectLocation(place,{force=false,token=null}={}){
  if(!C.validLocation(place))return;
  token=token||startSelection();if(!gate.current(token))return;
  locationNow={...place,name:place.name.trim().slice(0,160)};persistSettings();
  weather=cachedPart(place,'weather',C.validWeather);air=cachedPart(place,'air',d=>!!d.current);marine=cachedPart(place,'marine',d=>!!d.current);
  auxStatus={air:air?'ready':'empty',marine:marine?'ready':'empty'};renderAll();
  if(navigator.onLine===false){setBusy(false);return;}
  loadAux(place,token,'air',force);loadAux(place,token,'marine',force);
  if(!force&&C.isFresh(weather,TTL)){setBusy(false);return;}
  setBusy(true);
  const params=new URLSearchParams({latitude:place.lat,longitude:place.lon,forecast_days:4,timezone:'auto',current:'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,dew_point_2m,uv_index',hourly:'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,apparent_temperature,is_day',daily:'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,apparent_temperature_max,apparent_temperature_min,precipitation_hours'});
  try{
    const data=await C.fetchJSON('https://api.open-meteo.com/v1/forecast?'+params,token.signal);
    if(!gate.current(token))return;if(!C.validWeather(data))throw Error('Invalid weather response');
    weather={data,fetchedAt:Date.now()};savePart(place,'weather',weather);failure=false;renderWeather();if(selectedDay!==null)renderDay(selectedDay);
  }catch(e){if(!gate.current(token))return;failure=true;showToast(t().errorApi,'error');}
  finally{if(gate.current(token))setBusy(false);}
}
async function loadAux(place,token,kind,force){
  const existing=kind==='air'?air:marine;if(!force&&C.isFresh(existing,TTL))return;
  auxStatus[kind]='loading';kind==='air'?renderAir():renderMarine();
  const current=kind==='air'?'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,grass_pollen,olive_pollen,birch_pollen,ragweed_pollen,alder_pollen,mugwort_pollen':'wave_height,wave_direction,wave_period,sea_surface_temperature';
  const params=new URLSearchParams({latitude:place.lat,longitude:place.lon,current,timezone:'auto',forecast_days:2});
  if(kind==='marine'){params.set('hourly','wave_height');params.set('cell_selection','sea');}
  const endpoint=kind==='air'?'https://air-quality-api.open-meteo.com/v1/air-quality':'https://marine-api.open-meteo.com/v1/marine';
  try{
    const data=await C.fetchJSON(endpoint+'?'+params,token.signal);
    if(!gate.current(token))return;if(!data?.current)throw Error('Invalid response');
    const component={data,fetchedAt:Date.now()};if(kind==='air')air=component;else marine=component;savePart(place,kind,component);auxStatus[kind]='ready';
  }catch(e){if(!gate.current(token))return;auxStatus[kind]='error';}
  finally{if(gate.current(token))kind==='air'?renderAir():renderMarine();}
}
function fromCity(city){return {name:[city.name,city.admin1,city.country].filter(Boolean).join(', '),lat:city.latitude,lon:city.longitude,countryCode:city.country_code||''};}
async function searchCity(){
  const q=$('cityInput').value.trim();if(q.length<2)return;const token=startSelection();setBusy(true);
  try{const data=await C.fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({name:q,count:1,language:lang,format:'json'})}`,token.signal);if(!gate.current(token))return;if(data.results?.length){await selectLocation(fromCity(data.results[0]),{token});}else{showToast(t().cityNotFound,'error');}}
  catch(e){if(gate.current(token))showToast(t().errorApi,'error');}
  finally{if(gate.current(token))setBusy(false);}
}
async function autocomplete(q,token){
  try{const data=await C.fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({name:q,count:5,language:lang,format:'json'})}`,token.signal,8000);
    if(!searchGate.current(token)||$('cityInput').value.trim()!==q)return;
    suggestionResults=(data.results||[]).map(fromCity).filter(C.validLocation);suggestionIndex=-1;
    $('suggestions').replaceChildren();suggestionResults.forEach((p,i)=>{const option=document.createElement('div');option.id='city-option-'+i;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=p.name;option.addEventListener('click',()=>{$('cityInput').value=p.name;selectLocation(p);});$('suggestions').appendChild(option);});
    $('suggestions').classList.toggle('hidden',!suggestionResults.length);$('cityInput').setAttribute('aria-expanded',String(!!suggestionResults.length));
  }catch(e){/* Explicit search reports failures; background suggestions stay unobtrusive. */}
}
function locate(){
  const token=startSelection();setBusy(true);
  if(!navigator.geolocation){locationFailure();return;}
  navigator.geolocation.getCurrentPosition(async pos=>{
    if(!gate.current(token))return;const place={name:L('La tua posizione','Your location'),lat:pos.coords.latitude,lon:pos.coords.longitude};
    selectLocation(place,{token});
    try{const data=await C.fetchJSON('https://api.bigdatacloud.net/data/reverse-geocode-client?'+new URLSearchParams({latitude:place.lat,longitude:place.lon,localityLanguage:lang}),token.signal,7000);
      if(!gate.current(token))return;const name=data.city||data.locality||data.principalSubdivision;
      if(name){locationNow={...place,name:[name,data.countryName].filter(Boolean).join(', '),countryCode:data.countryCode||''};favorites=favorites.map(p=>C.sameLocation(p,place)&&['La tua posizione','Your location'].includes(p.name)?{...locationNow}:p);write(STORE.favorites,favorites);persistSettings();text('cityName',locationNow.name);renderOfficial();renderFavorites();}
    }catch{}
  },locationFailure,{timeout:10000,maximumAge:300000,enableHighAccuracy:false});
  function locationFailure(){if(!gate.current(token))return;showToast(t().geoDenied,'error');selectLocation({name:'Roma',lat:41.9028,lon:12.4964,countryCode:'IT'},{token});}
}
function renderDay(index){
  if(!weather?.data.daily.time[index])return;const d=weather.data.daily,h=weather.data.hourly,dd=t().dayDetail;
  const info=weatherInfo(d.weather_code?.[index]);text('dayDetailTitle',C.calendarDate(d.time[index],lang,true));text('dayDetailIcon',info.icon);text('dayDetailDesc',info.text);text('dayDetailTrendLabel',dd.hourlyTrend);
  $('dayDetailMetrics').innerHTML=[metric(dd.maxMin,`${temp(d.temperature_2m_max?.[index])} / ${temp(d.temperature_2m_min?.[index])}`),metric(dd.feelsMaxMin,`${temp(d.apparent_temperature_max?.[index])} / ${temp(d.apparent_temperature_min?.[index])}`),metric(dd.uvMax,n(d.uv_index_max?.[index],1)),metric(dd.windMax,wind(d.wind_speed_10m_max?.[index])),metric(t().gustLabel,wind(d.wind_gusts_10m_max?.[index])),metric(dd.direction,compass(d.wind_direction_10m_dominant?.[index])),metric(t().sunrise,C.localClock(d.sunrise?.[index])),metric(t().sunset,C.localClock(d.sunset?.[index])),metric(L('Precipitazioni','Precipitation'),unit(d.precipitation_sum?.[index],'mm',1)),metric(L('Prob. precipitazioni','Precipitation prob.'),unit(d.precipitation_probability_max?.[index],'%')),metric(L('Ore di precipitazioni','Precipitation hours'),unit(d.precipitation_hours?.[index],'h',1))].join('');
  const indices=h.time.map((v,i)=>({v,i})).filter(({v})=>v.slice(0,10)===d.time[index]).map(({i})=>i);
  drawChart('dayDetailChart',indices.map(i=>C.localClock(h.time[i])),indices.map(i=>C.toTemp(h.temperature_2m[i],celsius)),`${t().temperature} ${celsius?'°C':'°F'}`,'#3987e5');
  $('dayDetailBands').innerHTML=['night','morning','afternoon','evening'].map((key,b)=>{
    const list=indices.filter(i=>Math.floor(Number(h.time[i].slice(11,13))/6)===b);const r=C.range(list.map(i=>h.temperature_2m[i])),probs=C.range(list.map(i=>h.precipitation_probability?.[i]));
    const codes=list.map(i=>h.weather_code?.[i]).filter(C.finite);let code=null;if(codes.length){const counts=new Map();codes.forEach(c=>counts.set(c,(counts.get(c)||0)+1));code=[...counts].sort((a,b)=>b[1]-a[1])[0][0];}
    const middle=list[Math.floor(list.length/2)],isDay=C.finite(h.is_day?.[middle])?!!h.is_day[middle]:b!==0&&b!==3;
    return metric(`${dd.bands[key]} ${weatherInfo(code,isDay).icon}`,`${r?temp(r[1])+' / '+temp(r[0]):'—'} · ${probs?unit(probs[1],'%'):'—'}`);
  }).join('');
}
function openDay(index,trigger){
  if(!weather)return;invalidateSuggestions();selectedDay=index;modalTrigger=trigger||document.activeElement;
  $('dayDetailModal').classList.remove('hidden');$('dayDetailModal').setAttribute('aria-hidden','false');document.body.classList.add('day-detail-open');
  for(const el of [document.querySelector('header'),$('mainContent'),$('statusBar'),$('iosInstallHint')])el.inert=true;
  renderDay(index);$('dayDetailClose').focus();
}
function closeDay(restore=true){
  const had=selectedDay!==null,oldIndex=selectedDay;selectedDay=null;destroyChart('dayDetailChart');$('dayDetailModal').classList.add('hidden');$('dayDetailModal').setAttribute('aria-hidden','true');document.body.classList.remove('day-detail-open');
  for(const el of [document.querySelector('header'),$('mainContent'),$('statusBar'),$('iosInstallHint')])el.inert=false;
  if(had&&restore){const target=modalTrigger?.isConnected?modalTrigger:document.querySelector(`[data-day-index="${oldIndex}"]`);target?.focus();}modalTrigger=null;
}
function showOfficial(){
  if(navigator.onLine===false){showToast(L('Collegati a Internet per consultare il portale ufficiale.','Connect to the internet to consult the official portal.'),'error');return;}
  officialMode='meteoRadar';$('officialViewer').classList.remove('hidden');$('officialFrame').title='Meteo & Radar';
  $('officialFrame').src=$('meteoRadarLink').href;
  $('loadMeteoRadarBtn').setAttribute('aria-expanded','true');renderOfficial();$('closeOfficialBtn').focus();
}
function closeOfficial(){const wasOpen=!!officialMode;officialMode=null;$('officialFrame').removeAttribute('src');$('officialViewer').classList.add('hidden');$('loadMeteoRadarBtn').setAttribute('aria-expanded','false');if(wasOpen)$('loadMeteoRadarBtn').focus();}
function refresh(force=false){if(!locationNow||busy)return;selectLocation(locationNow,{force});}
function autoRefresh(){renderStatus();if(document.visibilityState!=='visible'||navigator.onLine===false||busy||!locationNow||Date.now()-lastAttempt<60000)return;if(!C.isFresh(weather,TTL)||!C.isFresh(air,TTL)||!C.isFresh(marine,TTL))refresh();}
function setup(){
  $('cityInput').addEventListener('input',()=>{invalidateSuggestions();const q=$('cityInput').value.trim();if(q.length<2)return;const token=searchGate.begin();suggestionTimer=setTimeout(()=>autocomplete(q,token),350);});
  $('cityInput').addEventListener('keydown',e=>{
    if(e.key==='Escape'){invalidateSuggestions();return;}
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&suggestionResults.length){e.preventDefault();suggestionIndex=(suggestionIndex+(e.key==='ArrowDown'?1:-1)+suggestionResults.length)%suggestionResults.length;Array.from($('suggestions').children).forEach((el,i)=>el.setAttribute('aria-selected',String(i===suggestionIndex)));$('cityInput').setAttribute('aria-activedescendant','city-option-'+suggestionIndex);$('city-option-'+suggestionIndex).scrollIntoView({block:'nearest'});}
    if(e.key==='Enter'){e.preventDefault();if(suggestionIndex>=0){const place=suggestionResults[suggestionIndex];$('cityInput').value=place.name;selectLocation(place);}else searchCity();}
    if(e.key==='Tab')invalidateSuggestions();
  });
  document.addEventListener('click',e=>{if(!$('cityInput').contains(e.target)&&!$('suggestions').contains(e.target))invalidateSuggestions();});
  $('searchBtn').addEventListener('click',searchCity);$('geoBtn').addEventListener('click',locate);$('refreshBtn').addEventListener('click',()=>{if(updateWorker){updatingApp=true;updateWorker.postMessage({type:'ACTIVATE_UPDATE'});}else refresh(true);});
  $('unitBtn').addEventListener('click',()=>{celsius=!celsius;persistSettings();applyTranslations();});
  $('langBtn').addEventListener('click',()=>{lang=lang==='it'?'en':'it';celsius=lang==='it';invalidateSuggestions();persistSettings();applyTranslations();});
  $('favBtn').addEventListener('click',()=>{if(!weather||!C.validLocation(locationNow))return;const i=favorites.findIndex(p=>C.sameLocation(p,locationNow));if(i>=0)favorites.splice(i,1);else if(favorites.length<20)favorites.push({...locationNow});else{showToast(t().favFull.replace('{max}',20),'error');return;}write(STORE.favorites,favorites);renderFavorites();checkFavorite();});
  $('chartParamTemp').addEventListener('click',()=>{activeChart='tempHumidity';renderCharts();});$('chartParamRain').addEventListener('click',()=>{activeChart='rain';renderCharts();});
  document.querySelectorAll('[data-radar-hours]').forEach(button=>button.addEventListener('click',()=>{radarForecastHours=Number(button.dataset.radarHours);renderRadarForecast();$('radarForecastHours').scrollLeft=0;}));
  ['dayDetailClose','dayDetailBottomClose','dayDetailBackdrop'].forEach(id=>$(id).addEventListener('click',()=>closeDay()));
  document.addEventListener('keydown',e=>{if(selectedDay===null)return;if(e.key==='Escape'){e.preventDefault();closeDay();}else if(e.key==='Tab'){const els=[$('dayDetailClose'),$('dayDetailBottomClose')];if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els[1].focus();}else if(!e.shiftKey&&document.activeElement===els[1]){e.preventDefault();els[0].focus();}}});
  $('loadMeteoRadarBtn').addEventListener('click',showOfficial);$('closeOfficialBtn').addEventListener('click',closeOfficial);
  window.addEventListener('offline',()=>{closeOfficial();gate.controller?.abort();setBusy(false);auxStatus={air:'error',marine:'error'};renderAll();showToast(t().offlineMsg,'error');});
  window.addEventListener('online',()=>{renderStatus();if(locationNow)refresh(true);});
  document.addEventListener('visibilitychange',autoRefresh);window.addEventListener('focus',autoRefresh);setInterval(autoRefresh,60000);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').classList.remove('hidden');});
  window.addEventListener('appinstalled',()=>{installPrompt=null;$('installBtn').classList.add('hidden');});
  $('installBtn').addEventListener('click',async()=>{const prompt=installPrompt;installPrompt=null;$('installBtn').classList.add('hidden');if(prompt)try{await prompt.prompt();await prompt.userChoice;}catch{showToast(L('Installazione non disponibile in questo browser.','Installation unavailable in this browser.'),'error');}});
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ios&&!window.matchMedia('(display-mode: standalone)').matches&&!navigator.standalone&&!read('ios_hint_dismissed_v1'))$('iosInstallHint').classList.remove('hidden');
  $('iosInstallHintClose').addEventListener('click',()=>{$('iosInstallHint').classList.add('hidden');write('ios_hint_dismissed_v1',true);});
  if('serviceWorker'in navigator&&location.protocol!=='file:'){
    let controllerRefreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controllerRefreshing)return;controllerRefreshing=true;location.reload();});
    navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(reg=>{
      function ready(){if(reg.waiting){updateWorker=reg.waiting;text('refreshBtn',L('Nuova versione · Ricarica','New version · Reload'));showToast(L('Nuova versione disponibile: premi Ricarica.','New version available: press Reload.'));}}
      ready();reg.update().catch(()=>{});reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',ready);});
    }).catch(e=>{console.warn('Service worker',e);showToast(L('La modalità offline non è stata attivata.','Offline mode could not be enabled.'),'error');});
  }
  applyTranslations();write(STORE.favorites,favorites);
  if(C.validLocation(saved.location))selectLocation(saved.location);else locate();
}
setup();
