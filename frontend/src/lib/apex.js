// Apex Tracker is a static, browser-only distribution. Vite replaces this flag at build time,
// leaving the upstream behavior unchanged in ordinary builds.
export const APEX = import.meta.env.VITE_APEX === '1'
export const APP_NAME = APEX ? 'Apex Tracker' : 'openGym'
export const APEX_SOURCE = 'https://github.com/cfdmarketreview-hub/apex-tracker'
export const OPENGYM_SOURCE = 'https://github.com/DuarteSantos8/openGym'

export function trackWorkoutCompleted() {
  if (!APEX) return
  try { globalThis.fbq?.('trackCustom', 'WorkoutCompleted') } catch { /* analytics is optional */ }
  try { globalThis.gtag?.('event', 'workout_completed') } catch { /* analytics is optional */ }
}
