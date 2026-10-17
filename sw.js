const C='dorfit-v8';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/icon.svg','/manifest.json'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
 e.respondWith(fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(C).then(c=>c.put(r,y))}return x}).catch(()=>caches.match(r).then(m=>m||caches.match('/'))))});

self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(_){}
 const ios=/iP(hone|ad|od)/.test(self.navigator.userAgent);
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cl=>{if(!ios&&cl.some(c=>c.visibilityState==='visible'))return;
  return self.registration.showNotification(d.title||'DOR FIT',{body:d.body||'',tag:d.tag||'dorfit',renotify:true,vibrate:[300,120,300,120,300],silent:false,data:{url:d.url||'/'}})}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cl=>cl.length?cl[0].focus():self.clients.openWindow('/')))});
