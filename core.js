/* Pure data helpers shared by the app and regression checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeteoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = Number.isFinite;
  const validLocation = p => !!p && finite(p.lat) && finite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && typeof p.name === 'string' && p.name.trim().length > 0;
  const sameLocation = (a, b) => validLocation(a) && validLocation(b) && Math.abs(a.lat-b.lat)<0.0001 && Math.abs(a.lon-b.lon)<0.0001;
  const cacheKey = p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const toTemp = (v, celsius=true) => finite(v) ? (celsius ? v : v*9/5+32) : null;
  const toWind = (v, celsius=true) => finite(v) ? (celsius ? v : v*0.621371) : null;
  const numeric = values => (values || []).filter(finite);
  function range(values) { const v=numeric(values); return v.length ? [Math.min(...v),Math.max(...v)] : null; }
  function sum(values) { return values.length && values.every(finite) ? values.reduce((a,b)=>a+b,0) : null; }
  function formatNumber(value, digits=0, lang='it') { return finite(value) ? value.toLocaleString(lang==='it'?'it-IT':'en-US',{maximumFractionDigits:digits}) : '—'; }
  function calendarDate(iso, lang='it', long=false) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso.slice(0,10))) return '—';
    const date=new Date(iso.slice(0,10)+'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(lang==='it'?'it-IT':'en-US',{timeZone:'UTC',weekday:long?'long':'short',day:'numeric',month:long?'long':'short'});
  }
  function localClock(iso) { return typeof iso==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? iso.slice(11,16) : '—'; }
  function validWeather(d) {
    return !!d && !!d.current && typeof d.current.time==='string' && !!d.hourly && Array.isArray(d.hourly.time) && d.hourly.time.length>0 && Array.isArray(d.hourly.temperature_2m) && d.hourly.temperature_2m.length===d.hourly.time.length && !!d.daily && Array.isArray(d.daily.time) && d.daily.time.length>0;
  }
  function validComponent(c, validator=()=>true) { return !!c && finite(c.fetchedAt) && c.fetchedAt>0 && c.fetchedAt<=Date.now()+60000 && !!c.data && validator(c.data); }
  function isFresh(c, ttl=600000, now=Date.now()) { return validComponent(c) && now-c.fetchedAt>=0 && now-c.fetchedAt<ttl; }
  function cleanFavorites(input, fallback, max=20) {
    if (!Array.isArray(input)) return fallback.map(p=>({...p}));
    const out=[];
    for (const p of input) if(validLocation(p) && !out.some(q=>sameLocation(p,q))) out.push({name:p.name.trim().slice(0,160),lat:p.lat,lon:p.lon,countryCode:typeof p.countryCode==='string'?p.countryCode:''});
    return out.slice(0,max);
  }
  function haversine(a,b) {
    if (![a.lat,a.lon,b.lat,b.lon].every(finite)) return Infinity;
    const rad=x=>x*Math.PI/180, dlat=rad(b.lat-a.lat), dlon=rad(b.lon-a.lon);
    const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function nearbyMarine(data, place, maxKm=30) {
    if(!data?.current) return false;
    const distance=haversine(place,{lat:data.latitude,lon:data.longitude});
    return distance<=maxKm && finite(data.current.wave_height);
  }
  function radarUrl(place,lang='it',celsius=true,timezone='UTC') {
    if(!validLocation(place))return null;
    // The same radar endpoint and bounds order used by meteoeradar.it.
    // Bounds are north,west,south,east (WGS84). Use a local view, about 100 km tall.
    const lat=Math.max(-84,Math.min(84,place.lat));
    const width=Math.min(5,0.65/Math.cos(lat*Math.PI/180));
    const bounds=[lat+0.45,Math.max(-180,place.lon-width),lat-0.45,Math.min(180,place.lon+width)].map(v=>v.toFixed(4)).join(',');
    return 'https://radar.wo-cloud.com/pwa/?'+new URLSearchParams({latitude:place.lat.toFixed(4),longitude:place.lon.toFixed(4),zoom:'8',bounds,tz:timezone,tf:'HH:mm',tempunit:celsius?'celsius':'fahrenheit',windunit:celsius?'kmh':'mph',lang:lang==='it'?'it-IT':'en-GB',safeAreaTop:'true',safeAreaBottom:'true',desktop:'true',fadeTop:'false'});
  }
  class RequestGate {
    constructor(){this.version=0;this.controller=null;}
    begin(){this.controller?.abort();this.controller=new AbortController();return {id:++this.version,signal:this.controller.signal};}
    current(token){return token?.id===this.version && !token.signal.aborted;}
  }
  async function fetchJSON(url, signal, timeoutMs=12000) {
    const controller=new AbortController();
    const relay=()=>controller.abort();
    if(signal?.aborted) controller.abort();
    signal?.addEventListener('abort',relay,{once:true});
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try { const r=await fetch(url,{signal:controller.signal,cache:'no-store'}); if(!r.ok)throw new Error(`HTTP ${r.status}`); const data=await r.json(); if(data?.error)throw new Error(data.reason||'API error'); return data; }
    finally {clearTimeout(timer);signal?.removeEventListener('abort',relay);}
  }
  return {finite,validLocation,sameLocation,cacheKey,toTemp,toWind,numeric,range,sum,formatNumber,calendarDate,localClock,validWeather,validComponent,isFresh,cleanFavorites,haversine,nearbyMarine,radarUrl,RequestGate,fetchJSON};
});
