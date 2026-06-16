/// <reference types="vitest/config" />
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION } from "./src/ui/brand";

// Single source for the displayed version: package.json (kept in sync with
// src-tauri/tauri.conf.json on each release). Injected via `define` below.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

// Recover from stale PWA caches after deploy: an old service worker can serve
// index.html that references hashed JS bundles that no longer exist → blank page.
const SW_RECOVERY = `<script>
(function(){var k="foxforge-sw-recover";
window.addEventListener("error",function(e){var t=e.target;
if(!t||t.tagName!=="SCRIPT"||!t.src||!t.src.includes("/assets/index-"))return;
if(!("serviceWorker"in navigator)||sessionStorage.getItem(k))return;
sessionStorage.setItem(k,"1");
navigator.serviceWorker.getRegistrations().then(function(rs){
return Promise.all(rs.map(function(r){return r.unregister()}));
}).then(function(){location.reload()});
},true);})();
</script>`;

// Inject the app name into index.html's <title> from the single brand source,
// so renaming only needs src/ui/brand.ts (no stray name in the HTML).
const htmlBranding = () => ({
  name: "html-branding",
  transformIndexHtml: (html: string) =>
    html.replaceAll("__APP_NAME__", APP_NAME).replace("</head>", `${SW_RECOVERY}</head>`),
});

// base: relative "./" by default (works in Tauri + any sub-path); the Pages
// build overrides with VITE_BASE=/FoxForge-GG/.
export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    htmlBranding(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
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
        // Do not precache index.html — after deploy, a cached shell can point at
        // removed hashed JS and leave every browser on a blank page until cache clear.
        globPatterns: ["**/*.{js,css}"],
        globIgnores: ["**/index.html"],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/assets/") && url.pathname.endsWith(".png"),
            handler: "CacheFirst",
            options: { cacheName: "unite-art", expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
        ],
      },
    }),
  ],
  // Tauri-friendly dev server.
  clearScreen: false,
  server: { host: "127.0.0.1", strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
