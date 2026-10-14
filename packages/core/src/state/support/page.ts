import { supportStrings } from "./strings.js";

export const supportPage = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PenguinHarness Support</title><link rel="stylesheet" href="/workbench-ui.css">
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;color:var(--wb-fg);background:var(--wb-bg);font-family:var(--font-app-sans,system-ui)}
header{display:flex;align-items:start;justify-content:space-between;gap:20px;margin-bottom:24px}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 16px}p{margin:8px 0}a{color:var(--wb-accent)}.muted,small{color:var(--wb-muted)}
header nav{display:flex;flex-wrap:wrap;align-items:center;gap:14px}button{white-space:nowrap;cursor:pointer}button:disabled{cursor:wait}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;max-width:100%}textarea{resize:vertical;min-height:120px}label{display:block;margin-bottom:16px}label span{display:block;margin-bottom:6px}
.layout{display:grid;grid-template-columns:minmax(220px,30%) minmax(0,1fr);gap:28px}aside{border-right:1px solid var(--wb-border);padding-right:24px}#list{list-style:none;padding:0;margin:16px 0}#list button{display:block;white-space:normal;text-align:left;width:100%;padding:12px 8px;border:0;border-bottom:1px solid var(--wb-border);background:transparent}#list button[aria-current=true]{border-left:3px solid var(--wb-accent);background:var(--wb-surface)}#list strong{display:block;overflow-wrap:anywhere}#list small{display:block;margin-top:5px}.filters{display:flex;gap:8px;margin-top:8px}.filters select{min-width:0}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}main{min-width:0}.answer{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;border-top:1px solid var(--wb-border);padding:18px 0}.answer h3{font-size:13px;color:var(--wb-muted);margin:0 0 8px}#sources{border-top:1px solid var(--wb-border);padding-top:12px}#sources a{display:block;overflow-wrap:anywhere;margin:8px 0}#error{white-space:pre-wrap}#status{margin:12px 0}#back{display:none}[hidden]{display:none!important}
@media(max-width:700px){body{padding:16px}header{display:block}header nav{margin-top:16px}.layout{grid-template-columns:1fr}aside{border:0;padding:0}body.detail aside{display:none}body.detail #back{display:inline-block;margin-bottom:16px}body:not(.detail) main{display:none}}
</style></head><body>
<header><div><h1 data-copy="title"></h1><p class="muted" data-copy="intro"></p></div><nav><a href="https://penguin.ooo/docs/" target="_blank" rel="noreferrer" data-copy="docs"></a><a href="https://github.com/Prism-Shadow/penguin-harness" target="_blank" rel="noreferrer" data-copy="code"></a><select id="locale" aria-label="Language"><option value="en">English</option><option value="zh">中文</option></select></nav></header>
<div class="layout"><aside><button id="new" class="wb-primary" data-copy="newTicket"></button><label><span data-copy="search"></span><input id="search" type="search"></label><div class="filters"><select id="filter" aria-label="Status"><option value="all" data-copy="all"></option><option value="running" data-copy="running"></option><option value="answered" data-copy="answered"></option><option value="resolved" data-copy="resolved"></option><option value="failed" data-copy="failed"></option></select></div><ul id="list"></ul></aside>
<main><button id="back" data-copy="back"></button><div id="error" role="alert" hidden></div><p id="empty" class="muted" data-copy="choose"></p>
<form id="create" hidden><h2 data-copy="newTicket"></h2><label><span data-copy="subject"></span><input name="title" maxlength="160" required></label><label><span data-copy="category"></span><select name="category"><option value="setup" data-copy="setup"></option><option value="models" data-copy="models"></option><option value="plugins" data-copy="plugins"></option><option value="workbench" data-copy="workbench"></option><option value="troubleshooting" data-copy="troubleshooting"></option><option value="general" data-copy="general"></option></select></label><label><span data-copy="question"></span><textarea name="text" maxlength="20000" required></textarea></label><button class="wb-primary" data-copy="submit"></button></form>
<section id="ticket" hidden><h2 id="subject"></h2><p id="status" role="status"></p><div id="messages"></div><div id="sources" hidden><h3 data-copy="sources"></h3><div id="source-links"></div></div><div class="actions"><button id="resolve" type="button"></button><button id="retry" type="button" data-copy="retry" hidden></button></div><form id="followup"><label><span data-copy="followup"></span><textarea name="text" maxlength="20000" required></textarea></label><button class="wb-primary" data-copy="send"></button></form></section></main></div>
<script>
const dictionaries = ${JSON.stringify(supportStrings)};
let preferred;try{preferred=localStorage.getItem('penguin.support.lang')||localStorage.getItem('penguin.lang');}catch{}
let language = preferred==='zh'||preferred==='en'?preferred:(navigator.language.startsWith('zh')?'zh':'en');
let copy = dictionaries[language], tickets = [], selected = null, busy = false, rendered = '';
const $ = id => document.getElementById(id);
function translate(){copy=dictionaries[language];document.documentElement.lang=language;document.title=copy.title;document.querySelectorAll('[data-copy]').forEach(el=>el.textContent=copy[el.dataset.copy]);$('locale').value=language;$('search').setAttribute('aria-label',copy.search);$('filter').setAttribute('aria-label',copy.status);$('locale').setAttribute('aria-label',copy.language);rendered='';render();}
async function api(route, body){const response=await fetch('../api'+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||copy.error);return data;}
function report(error){$('error').textContent=error.message||copy.error;$('error').hidden=false;}
function show(id){selected=id;rendered='';$('create').hidden=true;$('empty').hidden=!!id;$('ticket').hidden=!id;document.body.classList.toggle('detail',!!id);render();}
function linksIn(text){
 const links=[];const pattern=/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>"\x60]+)/g;
 for(const match of text.matchAll(pattern)){const url=(match[2]||match[3]).replace(/[.,;:!?，。；！？）)]+$/,'');links.push({index:match.index,length:match[0].length,url,label:match[1]||url});}return links;
}
function inline(parent,text){
 let at=0;const pattern=/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>"\x60]+)|\x60([^\x60]+)\x60|\*\*([^*]+)\*\*/g;
 for(const m of text.matchAll(pattern)){parent.append(document.createTextNode(text.slice(at,m.index)));let el;if(m[2]||m[3]){el=document.createElement('a');el.href=(m[2]||m[3]).replace(/[.,;:!?，。；！？）)]+$/,'');el.textContent=m[1]||el.href;el.target='_blank';el.rel='noreferrer';}else{el=document.createElement(m[4]?'code':'strong');el.textContent=m[4]||m[5];}parent.append(el);at=m.index+m[0].length;}parent.append(document.createTextNode(text.slice(at)));
}
function answerNode(text){
 const box=document.createElement('div');let list=null,code=null;
 for(const line of text.split('\n')){
  if(/^\x60{3}/.test(line)){if(code)code=null;else{const pre=document.createElement('pre');code=document.createElement('code');pre.append(code);box.append(pre);}list=null;continue;}
  if(code){code.textContent+=line+'\n';continue;}
  if(!line.trim()){list=null;continue;}
  const heading=/^(#{1,4})\s+(.+)$/.exec(line),bullet=/^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
  if(bullet){const tag=bullet[1]?'ul':'ol';if(!list||list.tagName.toLowerCase()!==tag){list=document.createElement(tag);box.append(list);}const li=document.createElement('li');if(!bullet[1])li.value=Number(/^\s*(\d+)/.exec(line)[1]);inline(li,bullet[2]);list.append(li);}
  else{list=null;const el=document.createElement(heading?'h'+Math.min(heading[1].length+2,6):'p');inline(el,heading?heading[2]:line);box.append(el);}
 }return box;
}
function render(){
 const query=$('search').value.toLowerCase(), filter=$('filter').value;
 const visible=tickets.filter(t=>(filter==='all'||t.status===filter)&&(t.title+' '+t.messages.map(m=>m.text).join(' ')).toLowerCase().includes(query));
 $('list').replaceChildren();
 if(!visible.length){const li=document.createElement('li');li.textContent=copy.empty;li.className='muted';$('list').append(li);}
 for(const t of visible){const li=document.createElement('li'),b=document.createElement('button'),title=document.createElement('strong'),meta=document.createElement('small');title.textContent=t.title;meta.textContent=(copy[t.status]||t.status)+' · '+new Date(t.updatedAt).toLocaleString();b.setAttribute('aria-current',String(t.id===selected));b.append(title,meta);b.onclick=()=>show(t.id);li.append(b);$('list').append(li);}
 const ticket=tickets.find(t=>t.id===selected);if(!ticket)return;
 const signature=ticket.id+ticket.updatedAt+ticket.status+language;if(signature===rendered)return;rendered=signature;
 $('subject').textContent=ticket.title;$('status').textContent=ticket.status==='running'?copy.working:(copy[ticket.status]||ticket.status);$('messages').replaceChildren();
 const urls=new Map();
 for(const m of ticket.messages){const article=document.createElement('article');article.className='answer';const h=document.createElement('h3');h.textContent=(m.role==='user'?copy.question:copy.title)+' · '+new Date(m.at).toLocaleString();article.append(h,answerNode(m.text));$('messages').append(article);if(m.role==='assistant')for(const link of linksIn(m.text))urls.set(link.url,link.label);}
 $('source-links').replaceChildren();for(const [url,label]of urls){const a=document.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noreferrer';$('source-links').append(a);}$('sources').hidden=!urls.size;
 $('resolve').textContent=ticket.status==='resolved'?copy.reopen:copy.resolve;$('resolve').disabled=ticket.status==='running'||busy;$('retry').hidden=ticket.status!=='failed';$('retry').disabled=busy;
 $('followup').hidden=ticket.status==='resolved';$('followup').querySelectorAll('textarea,button').forEach(el=>el.disabled=ticket.status==='running'||busy);
 if(ticket.error)report(new Error(ticket.error));else $('error').hidden=true;
}
async function refresh(){try{tickets=(await api('/tickets')).tickets;render();}catch(error){report(error);}}
async function mutate(fn){if(busy)return;let failure=null;busy=true;document.querySelectorAll('form button').forEach(b=>b.disabled=true);$('error').hidden=true;try{await fn();await refresh();}catch(error){failure=error;}finally{busy=false;rendered='';document.querySelectorAll('form button').forEach(b=>b.disabled=false);render();if(failure)report(failure);}}
$('create').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;mutate(async()=>{const ticket=await api('/tickets',Object.fromEntries(new FormData(form)));tickets.unshift(ticket);form.reset();show(ticket.id);});};
$('followup').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;mutate(async()=>{await api('/tickets/'+selected,Object.fromEntries(new FormData(form)));form.reset();});};
$('resolve').onclick=()=>mutate(()=>api('/tickets/'+selected,{action:tickets.find(t=>t.id===selected).status==='resolved'?'reopen':'resolve'}));
$('retry').onclick=()=>mutate(()=>api('/tickets/'+selected,{action:'retry'}));
$('new').onclick=()=>{selected=null;$('create').hidden=false;$('ticket').hidden=true;$('empty').hidden=true;$('error').hidden=true;document.body.classList.add('detail');$('create').elements.title.focus();render();};
$('back').onclick=()=>document.body.classList.remove('detail');$('search').oninput=render;$('filter').onchange=render;$('locale').onchange=()=>{language=$('locale').value;try{localStorage.setItem('penguin.support.lang',language);}catch{}translate();};
translate();refresh();let refreshing=false;setInterval(async()=>{if(document.hidden||refreshing||busy)return;refreshing=true;try{await refresh();}finally{refreshing=false;}},2500);
</script></body></html>`;
