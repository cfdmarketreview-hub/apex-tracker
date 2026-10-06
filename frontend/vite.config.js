import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
// The API refuses a state-changing request that a browser sent from anywhere other than its own
// ORIGIN (the CSRF guard in api/server.js). The dev server is on a different port, so the page's
// real Origin is not ORIGIN — modern browsers get through on Sec-Fetch-Site: same-origin, and
// presenting the expected Origin here covers the ones that don't send it. Match your .env if you
// changed ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:8080'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

// Optional web analytics (Umami). Injected only when BOTH vars are set at build time,
// so a plain `npm run build` — and every self-hosted install — stays telemetry-free.
// Set for the public instance: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'opengym-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

// The service worker's cache is named after the build (public/sw.js carries a `__BUILD__`
// placeholder): a deploy is then a new worker with its own cache, and the previous build's
// shell and chunks are dropped on activate instead of piling up under one fixed name. The
// stamp is a hash of the built index.html — it changes exactly when the bundle does.
const swStamp = {
  name: 'opengym-sw-stamp',
  apply: 'build',
  closeBundle() {
    const dir = new URL('./dist/', import.meta.url)
    const html = new URL('index.html', dir), sw = new URL('sw.js', dir)
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', stamp))
  }
}

// The version people are asked for in #install-help and on every bug report. Read from
// package.json so it cannot drift from the release it was built in, and inlined at build
// time so no runtime fetch is involved.
//
// APP_BUILD, when the build sets it, is appended as "1.3.8+<build>". A packaged build carries a
// version its package.json cannot know — every image built between two releases reports the same
// number, so the one question a bug report turns on, "which build were you running?", had no
// answer from inside the app. Unset (the ordinary case, and every upstream build) it changes
// nothing: the string is exactly package.json's version.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appVersion = process.env.APP_BUILD ? `${pkgVersion}+${process.env.APP_BUILD}` : pkgVersion

function apexBuild(apex) {
  return {
    name: 'apex-static-brand',
    apply: 'build',
    transformIndexHtml(html) {
      if (!apex) return html
      const branded = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace('<html lang="en">', '<html lang="en" data-apex="true" data-theme="dark">')
        .replace('<title>openGym</title>', '<title>Apex Tracker</title>')
        .replace('content="Personal gym & body weight tracker"', 'content="Apex Tracker — free workout tracking in your browser"')
        .replace('content="#0c0e12"', 'content="#080808"')
        .replace('content="openGym"', 'content="Apex Tracker"')
      return {
        html: branded,
        tags: [
          { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' }, injectTo: 'head' },
          { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }, injectTo: 'head' },
          { tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' }, injectTo: 'head' },
          { tag: 'script', attrs: { async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-2TD5Q7BKQW' }, injectTo: 'head' },
          { tag: 'script', children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','G-2TD5Q7BKQW',{send_page_view:false});function apexGaPage(){gtag('event','page_view',{page_path:location.hash||'#/home'})}apexGaPage();addEventListener('hashchange',apexGaPage);`, injectTo: 'head' },
          { tag: 'script', children: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','1311748940662432');function apexFbPage(){fbq('track','PageView')}apexFbPage();addEventListener('hashchange',apexFbPage);`, injectTo: 'head' },
          { tag: 'script', attrs: { defer: true, src: '/_vercel/insights/script.js' }, injectTo: 'head' },
        ],
      }
    },
    closeBundle() {
      if (!apex) return
      const dist = new URL('./dist/', import.meta.url)
      writeFileSync(new URL('manifest.json', dist), JSON.stringify({
        name: 'Apex Tracker',
        short_name: 'Apex Tracker',
        description: 'Free workout tracker from Apex Life Fitness',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#080808',
        theme_color: '#080808',
        icons: [
          { src: 'icon-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      }, null, 2) + '\n')
      copyFileSync(new URL('./public/icon-apex-180.png', import.meta.url), new URL('icon-180.png', dist))
      copyFileSync(new URL('./public/icon-apex-512.png', import.meta.url), new URL('icon-512.png', dist))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apex = env.VITE_APEX === '1'
  return {
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    plugins: [react(), umami, apexBuild(apex), swStamp],
    base: './',
    server: {
    // The Coach's core (payload, validator, prompts, HTTP adapters) lives in ../api/coach/core
    // and is imported by the phone build. vite build and vitest already reach it; the dev
    // server needs to be told the workspace is wider than frontend/.
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
    },
    build: { chunkSizeWarningLimit: 1500 }
  }
})
