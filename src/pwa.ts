// Keeps the installed app up to date. The service worker serves the app from
// its cache, so a new release reaches the screen only after (1) the browser
// has noticed and downloaded it, (2) the downloaded version has been told to
// take over, and (3) the page has been reloaded onto it. An installed app
// that is merely sent to the background and brought back does none of that
// by itself — it could sit on an old version for days. So this module looks
// for a new version whenever the app comes to the front, reports when one is
// downloaded and waiting, and switches to it on request.

const BASE = import.meta.env.BASE_URL

let started = false
let registration: ServiceWorkerRegistration | undefined
let announceWaiting: (() => void) | undefined

/** `onUpdateReady` runs when a newer version is downloaded and waiting.
 * Nothing changes on screen until applyAppUpdate() is called. */
export function registerServiceWorker(onUpdateReady: () => void): void {
  if (started || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  started = true

  // Fires once the waiting version has taken over (applyAppUpdate): load the
  // page it serves. The very first install also "takes control" — that is
  // not an update, and there is nothing newer to reload onto.
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload()
  })

  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE })
      registration = reg
      announceWaiting = () => {
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady()
      }
      announceWaiting() // one may be waiting already, downloaded on an earlier visit
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') announceWaiting?.()
        })
      })

      const check = () => reg.update().catch(() => {}) // offline: try again next time
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, 60 * 60 * 1000)
    } catch {
      // No service worker (private window, unsupported browser): the app still works online.
    }
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)
}

/** Switches to the downloaded version; the page then reloads onto it. */
export function applyAppUpdate(): void {
  const waiting = registration?.waiting
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
  else window.location.reload()
}

export type UpdateCheck = 'downloading' | 'ready' | 'latest' | 'offline' | 'unsupported'

/** Asks the server for a newer version right now. One that is found
 * downloads by itself and is then announced through onUpdateReady. */
export async function checkForAppUpdate(): Promise<UpdateCheck> {
  if (!registration) return 'unsupported'
  try {
    await registration.update()
  } catch {
    return 'offline'
  }
  if (registration.installing) return 'downloading'
  if (registration.waiting) {
    announceWaiting?.()
    return 'ready'
  }
  return 'latest'
}
