const CACHE_NAME='mcb-shell-v2.12';
const SHELL=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname==='/version.json'){
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{
      const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put('/',copy)).catch(()=>{});return res;
    }).catch(()=>caches.match('/')));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy)).catch(()=>{});}return res;
  })));
});
