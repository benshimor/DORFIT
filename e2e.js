process.env.DB_PATH='/tmp/e2e.db';process.env.COACH_PASS='coachpass1';require('fs').rmSync('/tmp/e2e.db',{force:true});
const {JSDOM}=require('jsdom');
const app=require('./server.js');const srv=app.listen(3222);
const mk=()=>{let cookie='';const f=async(u,o={})=>{const r=await fetch('http://localhost:3222'+u,{...o,headers:{...(o.headers||{}),cookie}});const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0].startsWith('sid=')&&sc.includes('Max-Age=0')?'':sc.split(';')[0];return r};
 return f};
const html=require('fs').readFileSync('public/index.html','utf8').replace(/<link[^>]*>/g,'');
function client(){const f=mk();const d=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost:3222/',pretendToBeVisual:true,beforeParse(w){w.fetch=f;w.addEventListener('error',e=>console.log('ERR',e.message));w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{}}});return d.window}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const ok=(c,m)=>console.log(c?'PASS':'FAIL',m);
(async()=>{
const C=client();const run=c=>{try{return C.eval(c)}catch(e){console.log('EXC',c.slice(0,60),e.message)}};await sleep(400);
ok(C.document.body.textContent.includes('כניסה'),'login screen on boot');
await run("tryLogin('coach','bad')");ok(run('err').includes('שגויים'),'bad login message');
await run("tryLogin('coach','coachpass1')");ok(run("me().role")==='c','coach logged in');
run("ct='tr';render();document.getElementById('nn').value='דנה';document.getElementById('nu').value='dana';document.getElementById('np').value='dana1234'");await run("addUser()");
ok(run("S.users.some(u=>u.user==='dana')")&&C.document.body.textContent.includes('פרטי כניסה'),'trainee created + credentials box');
run("dtab='wk';render()");run("startProg(sel,S.progs.find(p=>!p.owner).id)");await sleep(1200);
const dana=run("sel");ok(run("S.progs.filter(p=>p.owner==='"+dana+"').length")===1,'personal program created');
const st=await (await fetch('http://localhost:3222/api/state',{headers:{cookie:''}})).status;ok(st===401,'anonymous state blocked');
// trainee device
const T=client();const rt=c=>{try{return T.eval(c)}catch(e){console.log('EXC',c.slice(0,60),e.message)}};await sleep(300);
await rt("tryLogin('dana','dana1234')");ok(rt("me().role")==='t'&&rt("myProgs(me()).length")===1,'trainee sees assigned program');
ok(rt("S.users.length")===1,'trainee sees only self');
rt("addW(250)");rt("saveWeight&&0");await sleep(1200);
const cs=await (async()=>{await run("poll()");await sleep(500);return run("U('"+dana+"').water")})();ok(cs===250,'water synced to coach view ('+cs+')');
// run a workout
rt("beginW(myProgs(me())[0].id,0)");const day=rt("myProgs(me())[0].days[0]"),e0=day.ex[0].id;
rt(`setv('${day.id}','${e0}',0,'w','60');setv('${day.id}','${e0}',0,'r','10')`);rt(`doneSet('${day.id}','${e0}',0,60)`);rt("clearInterval(tick);rest=0");rt("fin=true;setRpe(8)");rt("saveWorkout()");await sleep(1300);
ok(rt("me().log.length")===1&&rt("me().act")===null,'workout saved locally');
await run("poll()");await sleep(500);ok(run("U('"+dana+"').log.length")===1,'coach sees workout');
// coach changes goal -> trainee gets it
run("ed('users.'+S.users.findIndex(u=>u.id==='"+dana+"')+'.goal',3500);save()");await sleep(1300);await rt("poll()");await sleep(500);ok(rt("me().goal")===3500,'coach change reaches trainee');
ok(rt("me().log.length")===1,'trainee data intact after poll');
// offline resilience
const realFetch=T.fetch;T.fetch=()=>Promise.reject(new Error('offline'));rt("addW(500)");await sleep(1200);ok(rt("offline")===true,'offline flagged');
T.fetch=realFetch;await sleep(5300);ok(rt("offline")===false&&rt("me().water")>=750,'recovered & synced');
// reload page = state persists
const T2=client();await sleep(300);const r2=c=>T2.eval(c);await r2("tryLogin('dana','dana1234')");ok(r2("me().log.length")===1&&r2("me().water")>=750,'fresh device sees saved data');
await rt("out()");ok(rt("S.me")===null,'logout');
srv.close();process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
