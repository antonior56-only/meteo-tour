'use strict';
const CACHE_NAME = 'meteo-shell-current';
const SHELL = ['./','./index.html','./manifest.json','./base.css','./app.css','./translations.js','./core.js','./app.js','./vendor/chart.umd.js','./icon-192.png','./icon-512.png'];
const SHELL_URLS = new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  // This install migrates existing installations to the automatic refresh strategy.
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    const previous=names.filter(name=>name.startsWith('meteo-shell-')&&name!==CACHE_NAME);
    await Promise.all(previous.map(name=>caches.delete(name)));
    await self.clients.claim();
    if(previous.length){const windows=await self.clients.matchAll({type:'window'});await Promise.all(windows.map(client=>client.navigate(client.url).catch(()=>null)));}
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
});
async function networkFirst(request,cacheKey=request){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok)await cache.put(cacheKey,response.clone());
    return response;
  }catch(error){
    const cached=await cache.match(cacheKey);
    if(cached)return cached;
    throw error;
  }
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Do not cache API responses, official portals, or any other app's assets.
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'&&url.href.startsWith(self.registration.scope)){
    event.respondWith(networkFirst(request,new URL('./index.html',self.registration.scope).href));return;
  }
  if(SHELL_URLS.has(url.href))event.respondWith(networkFirst(request));
});
