// keh4l build: the first script of every page, before any chunk loads.
//
// A browser that holds credentials (a token, or a proxy that admitted it)
// goes from "/" straight to "/workspace". The root page used to do that from
// React — after the chunks, the language settings and a health check, one
// after another, each a round trip over a slow link. A token the server no
// longer accepts is found by the workspace's first request, which offers the
// way back to sign-in. Desktop windows and "/" with a query or a hash (links
// that the root page reads) are left to the root page as before.

export const BOOT_INIT_SCRIPT = `(function(){try{if("__TAURI_INTERNALS__"in window)return;if(location.search||location.hash)return;var p=location.pathname.replace(/\\/+$/,"")||"/";if(p!=="/")return;if(!localStorage.getItem("codeg_token")&&localStorage.getItem("codeg_proxy_auth")!=="1")return;location.replace("/workspace")}catch(e){}})()`
