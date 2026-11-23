/** Files and workbench state for the installed pages in the homepage demo. Lives with its frame. */
import sample from "../../../../../plugins/use-bento-slides/workbenches/slides/ui/sample.bento.json";
import type { DemoStore } from "./store";

interface Deck { id: string; title: string; text: string; rev: number; mtimeMs: number }
const exampleDeck = (): Deck => ({id:"introduction",title:sample.title,text:JSON.stringify(sample),rev:1,mtimeMs:Date.UTC(2026,9,28)});
function samples(lang: string) {
  const zh = lang === "zh";
  const deck = exampleDeck();
  const date = "2026-10-28T12:00:00Z";
  const title = zh ? "在哪里可以找到之前的对话？" : "Where can I find an earlier conversation?";
  return {
    decks: new Map([[deck.id,deck]]),
    job:{id:"penguin",sessionId:"image-example",prompt:zh?"企鹅应用图标":"Penguin app icon",ratio:"1:1"},
    ticket:{id:"session-history",title,status:"resolved",updatedAt:date,createdAt:date,messages:[
      {role:"user",text:title,at:date},{role:"assistant",text:zh?"在侧栏选择工作区，再点对话名称即可继续。":"Select its workspace in the sidebar, then choose the conversation to continue.",at:date},
    ]},
  };
}
const stores = new WeakMap<DemoStore,Map<string,ReturnType<typeof samples>>>();
const unavailable = () => Response.json({error:{code:"gallery_read_only",message:"This preview has no connected model."}},{status:409});

export function workbenchAnswer(store:DemoStore,path:string,method:string,body:unknown):Response | undefined {
  if(!store.signedIn) return;
  const url = new URL(path,"http://gallery.invalid");
  const match = /^(?:\/server\/([^/]+))?\/api\/projects\/demo\/(.+)$/.exec(url.pathname);
  if(!match) return;
  const machine = match[1] ?? "";
  const route = match[2]!;
  const mount=/^agents\/(default_agent\/workbenches\/(slides|images)|penguin_support\/workbenches\/(support))\/api(\/.*)$/.exec(route);
  const imageFiles="multimodal-tools/sessions/image-example/";
  if(!mount && !route.startsWith(imageFiles)) return;
  const scoped=stores.get(store) ?? new Map<string,ReturnType<typeof samples>>();
  stores.set(store,scoped);
  const state=scoped.get(machine) ?? samples(store.lang);
  scoped.set(machine,state);
  if(!mount) {
    if(route===imageFiles+"runs") return Response.json({runs:[{operation:"t2i",status:"completed"}]});
    if(route===imageFiles+"files") return Response.json({files:[{name:"penguin.png",mimeType:"image/png",operation:"t2i"}]});
    return;
  }
  const [app,action]=[mount[2] ?? mount[3],mount[4]];
  if(app==="images") {
    if(method==="GET" && action==="/jobs") return Response.json({jobs:[state.job]});
    if(method==="GET" && action==="/jobs/penguin") return Response.json({job:state.job,session:{status:"idle"}});
  }
  if(app==="support") {
    if(method==="GET" && action==="/tickets") return Response.json({tickets:[state.ticket]});
    if(method==="POST" && action==="/tickets/"+state.ticket.id && body && typeof body==="object" && "action" in body && (body.action==="resolve" || body.action==="reopen")) {
      state.ticket.status=body.action==="resolve"?"resolved":"open";
      return Response.json({ticket:state.ticket});
    }
  }
  if(app==="slides") {
    if(method==="GET" && action==="/info") return Response.json({supported:true});
    if(method==="GET" && action==="/ask") return Response.json({sessionId:null,status:null,messages:[]});
    const decks=state.decks;
    if(method==="GET" && action==="/decks") return Response.json({decks:[...decks.values()].map(({id,title,mtimeMs})=>({id,title,mtimeMs}))});
    if(action?.startsWith("/decks/") || (method==="POST" && action==="/decks")) {
      const current = decks.get(decodeURIComponent(action.slice(7)));
      if(method==="GET") return current ? Response.json(current) : Response.json({error:"Unknown deck"},{status:404});
      if(method==="DELETE" && current) {decks.delete(current.id);return new Response(null,{status:204})}
      if((method==="PUT" && current || method==="POST") && body && typeof body==="object" && "text" in body && typeof body.text==="string") {
        if(current && "base" in body && body.base!==current.rev) return Response.json(current,{status:409});
        const title=String((JSON.parse(body.text) as {title?:string}).title ?? "");
        const id = current?.id ?? crypto.randomUUID();
        const saved={id,title,text:body.text,mtimeMs:Date.now(),rev:(current?.rev ?? 0)+1};
        decks.set(id,saved);
        return Response.json(saved);
      }
    }
  }
  return unavailable();
}
