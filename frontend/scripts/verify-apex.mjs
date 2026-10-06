import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

const root = resolve('dist')
const host = '127.0.0.1'
const port = 4173
const debugPort = 9336
const origin = `http://${host}:${port}`
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin)
    let path = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!path.startsWith(root)) throw new Error('outside root')
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
  }
  async ready() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      if (msg.id) {
        const waiter = this.pending.get(msg.id)
        if (!waiter) return
        this.pending.delete(msg.id)
        if (msg.error) waiter.reject(new Error(msg.error.message))
        else waiter.resolve(msg.result)
        return
      }
      for (const listener of this.listeners.get(msg.method) || []) listener(msg.params)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, listener) {
    const list = this.listeners.get(method) || []
    list.push(listener)
    this.listeners.set(method, list)
  }
  close() { this.ws.close() }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(fn, timeout = 8000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await fn()
    if (value) return value
    await sleep(100)
  }
  throw new Error('wait timed out')
}

async function main() {
  await new Promise(resolve => server.listen(port, host, resolve))
  const profile = mkdtempSync(join(tmpdir(), 'apex-cdp-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-default-apps', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' })
  process.stderr.write('chrome launched\n')
  let cdp
  try {
    const pages = await waitFor(async () => {
      try { return await (await fetch(`http://${host}:${debugPort}/json/list`, { signal: AbortSignal.timeout(500) })).json() } catch { return null }
    })
    cdp = new CDP(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
    await cdp.ready()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    const requests = []
    const consoleErrors = []
    cdp.on('Network.requestWillBeSent', e => requests.push({ url: e.request.url, method: e.request.method, type: e.type }))
    cdp.on('Runtime.consoleAPICalled', e => {
      if (e.type === 'error') consoleErrors.push(e.args.map(a => a.value || a.description || '').join(' '))
    })
    const evaluate = async expression => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
    const waitText = text => waitFor(() => evaluate(`document.body?.innerText.includes(${JSON.stringify(text)})`))
    const clickText = async text => {
      const clicked = await evaluate(`(() => { const t=${JSON.stringify(text)}; const e=[...document.querySelectorAll('button,[role="button"]')].filter(x => x.offsetParent!==null&&x.textContent.trim().includes(t)).at(-1); if(!e)return false;e.click();return true })()`)
      if (!clicked) throw new Error(`button not found: ${text}`)
    }
    const escape = async () => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(250)
    }
    const overflow = () => evaluate(`(() => { const w=document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const s=getComputedStyle(e),r=e.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&(r.right>w+.5) }).map(e => { const r=e.getBoundingClientRect(); return {tag:e.tagName.toLowerCase(),class:e.className?.baseVal||e.className||'',text:(e.textContent||'').trim().slice(0,80),right:+r.right.toFixed(1),clientWidth:w} }).slice(0,20) })()`)
    const phase = (from, to = requests.length) => [...new Map(requests.slice(from, to).map(r => [`${r.method} ${r.url}`, r])).values()]

    const results = []
    const cases = [
      { width: 320, fontSize: 24 }, { width: 390, fontSize: 20 },
      { width: 768, fontSize: 24 }, { width: 1280, fontSize: 20 },
      { width: 1440, fontSize: 24 },
    ]
    for (const testCase of cases) {
      process.stderr.write(`verify ${testCase.width}px / ${testCase.fontSize}px\n`)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: testCase.width, height: 900, deviceScaleFactor: 1, mobile: testCase.width < 768 })
      await cdp.send('Page.navigate', { url: 'about:blank' })
      await waitFor(() => evaluate(`location.href === 'about:blank'`))
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
      let mark = requests.length
      await cdp.send('Page.navigate', { url: `${origin}/#/home` })
      await waitText('Apex Tracker')
      process.stderr.write('  home\n')
      await evaluate(`document.documentElement.style.fontSize='${testCase.fontSize}px'`)
      await sleep(1200)
      const loadEnd = requests.length
      const loadOverflow = await overflow()
      const route = await evaluate('location.hash')
      const loginVisible = await evaluate(`/Sign in with passkey|Continue without account|Create passkey profile/.test(document.body.innerText)`)

      await evaluate(`location.hash='#/settings'`)
      await waitText('Settings')
      const settings = await evaluate(`(() => { const text=document.body.innerText; return {
        attribution: text.includes('Apex Tracker is a modified version of openGym by Duarte Santos, licensed under AGPL-3.0.'),
        source: text.includes('https://github.com/cfdmarketreview-hub/apex-tracker'),
        forbidden: ['Sign in','Pair the mobile app','AI Coach','Notifications','Import from Hevy','Admin dashboard'].filter(x=>text.includes(x))
      } })()`)

      await evaluate(`location.hash='#/library'`)
      await waitText('Exercises')
      const detailStart = requests.length
      const opened = await evaluate(`(() => { const e=document.querySelector('.list .item:nth-child(2)'); if(!e)return false;e.click();return true })()`)
      if (!opened) throw new Error('exercise row not found')
      await waitText('How to')
      process.stderr.write('  exercise detail\n')
      await sleep(300)
      const detailEnd = requests.length
      const detailOverflow = await overflow()
      const builtinImages = await evaluate(`[...document.querySelectorAll('.sheet img,.sheet video')].map(e=>e.currentSrc||e.src)`)
      await escape()

      const workoutStart = requests.length
      await evaluate(`window.__apexEvents=[];const oldFbq=window.fbq;window.fbq=(...a)=>{window.__apexEvents.push(['fbq',...a]);return oldFbq?.(...a)};const oldGtag=window.gtag;window.gtag=(...a)=>{window.__apexEvents.push(['gtag',...a]);return oldGtag?.(...a)}`)
      await evaluate(`location.hash='#/workout'`)
      await waitText('Freestyle workout')
      await clickText('Freestyle workout')
      await waitText('Start without weighing in')
      await clickText('Start without weighing in')
      await waitText('Add exercise')
      await clickText('Add exercise')
      await waitText('Create your own exercise')
      const added = await evaluate(`(() => { const e=document.querySelector('.sheet button[aria-label^="Add"]'); if(!e)return false;e.click();return true })()`)
      if (!added) throw new Error('quick-add exercise button not found')
      await escape()
      await waitFor(() => evaluate(`document.querySelectorAll('[role="checkbox"]').length>0`))
      await evaluate(`document.querySelector('[role="checkbox"]').click()`)
      await sleep(250)
      await escape()
      await clickText('Finish workout')
      const finishState = await waitFor(() => evaluate(`document.body.innerText.includes('Finish early?')?'early':document.body.innerText.includes('Workout complete!')?'complete':''`))
      if (finishState === 'early') await clickText('Finish workout')
      await waitText('Workout complete!')
      process.stderr.write('  workout complete\n')
      await sleep(800)
      const workoutEnd = requests.length
      const workoutOverflow = await overflow()
      const historyCount = await evaluate(`JSON.parse(localStorage.getItem('gym_state_v1')).workouts.length`)
      const analyticsEvents = await evaluate(`window.__apexEvents.filter(e=>(e[0]==='fbq'&&e[1]==='trackCustom'&&e[2]==='WorkoutCompleted')||(e[0]==='gtag'&&e[1]==='event'&&e[2]==='workout_completed'))`)
      const forbiddenRequests = phase(mark, workoutEnd).filter(r => /\/api(?:\/|$)|\/(?:img|gif)\/|jsdelivr|exercisedb|exercises?-dataset/i.test(r.url))

      results.push({
        ...testCase, route, loginVisible, historyCount, settings, analyticsEvents, forbiddenRequests,
        overflow: { load: loadOverflow, exerciseDetail: detailOverflow, workoutComplete: workoutOverflow },
        requests: { load: phase(mark, loadEnd), exerciseDetail: phase(detailStart, detailEnd), workout: phase(workoutStart, workoutEnd) },
        builtinImages,
      })
    }
    process.stdout.write(JSON.stringify({ results, consoleErrors }, null, 2) + '\n')
  } finally {
    try { cdp?.close() } catch {}
    chrome.kill()
    server.close()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
