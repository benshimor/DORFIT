// node scripts/reset-coach.js "new-password"
const crypto=require('crypto'),path=require('path'),Database=require('better-sqlite3');
const pw=process.argv[2];if(!pw||pw.length<6){console.error('need a password (6+ chars)');process.exit(1)}
const db=new Database(process.env.DB_PATH||path.join(__dirname,'data','app.db'));
const s=crypto.randomBytes(16).toString('hex');
const r=db.prepare("update users set pass=? where role='coach'").run(s+':'+crypto.scryptSync(pw,s,64).toString('hex'));
db.prepare("delete from sessions where user_id in (select id from users where role='coach')").run();
console.log(r.changes?'password updated':'no coach found');
