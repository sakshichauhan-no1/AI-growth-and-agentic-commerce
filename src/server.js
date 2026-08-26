'use strict';
const express=require('express'); const {randomUUID,createHmac,timingSafeEqual}=require('node:crypto'); const {existsSync,readFileSync,writeFileSync}=require('node:fs'); const {join,resolve}=require('node:path');
const catalog=require('./mock/catalog.json'); const {createRazorpayClient}=require('./api/razorpayClient'); const {parseBuyerQuery}=require('./agent'); const {proposeAction,explain,gate,execute,readAuditLog}=require('./agent/spine');
const app=express(),PORT=Number(process.env.PORT)||3000,USERS_PATH=resolve(__dirname,'mock','users.json'),TOKEN_SECRET=process.env.AUTH_TOKEN_SECRET||'agentic-checkout-local-secret'; app.use(express.json());app.use(express.static(join(__dirname,'..','public')));
const email=v=>typeof v==='string'?v.trim().toLowerCase():''; const users=()=>{const s=existsSync(USERS_PATH)?readFileSync(USERS_PATH,'utf8').trim():'';return s?JSON.parse(s):[]}; const save=u=>writeFileSync(USERS_PATH,`${JSON.stringify(u,null,2)}\n`,'utf8'); const publicUser=u=>({id:u.id,name:u.name,email:u.email});
function tokenFor(u){const p=Buffer.from(u.id).toString('base64url'),sig=createHmac('sha256',TOKEN_SECRET).update(p).digest('base64url');return `${p}.${sig}`;} function tokenUser(req){const m=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(!m)return null;const [p,s]=m[1].split('.');if(!p||!s)return null;const expected=createHmac('sha256',TOKEN_SECRET).update(p).digest('base64url');if(s.length!==expected.length||!timingSafeEqual(Buffer.from(s),Buffer.from(expected)))return null;return users().find(u=>u.id===Buffer.from(p,'base64url').toString())||null;}
app.post('/api/auth/signup',(req,res)=>{const name=typeof req.body?.name==='string'?req.body.name.trim():'',e=email(req.body?.email),password=req.body?.password;if(!name||!e.includes('@')||typeof password!=='string'||password.length<8)return res.status(400).json({error:'Name, valid email, and password (8+ characters) are required.'});const list=users();if(list.some(u=>u.email===e))return res.status(409).json({error:'An account already exists for this email.'});const user={id:randomUUID(),name,email:e,password};list.push(user);save(list);return res.status(201).json({success:true,token:tokenFor(user),user:publicUser(user)});});
app.post('/api/auth/login',(req,res)=>{const user=users().find(u=>u.email===email(req.body?.email)&&u.password===req.body?.password);if(!user)return res.status(401).json({error:'Invalid email or password.'});return res.json({success:true,token:tokenFor(user),user:publicUser(user)});}); app.get('/api/auth/me',(req,res)=>{const user=tokenUser(req);return user?res.json({user:publicUser(user)}):res.status(401).json({error:'Invalid or expired session.'});});
app.post('/api/agent/chat',async(req,res)=>{
  try{
    const user=tokenUser(req);if(!user)return res.status(401).json({error:'Please sign in before using checkout.'});
    const spine={propose:{status:'pending'},explain:{status:'pending'},gate:{status:'pending'},execute:{status:'pending'},audit:{status:'pending'}};
    let agentResponse='',success=false,request,proposed,explained,gated,audit;
    try{request=parseBuyerQuery(req.body?.query,catalog);}catch(e){spine.propose={status:'failed',error:e.message};return res.json({success:false,agentResponse:e.message,spine,auditLog:readAuditLog().filter(x=>x.userId===user.id)});}
    try{
      proposed=proposeAction({...request,customerId:user.email,userId:user.id,userName:user.name,userEmail:user.email},catalog);spine.propose={status:'success'};
      explained=explain(proposed);spine.explain={status:'success'};
      gated=gate(explained,{merchantOptIn:true});spine.gate={status:gated.gate.approved?'success':'failed',reasons:gated.gate.reasons};
      if(!gated.gate.approved){spine.execute={status:'skipped'};spine.audit={status:'skipped'};agentResponse=`Gate rejected: ${gated.gate.reasons.join(' ')}`;}
      else{
        try{audit=await execute(gated,{client:createRazorpayClient()});spine.execute={status:'success'};spine.audit={status:'success'};agentResponse=`Successfully processed order.`;success=true;}
        catch(e){spine.execute={status:'failed',error:e.message};spine.audit={status:'failed'};agentResponse=`Execution failed: ${e.message}`;}
      }
    }catch(e){agentResponse=`Error: ${e.message}`;}
    return res.json({success,agentResponse,spine,auditLog:readAuditLog().filter(x=>x.userId===user.id)});
  }catch(e){return res.status(400).json({error:e.message});}
});
app.get('/api/audit',(req,res)=>{const user=tokenUser(req);if(!user)return res.status(401).json({error:'Please sign in to view audit history.'});return res.json(readAuditLog().filter(x=>x.userId===user.id));}); app.use((_q,res)=>res.sendFile(join(__dirname,'..','public','index.html'))); if(require.main===module)app.listen(PORT,()=>console.log(`Agentic Commerce UI listening on http://localhost:${PORT}`)); module.exports={app,users,tokenFor};
