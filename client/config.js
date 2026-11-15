// Where the multiplayer server lives.
//
//  ""  (empty)  -> same address this page was served from. This is correct when
//                  the Node server serves the client too (the default setup).
//
//  If you host this "client" folder on a static host (Netlify, Vercel, GitHub
//  Pages, Cloudflare Pages) and the Node server somewhere else, put the server's
//  public HTTPS address here, e.g.:
//
//      window.LAST_BELL_SERVER = "https://the-last-bell.onrender.com";
//
// You can also override it per-visit with  ?server=https://...  in the URL.
window.LAST_BELL_SERVER = "";
