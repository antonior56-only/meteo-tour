'use strict';
const CACHE_NAME = 'meteo-shell-v16-20260912';
const SHELL = ['./','./index.html','./manifest.json','./base.css','./app.css','./translations.js','./core.js','./app.js','./vendor/chart.umd.js','./icon-192.png','./icon-512.png'];
const SHELL_URLS = new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  // A complete release is cached atomically; the previous release stays active
  // until the user accepts an update or closes its remaining tabs.
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith('meteo-shell-')&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Do not cache API responses, official portals, or any other app's assets.
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'&&url.href.startsWith(self.registration.scope)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      return await cache.match(new URL('./index.html',self.registration.scope).href)||fetch(request);
    })());return;
  }
  if(SHELL_URLS.has(url.href))event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    return await cache.match(request)||fetch(request);
  })());
});
