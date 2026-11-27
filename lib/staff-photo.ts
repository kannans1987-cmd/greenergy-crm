// Staff photos (staff_photos_v1.sql): one small square JPEG per person in the "staff-photos" bucket,
// folder = the person's id. The link is kept in profiles.avatar_url.
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'staff-photos'
export const PHOTO_EVENT = 'gss-staff-photo'   // tells the header / sidebar that my photo changed

// Crop to the middle square and shrink to 512 px (a phone photo of 4 MB becomes about 60–120 KB)
async function shrink(file: File, size = 512): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPG or PNG).')
  let img: ImageBitmap
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('This photo type cannot be read here. Choose a JPG or PNG photo.') }
  const side = Math.min(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(size, side)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the photo.')
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
  img.close()
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error('Could not prepare the photo.')
  return blob
}

function friendly(msg: string) {
  return /bucket not found|staff-photos/i.test(msg) && /not found/i.test(msg)
    ? 'Photos need the latest database update (supabase/staff_photos_v1.sql). Ask the CEO to run it.'
    : /uploaded from the CRM/i.test(msg) ? msg
    : /row-level security|violates|permission/i.test(msg) ? 'You can only change your own photo.'
    : msg
}

// Remove every file in the person's folder except `keep`
async function tidy(supabase: SupabaseClient, userId: string, keep?: string) {
  const { data } = await supabase.storage.from(BUCKET).list(userId, { limit: 100 })
  const old = (data ?? []).map(f => `${userId}/${f.name}`).filter(p => p !== keep)
  if (old.length) await supabase.storage.from(BUCKET).remove(old)
}

export async function setStaffPhoto(supabase: SupabaseClient, userId: string, file: File): Promise<string> {
  const blob = await shrink(file)
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
  const path = `${userId}/${Date.now().toString(36)}-${rand}.jpg`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  if (upErr) throw new Error(friendly(upErr.message))
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(friendly(error.message)) }
  tidy(supabase, userId, path).catch(() => {})
  return url
}

export async function removeStaffPhoto(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
  if (error) throw new Error(friendly(error.message))
  await tidy(supabase, userId).catch(() => {})
}

export function announceMyPhoto(url: string | null) {
  window.dispatchEvent(new CustomEvent(PHOTO_EVENT, { detail: url }))
}
