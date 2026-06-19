/// <reference types="vitest/config" />
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION } from "./src/ui/brand";

// Single source for the displayed version: package.json. Injected via `define` below.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

// GitHub Pages build (VITE_BASE=/FoxForge-GG/): no active service worker.
// Returning visitors may still have an old SW that serves a stale index.html
// pointing at removed JS bundles → blank white page. A one-shot self-destructing
// sw.js (same URL) lets legacy pages unregister + reload; new HTML never re-registers.
const isPagesDeploy = process.env.VITE_BASE === "/FoxForge-GG/";

// Runs before the module bundle — purge SW/caches and show a recovery UI if React never mounts.
const BOOT_SHELL = `<script>
(function(){
  function purge(){
    var ops=[];
    if("serviceWorker" in navigator){
      ops.push(navigator.serviceWorker.getRegistrations().then(function(rs){
        return Promise.all(rs.map(function(r){return r.unregister();}));
      }));
    }
    if(window.caches){
      ops.push(caches.keys().then(function(ks){
        return Promise.all(ks.map(function(k){return caches.delete(k);}));
      }));
    }
    return Promise.all(ops);
  }
  purge().catch(function(){});
  window.addEventListener("error",function(e){
    var t=e.target;
    if(!t||t.tagName!=="SCRIPT"||!t.src||t.src.indexOf("/assets/index-")===-1)return;
    if(sessionStorage.getItem("foxforge-sw-recover"))return;
    sessionStorage.setItem("foxforge-sw-recover","1");
    purge().then(function(){location.reload();});
  },true);
  setTimeout(function(){
    var r=document.getElementById("root");
    if(!r||r.childElementCount)return;
    r.innerHTML='<div style="font:16px/1.5 system-ui,sans-serif;padding:24px;max-width:28rem;margin:40px auto;text-align:center"><p style="font-weight:600;margin:0 0 8px">FoxForge GG didn\\'t load</p><p style="color:#5b6472;margin:0 0 16px">Try clearing cached site data from an older version.</p><button type="button" id="foxforge-recover" style="background:#4f46e5;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:15px;cursor:pointer">Clear cache &amp; reload</button></div>';
    var btn=document.getElementById("foxforge-recover");
    if(btn)btn.onclick=function(){
      try{localStorage.removeItem("unite-build-optimizer.dataCache.v1");}catch(e){}
      purge().then(function(){location.reload();});
    };
  },8000);
})();
</script>
<style>html,body{background:#eef1f5;margin:0}#root{min-height:100vh}</style>`;

const htmlBranding = () => ({
  name: "html-branding",
  transformIndexHtml: (html: string) =>
    html.replaceAll("__APP_NAME__", APP_NAME).replace("<head>", `<head>${BOOT_SHELL}`),
});

// base: relative "./" by default (works at a domain root or any sub-path); the
// Pages build overrides with VITE_BASE=/FoxForge-GG/.
export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    htmlBranding(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // New Pages HTML must not register a SW (self-destruct sw.js is only for legacy tabs).
      injectRegister: isPagesDeploy ? false : "auto",
      selfDestroying: isPagesDeploy,
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        theme_color: "#4f46e5",
        background_color: "#eef1f5",
        display: "standalone",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css}"],
        globIgnores: ["**/index.html"],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes("/assets/") && url.pathname.endsWith(".png"),
            handler: "CacheFirst",
            options: {
              cacheName: "unite-art",
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
        ],
      },
    }),
  ],
  clearScreen: false,
  server: { host: "127.0.0.1", strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
