// keh4l build: the first script of every page, before any chunk loads.
//
// A browser that holds credentials (a token, or a proxy that admitted it)
// goes from "/" straight to "/workspace". The root page used to do that from
// React — after the chunks, the language settings and a health check, one
// after another, each a round trip over a slow link. A token the server no
// longer accepts is found by the workspace's first request, which offers the
// way back to sign-in. Desktop windows and "/" with a query or a hash (links
// that the root page reads) are left to the root page as before.
//
// On "/workspace" it asks for the workspace's first reads at once, as one
// batch, while the page's scripts load (`boot-prefetch.ts`).

import { BOOT_PREFETCH_CALLS } from "./boot-prefetch"

const CALLS = JSON.stringify(BOOT_PREFETCH_CALLS)

export const BOOT_INIT_SCRIPT = `(function(){try{if("__TAURI_INTERNALS__"in window)return;var t=localStorage.getItem("codeg_token");if(!t&&localStorage.getItem("codeg_proxy_auth")!=="1")return;var p=location.pathname.replace(/\\/+$/,"")||"/";if(p==="/"){if(location.search||location.hash)return;location.replace("/workspace");return}if(p!=="/workspace"&&p!=="/workspace.html")return;var c=${CALLS};var h={"Content-Type":"application/json","X-Requested-With":"XMLHttpRequest"};if(t)h.Authorization="Bearer "+t;window.__CODEG_BOOT__={at:Date.now(),calls:c,batch:fetch("/api/batch",{method:"POST",headers:h,body:JSON.stringify({calls:c})}).then(function(r){return r.ok?r.json():null}).then(function(j){return j&&Array.isArray(j.results)&&j.results.length===c.length?j.results:null},function(){return null})}}catch(e){}})()`
