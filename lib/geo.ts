// Phone GPS helpers (attendance, site visits)

export type Fix = { latitude: number; longitude: number; accuracy: number }

/** How to allow location, for the phone in hand */
export function blockedHelp() {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) {
    if (/CriOS/i.test(ua)) return 'Location is blocked for Chrome. On the iPhone open Settings → Privacy & Security → Location Services (On) → Chrome → "While Using the App". Then come back, reload this page and allow Location.'
    return 'Location is blocked for Safari. On the iPhone open Settings → Privacy & Security → Location Services (On) → Safari Websites → "While Using the App". Then in Safari tap "aA" (or ☰) next to the address → Website Settings → Location → Allow, reload the page and try again.'
  }
  return 'Location permission is blocked. Tap the 🔒 lock icon next to the web address → Permissions / Site settings → Location → Allow, then reload the page. Also check the phone’s Location (GPS) is On.'
}

/** Watches GPS for up to 12 s and keeps the most accurate reading (indoor readings improve over a few seconds). */
export function getBestFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot share its location. Please use Chrome on your phone.')); return }
    let best: Fix | null = null
    let done = false
    let watch = 0
    const finish = () => {
      if (done) return
      done = true
      navigator.geolocation.clearWatch(watch)
      if (best) resolve(best)
      else reject(new Error('Could not get your location. Turn on Location (GPS) on the phone and try again.'))
    }
    watch = navigator.geolocation.watchPosition(
      pos => {
        const f = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }
        if (!best || f.accuracy < best.accuracy) best = f
        if (f.accuracy <= 25) finish()
      },
      err => {
        if (done) return
        if (err.code !== 1 && best) { finish(); return }
        done = true
        navigator.geolocation.clearWatch(watch)
        reject(new Error(err.code === 1 ? blockedHelp() : 'Could not get your location. Turn on Location (GPS) on the phone and try again.'))
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
    setTimeout(finish, 12000)
  })
}

export const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`
