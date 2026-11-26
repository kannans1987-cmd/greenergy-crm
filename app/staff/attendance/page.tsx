'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format, differenceInMinutes } from 'date-fns'
import { getBestFix, type Fix } from '@/lib/geo'
import { MapPin, Clock, CheckCircle, AlertTriangle, LogIn, LogOut, Building2, HardHat, Users, Settings, Trash2, Smartphone } from 'lucide-react'

// Office staff clock in at the office (GPS must be inside the office radius — the database checks it).
// Site staff clock in on their project. Managers see everyone's day; the CEO sets the office location.

interface Project { id: string; name: string; project_number: string }
interface Office { id: string; name: string; lat: number; lng: number; radius_m: number; active: boolean }
interface AttendanceRecord {
  id: string
  employee_id: string
  date: string
  work_type: 'office' | 'site' | null
  clock_in_time: string
  clock_out_time: string | null
  clock_in_address: string | null
  clock_in_lat: number | null
  clock_in_lng: number | null
  clock_in_distance_m: number | null
  clock_out_distance_m: number | null
  is_location_mismatch: boolean | null
  total_hours: number | null
  attendance_status: string
  projects: { name: string } | null
  office_locations?: { name: string } | null
}
interface Staff { id: string; full_name: string; designation: string | null; role: string }

const SELECT = '*,projects(name),office_locations(name)'

function formatHHMM(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { 'Accept-Language': 'en' } })
    const data = await res.json()
    return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

function friendly(msg: string) {
  if (/attendance_one_per_day|duplicate key/i.test(msg)) return 'You have already clocked in today.'
  if (/work_type|office_location|clock_in_accuracy|clock_out_accuracy|trusted_devices|attendance_clock|register_attendance|schema cache|Could not find the function/i.test(msg))
    return 'The attendance database update has not been run yet. Ask the CEO to run supabase/attendance_devices_v1.sql in Supabase.'
  return msg
}

// ── Trusted phone ──
// This phone's id + secret live only on the phone (browser storage, with a cookie as a backup).
// The database keeps a hash of the secret, so the id alone cannot be used from another phone.
type DeviceKey = { id: string; secret: string }
interface Device { id: string; employee_id: string; label: string | null; status: string; created_at: string; last_used_at: string | null; employee?: { full_name: string } | null }
const DEVICE_KEY = 'gss-attendance-device'

function readDeviceKey(): DeviceKey | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
      ?? decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith(DEVICE_KEY + '='))?.split('=')[1] ?? '')
    const k = raw ? JSON.parse(raw) : null
    if (k?.id && k?.secret) { saveDeviceKey(k); return k }
  } catch { /* nothing stored */ }
  return null
}

function saveDeviceKey(k: DeviceKey) {
  const v = JSON.stringify(k)
  try { localStorage.setItem(DEVICE_KEY, v) } catch { /* private mode */ }
  document.cookie = `${DEVICE_KEY}=${encodeURIComponent(v)}; max-age=${400 * 86400}; path=/; samesite=strict; secure`
  navigator.storage?.persist?.().catch(() => {})
}

function newSecret() {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

function isPhone() {
  const ua = navigator.userAgent
  return /Android|iPhone|iPod|Mobile/i.test(ua) && !/iPad|Tablet/i.test(ua)
}

async function phoneLabel() {
  const ua = navigator.userAgent
  const browser = /CriOS|Chrome/i.test(ua) ? 'Chrome' : /FxiOS|Firefox/i.test(ua) ? 'Firefox' : /SamsungBrowser/i.test(ua) ? 'Samsung Internet' : /Safari/i.test(ua) ? 'Safari' : 'Browser'
  if (/iPhone/i.test(ua)) return `iPhone · ${browser}`
  let model = ''
  try {
    const uad = (navigator as unknown as { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ model?: string }> } }).userAgentData
    model = (await uad?.getHighEntropyValues(['model']))?.model ?? ''
  } catch { /* not available */ }
  if (!model) model = ua.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.trim() ?? ''
  return `${model && model !== 'K' ? model : 'Android phone'} · ${browser}`
}

export default function AttendancePage() {
  const supabase = createClient()

  const [userId,          setUserId]          = useState<string | null>(null)
  const [role,            setRole]            = useState<string>('employee')
  const [projects,        setProjects]        = useState<Project[]>([])
  const [offices,         setOffices]         = useState<Office[]>([])
  const [workType,        setWorkType]        = useState<'office' | 'site'>('office')
  const [selectedProject, setSelectedProject] = useState('')
  const [todayRecord,     setTodayRecord]     = useState<AttendanceRecord | null>(null)
  const [history,         setHistory]         = useState<AttendanceRecord[]>([])
  const [loading,         setLoading]         = useState(false)
  const [pageLoading,     setPageLoading]     = useState(true)
  const [status,          setStatus]          = useState('')
  const [statusType,      setStatusType]      = useState<'success'|'error'|'info'>('info')
  const [elapsed,         setElapsed]         = useState('')

  // Managers: team view
  const [teamDate, setTeamDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [staff,    setStaff]    = useState<Staff[]>([])
  const [teamRows, setTeamRows] = useState<AttendanceRecord[]>([])

  // CEO: office settings
  const [officeMsg,  setOfficeMsg]  = useState('')
  const [officeBusy, setOfficeBusy] = useState(false)
  const [manual,     setManual]     = useState('')

  // Trusted phone
  const [deviceKey,  setDeviceKey]  = useState<DeviceKey | null>(null)
  const [myDevices,  setMyDevices]  = useState<Device[]>([])
  const [allDevices, setAllDevices] = useState<Device[]>([])
  const [onPhone,    setOnPhone]    = useState(true)
  const [devBusy,    setDevBusy]    = useState(false)
  const [devMsg,     setDevMsg]     = useState('')

  const today     = format(new Date(), 'yyyy-MM-dd')
  const isManager = role === 'admin' || role === 'task_manager'
  const isCeo     = role === 'admin'
  const activeOffices = offices.filter(o => o.active)

  // What this phone is, for this person
  const thisDevice   = deviceKey ? myDevices.find(d => d.id === deviceKey.id) : undefined
  const approvedElse = myDevices.find(d => d.status === 'approved' && d.id !== deviceKey?.id)
  const phoneState: 'ceo' | 'computer' | 'approved' | 'pending' | 'none' =
    isCeo ? 'ceo' : !onPhone ? 'computer' : thisDevice?.status === 'approved' ? 'approved' : thisDevice?.status === 'pending' ? 'pending' : 'none'
  const canClock = phoneState === 'approved'

  const loadDevices = useCallback(async (uid: string, ceo: boolean) => {
    const { data } = await supabase.from('trusted_devices').select('id,employee_id,label,status,created_at,last_used_at')
      .eq('employee_id', uid).order('created_at', { ascending: false })
    setMyDevices((data as Device[]) ?? [])
    if (ceo) {
      const { data: all } = await supabase.from('trusted_devices')
        .select('id,employee_id,label,status,created_at,last_used_at,employee:profiles!trusted_devices_employee_id_fkey(full_name)')
        .in('status', ['pending', 'approved']).order('created_at', { ascending: false })
      setAllDevices((all as unknown as Device[]) ?? [])
    }
  }, [])

  useEffect(() => { setDeviceKey(readDeviceKey()); setOnPhone(isPhone()) }, [])

  const registerPhone = async () => {
    if (approvedElse && !window.confirm(`Your approved attendance phone is "${approvedElse.label}". Register THIS phone instead? Once the CEO approves it, the old phone stops working for attendance.`)) return
    setDevBusy(true); setDevMsg('')
    try {
      const secret = newSecret()
      const label = await phoneLabel()
      const { data, error } = await supabase.rpc('register_attendance_device', { p_secret: secret, p_label: label })
      if (error) throw new Error(friendly(error.message))
      const k = { id: data as string, secret }
      saveDeviceKey(k); setDeviceKey(k)
      setDevMsg('✅ Sent to the CEO for approval. You can clock in from this phone once it is approved.')
      if (userId) loadDevices(userId, isCeo)
    } catch (err: unknown) {
      setDevMsg(`❌ ${err instanceof Error ? err.message : 'Failed'}`)
    } finally { setDevBusy(false) }
  }

  const decideDevice = async (d: Device, s: 'approved' | 'rejected' | 'revoked') => {
    const who = d.employee?.full_name ?? 'this person'
    const q = s === 'approved' ? `Approve "${d.label}" as the attendance phone of ${who}? Any other phone of theirs stops working for attendance.`
      : s === 'revoked' ? `Remove "${d.label}" from ${who}? They cannot clock in until a new phone is approved.`
      : `Reject "${d.label}" from ${who}?`
    if (!window.confirm(q)) return
    const { error } = await supabase.rpc('decide_attendance_device', { p_id: d.id, p_status: s })
    setDevMsg(error ? `❌ ${friendly(error.message)}` : `✅ ${who}: phone ${s}`)
    if (userId) loadDevices(userId, true)
  }

  useEffect(() => {
    if (!todayRecord?.clock_in_time || todayRecord.clock_out_time) return
    const tick = () => setElapsed(formatHHMM(differenceInMinutes(new Date(), new Date(todayRecord.clock_in_time))))
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [todayRecord])

  const loadOffices = useCallback(async () => {
    const { data } = await supabase.from('office_locations').select('*').order('created_at')
    setOffices((data as Office[]) ?? [])
  }, [])

  const loadData = useCallback(async (uid: string) => {
    const [{ data: me }, { data: myProjects }, { data: todayAtt }, { data: hist }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', uid).single(),
      supabase.from('project_employees').select('projects(id,name,project_number)').eq('employee_id', uid).is('released_date', null),
      supabase.from('attendance').select(SELECT).eq('employee_id', uid).eq('date', today).maybeSingle(),
      supabase.from('attendance').select(SELECT).eq('employee_id', uid).order('date', { ascending: false }).limit(10),
    ])
    if (me?.role) setRole(me.role)
    loadDevices(uid, me?.role === 'admin')
    const proj = ((myProjects ?? []) as unknown as { projects: Project | null }[]).map(r => r.projects).filter(Boolean) as Project[]
    setProjects(proj)
    setTodayRecord((todayAtt as AttendanceRecord) ?? null)
    setHistory((hist as AttendanceRecord[]) ?? [])
    await loadOffices()
    setPageLoading(false)
  }, [today, loadOffices, loadDevices])

  const loadTeam = useCallback(async (date: string) => {
    const [{ data: people }, { data: rows }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,designation,role').eq('status', 'active').neq('role', 'admin').order('full_name'),
      supabase.from('attendance').select(SELECT).eq('date', date),
    ])
    setStaff((people as Staff[]) ?? [])
    setTeamRows((rows as AttendanceRecord[]) ?? [])
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      loadData(user.id)
    })
  }, [loadData])

  useEffect(() => { if (isManager) loadTeam(teamDate) }, [isManager, teamDate, loadTeam])

  const say = (msg: string, type: 'success'|'error'|'info') => { setStatus(msg); setStatusType(type) }

  const handleClockIn = async () => {
    if (workType === 'site' && !selectedProject) { say('Please select the project / site before clocking in.', 'error'); return }
    if (workType === 'office' && activeOffices.length === 0) {
      say('The office location has not been set yet. Ask the CEO to set it (Attendance → Office location).', 'error'); return
    }
    setLoading(true)
    say('Getting your GPS location… keep the phone still for a few seconds.', 'info')
    try {
      const fix = await getBestFix()
      if (workType === 'office') {
        const here = { lat: fix.latitude, lng: fix.longitude }
        const nearest = activeOffices.map(o => ({ o, d: distanceM(here, o) })).sort((a, b) => a.d - b.d)[0]
        if (nearest.d > nearest.o.radius_m + Math.min(fix.accuracy, 100)) {
          throw new Error(`You are about ${Math.round(nearest.d)} m from ${nearest.o.name} (GPS accuracy ±${fix.accuracy} m). Office clock-in works within ${nearest.o.radius_m} m. Go to the office, or stand near a window / outside for a better signal, and try again.`)
        }
      }
      say('Capturing address…', 'info')
      const address = await reverseGeocode(fix.latitude, fix.longitude)
      const { data: newId, error } = await supabase.rpc('attendance_clock_in', {
        p_device:    deviceKey?.id ?? null,
        p_secret:    deviceKey?.secret ?? null,
        p_work_type: workType,
        p_project:   workType === 'site' ? selectedProject : null,
        p_lat:       fix.latitude,
        p_lng:       fix.longitude,
        p_accuracy:  fix.accuracy,
        p_address:   address,
      })
      if (error) throw new Error(friendly(error.message))
      const { data } = await supabase.from('attendance').select(SELECT).eq('id', newId as string).single()
      const rec = data as AttendanceRecord
      setTodayRecord(rec)
      say(`Clocked in at ${format(new Date(rec.clock_in_time), 'hh:mm a')}${rec.work_type === 'office' && rec.clock_in_distance_m != null ? ` · ${rec.clock_in_distance_m} m from the office` : ''}`, 'success')
      if (isManager) loadTeam(teamDate)
    } catch (err: unknown) {
      say(err instanceof Error ? err.message : 'Clock-in failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!todayRecord) return
    if (!window.confirm('Clock out now? You cannot clock in again today.')) return
    setLoading(true)
    say('Getting your GPS location…', 'info')
    try {
      let fix: Fix | null = null
      try { fix = await getBestFix() } catch (e) {
        if (!window.confirm(`${e instanceof Error ? e.message : 'No location'}\n\nClock out without location? It will be marked for the CEO to check.`)) throw e
      }
      const address = fix ? await reverseGeocode(fix.latitude, fix.longitude) : null
      const { data: recId, error } = await supabase.rpc('attendance_clock_out', {
        p_device:   deviceKey?.id ?? null,
        p_secret:   deviceKey?.secret ?? null,
        p_lat:      fix?.latitude ?? null,
        p_lng:      fix?.longitude ?? null,
        p_accuracy: fix?.accuracy ?? null,
        p_address:  address,
      })
      if (error) throw new Error(friendly(error.message))
      const { data } = await supabase.from('attendance').select(SELECT).eq('id', recId as string).single()
      const rec = data as AttendanceRecord
      setTodayRecord(rec)
      say(`Clocked out. Total: ${Number(rec.total_hours ?? 0).toFixed(1)} hrs worked.`, 'success')
      loadData(userId!)
      if (isManager) loadTeam(teamDate)
    } catch (err: unknown) {
      say(err instanceof Error ? err.message : 'Clock-out failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── CEO: office location ──
  const saveOffice = async (lat: number, lng: number, existing?: Office) => {
    if (existing) {
      const { error } = await supabase.from('office_locations').update({ lat, lng, updated_at: new Date().toISOString() }).eq('id', existing.id)
      if (error) throw new Error(friendly(error.message))
      setOfficeMsg(`✅ ${existing.name} moved to ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    } else {
      const name = window.prompt('Name of this office:', activeOffices.length ? 'Branch office' : 'Head office')
      if (!name) { setOfficeMsg(''); return }
      const { error } = await supabase.from('office_locations').insert({ name, lat, lng, radius_m: 200, created_by: userId })
      if (error) throw new Error(friendly(error.message))
      setOfficeMsg(`✅ ${name} saved. Staff can now clock in within 200 m of it.`)
    }
    await loadOffices()
  }

  const officeHere = async (existing?: Office) => {
    setOfficeBusy(true); setOfficeMsg('Getting your GPS location… stand still for a few seconds.')
    try {
      const fix = await getBestFix()
      if (fix.accuracy > 60 && !window.confirm(`GPS accuracy is only ±${fix.accuracy} m right now. Save anyway? (Standing near a window or just outside the door gives a better reading.)`)) {
        setOfficeMsg(''); return
      }
      await saveOffice(fix.latitude, fix.longitude, existing)
    } catch (err: unknown) {
      setOfficeMsg(`❌ ${err instanceof Error ? err.message : 'Failed'}`)
    } finally { setOfficeBusy(false) }
  }

  const officeManual = async () => {
    const m = manual.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
    if (!m) { setOfficeMsg('❌ Paste the coordinates like 11.958123, 79.812345 (Google Maps: long-press the office → copy the numbers shown).'); return }
    setOfficeBusy(true)
    try { await saveOffice(parseFloat(m[1]), parseFloat(m[2])); setManual('') }
    catch (err: unknown) { setOfficeMsg(`❌ ${err instanceof Error ? err.message : 'Failed'}`) }
    finally { setOfficeBusy(false) }
  }

  const setRadius = async (o: Office, radius: number) => {
    if (!Number.isFinite(radius) || radius < 30 || radius > 5000) { setOfficeMsg('❌ Radius must be between 30 and 5000 metres.'); return }
    const { error } = await supabase.from('office_locations').update({ radius_m: Math.round(radius), updated_at: new Date().toISOString() }).eq('id', o.id)
    setOfficeMsg(error ? `❌ ${friendly(error.message)}` : `✅ ${o.name}: clock-in allowed within ${Math.round(radius)} m`)
    loadOffices()
  }

  const removeOffice = async (o: Office) => {
    if (!window.confirm(`Remove ${o.name}? Staff will no longer be able to clock in there.`)) return
    const { error } = await supabase.from('office_locations').update({ active: false }).eq('id', o.id)
    setOfficeMsg(error ? `❌ ${friendly(error.message)}` : `${o.name} removed`)
    loadOffices()
  }

  const isClockedIn  = !!todayRecord?.clock_in_time && !todayRecord.clock_out_time
  const isClockedOut = !!todayRecord?.clock_out_time
  const placeOf = (r: AttendanceRecord) =>
    r.work_type === 'office' ? `🏢 ${r.office_locations?.name ?? 'Office'}` : (r.projects?.name ?? '—')

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const byEmp = new Map(teamRows.map(r => [r.employee_id, r]))

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Attendance" subtitle={isCeo ? "Team attendance, phones and office location" : "GPS Clock-In / Clock-Out"} />

      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">

        {/* Trusted phone */}
        {phoneState !== 'ceo' && (
          <div className={`rounded-2xl border p-4 flex items-start gap-3 ${
            phoneState === 'approved' ? 'bg-green-50 border-green-100' : phoneState === 'pending' ? 'bg-blue-50 border-blue-100' : 'bg-amber-50 border-amber-200'}`}>
            <Smartphone size={22} className={`shrink-0 mt-0.5 ${phoneState === 'approved' ? 'text-green-600' : phoneState === 'pending' ? 'text-blue-600' : 'text-amber-600'}`} />
            <div className="flex-1 text-sm space-y-2">
              {phoneState === 'approved' && (
                <p className="text-green-800"><b>This is your approved attendance phone</b> ({thisDevice?.label}).</p>
              )}
              {phoneState === 'pending' && (
                <p className="text-blue-800"><b>Waiting for the CEO to approve this phone</b> ({thisDevice?.label}). You can clock in here once it is approved.</p>
              )}
              {phoneState === 'computer' && (
                <p className="text-amber-800"><b>Attendance can only be marked from your registered mobile phone.</b> Open the CRM on your phone to clock in or out.</p>
              )}
              {phoneState === 'none' && (<>
                <p className="text-amber-800">
                  <b>{approvedElse ? 'This is not your approved attendance phone.' : 'Register this phone for attendance.'}</b>{' '}
                  {approvedElse
                    ? `Your approved phone is "${approvedElse.label}". If you changed phones, register this one and the CEO will approve it.`
                    : 'You can only clock in from one phone, approved by the CEO. Do this on the phone you carry to work every day.'}
                </p>
                <button onClick={registerPhone} disabled={devBusy}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                  {devBusy ? 'Registering…' : 'Register this phone'}
                </button>
                <p className="text-xs text-amber-700">Always open the CRM in the same browser on this phone. Clearing the browser’s history / website data means registering again.</p>
              </>)}
              {devMsg && !isCeo && <p className="text-slate-700">{devMsg}</p>}
            </div>
          </div>
        )}

        {/* Clock-in card (staff only: the CEO does not clock in) */}
        {!isCeo && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className={`p-4 flex items-center gap-3 ${isClockedIn ? 'bg-green-600' : isClockedOut ? 'bg-slate-700' : 'bg-amber-500'}`}>
            <MapPin size={20} className="text-white shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm">
                {isClockedIn ? `Clocked In — ${elapsed || '…'} so far`
                  : isClockedOut ? `Day Complete — ${Number(todayRecord?.total_hours ?? 0).toFixed(1)} hrs worked`
                  : 'Not Clocked In Today'}
              </p>
              <p className="text-white/70 text-xs">
                {isClockedIn ? `Since ${format(new Date(todayRecord!.clock_in_time), 'hh:mm a')} · ${placeOf(todayRecord!)}`
                  : isClockedOut ? `${format(new Date(todayRecord!.clock_in_time), 'hh:mm a')} → ${format(new Date(todayRecord!.clock_out_time!), 'hh:mm a')}`
                  : format(new Date(), 'EEEE, dd MMMM yyyy')}
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {!isClockedOut && (
              <>
                {!isClockedIn && (
                  <>
                    <div>
                      <p className="block text-sm font-medium text-slate-700 mb-1.5">Where are you working today?</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([['office', 'At the office', Building2], ['site', 'Project site', HardHat]] as const).map(([v, label, Icon]) => (
                          <button key={v} type="button" onClick={() => { setWorkType(v); setStatus('') }}
                            className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition ${
                              workType === v ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            <Icon size={18} /> {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {workType === 'office' ? (
                      activeOffices.length === 0 ? (
                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
                          ⚠ The office location has not been set yet. {isCeo ? 'Set it below in “Office location” (do it while you are at the office).' : 'Ask the CEO to set it.'}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-3">
                          You must be at the office to clock in: {activeOffices.map(o => `${o.name} (within ${o.radius_m} m)`).join(', ')}.
                        </p>
                      )
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Select Project / Site <span className="text-red-500">*</span></label>
                        {projects.length === 0 ? (
                          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3">
                            ⚠ You are not assigned to any project. Choose “At the office”, or ask your manager to assign you.
                          </p>
                        ) : (
                          <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                            <option value="">— Choose project/site —</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.project_number} — {p.name}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </>
                )}

                {isClockedIn && todayRecord?.clock_in_address && (
                  <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                    <p className="text-sm text-green-800 font-medium">{placeOf(todayRecord)}</p>
                    <p className="text-xs text-green-600 mt-1 flex items-start gap-1">
                      <MapPin size={10} className="mt-0.5 shrink-0" /> {todayRecord.clock_in_address}
                    </p>
                  </div>
                )}

                {status && (
                  <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${
                    statusType === 'success' ? 'bg-green-50 text-green-700 border border-green-100'
                    : statusType === 'error' ? 'bg-red-50 text-red-700 border border-red-100'
                    : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                    <span className="mt-0.5 shrink-0">
                      {statusType === 'success' ? <CheckCircle size={16} /> : statusType === 'error' ? <AlertTriangle size={16} /> : <Clock size={16} />}
                    </span>
                    {status}
                  </div>
                )}

                <button
                  onClick={isClockedIn ? handleClockOut : handleClockIn}
                  disabled={loading || !canClock || (!isClockedIn && workType === 'site' && !selectedProject) || (!isClockedIn && workType === 'office' && activeOffices.length === 0)}
                  className={`w-full py-4 rounded-xl font-bold text-white text-lg transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg ${
                    isClockedIn ? 'bg-red-500 hover:bg-red-600 shadow-red-200' : 'bg-green-600 hover:bg-green-700 shadow-green-200'}`}>
                  {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : isClockedIn ? <><LogOut size={22} /> Clock Out</> : <><LogIn size={22} /> Clock In</>}
                </button>

                <p className="text-xs text-slate-400 text-center">📍 Your GPS location is recorded when you clock in and out. Allow “Location” when the phone asks.</p>
              </>
            )}

            {isClockedOut && (
              <div className="text-center py-4">
                <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
                <p className="text-slate-800 font-semibold">Great work today!</p>
                <p className="text-slate-500 text-sm mt-1">
                  You worked <strong>{Number(todayRecord?.total_hours ?? 0).toFixed(1)} hours</strong> · {placeOf(todayRecord!)}
                </p>
                {status && <p className="text-green-600 text-sm mt-2">{status}</p>}
              </div>
            )}
          </div>
        </div>

        )}

        {/* Managers: everyone's attendance for a day */}
        {isManager && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                <Users size={16} className="text-green-600" /> Team attendance · {teamRows.length} of {staff.length} clocked in
              </h3>
              <input type="date" value={teamDate} max={today} onChange={e => e.target.value && setTeamDate(e.target.value)}
                aria-label="Day to show" className="text-sm border border-slate-200 rounded-lg px-2 py-1" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>{['Name', 'Where', 'In', 'Out', 'Hours', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {staff.map(p => {
                    const r = byEmp.get(p.id)
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{p.full_name}</p>
                          {p.designation && <p className="text-xs text-slate-400">{p.designation}</p>}
                        </td>
                        {r ? (<>
                          <td className="px-4 py-3 text-slate-600">
                            {placeOf(r)}
                            {r.work_type === 'office' && r.clock_in_distance_m != null && <span className="block text-xs text-slate-400">{r.clock_in_distance_m} m from office</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{format(new Date(r.clock_in_time), 'hh:mm a')}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {r.clock_out_time ? format(new Date(r.clock_out_time), 'hh:mm a') : <span className="text-amber-500 text-xs">Working…</span>}
                            {r.is_location_mismatch && <span className="block text-xs text-red-500">⚠ clocked out {r.clock_out_distance_m != null ? `${r.clock_out_distance_m} m away` : 'away from the office'}</span>}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{r.total_hours != null ? `${Number(r.total_hours).toFixed(1)}h` : '—'}</td>
                          <td className="px-4 py-3">
                            {r.clock_in_lat != null && r.clock_in_lng != null && (
                              <a href={mapLink(r.clock_in_lat, r.clock_in_lng)} target="_blank" rel="noreferrer" className="text-xs text-green-700 hover:underline">Map</a>)}
                          </td>
                        </>) : (
                          <td colSpan={5} className="px-4 py-3 text-xs text-slate-400">Not clocked in</td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CEO: attendance phones */}
        {isCeo && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <Smartphone size={16} className="text-green-600" /> Attendance phones
              {allDevices.some(d => d.status === 'pending') && (
                <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">{allDevices.filter(d => d.status === 'pending').length} waiting</span>)}
            </h3>
            <p className="text-xs text-slate-500">Each person can clock in only from the one phone you approve here. Approve a phone only when you know it is theirs (for example, they registered it in front of you).</p>
            {allDevices.length === 0 ? <p className="text-sm text-slate-400">No phones registered yet.</p> : (
              <div className="divide-y divide-slate-50">
                {allDevices.map(d => (
                  <div key={d.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-medium text-slate-800">{d.employee?.full_name ?? '—'}</p>
                      <p className="text-xs text-slate-500">{d.label} · registered {format(new Date(d.created_at), 'dd MMM, hh:mm a')}
                        {d.last_used_at && ` · last used ${format(new Date(d.last_used_at), 'dd MMM')}`}</p>
                    </div>
                    {d.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button onClick={() => decideDevice(d, 'approved')} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">Approve</button>
                        <button onClick={() => decideDevice(d, 'rejected')} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">Reject</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-700 bg-green-50 rounded-full px-2 py-0.5">Approved</span>
                        <button onClick={() => decideDevice(d, 'revoked')} className="px-3 py-1.5 text-xs text-red-600 border border-red-100 rounded-lg hover:bg-red-50">Remove</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {devMsg && <p className="text-sm text-slate-700">{devMsg}</p>}
          </div>
        )}

        {/* CEO: office location */}
        {isCeo && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <Settings size={16} className="text-green-600" /> Office location
            </h3>
            {activeOffices.length === 0 && (
              <p className="text-sm text-slate-600">Stand inside the office with your phone and press <b>Set office location here</b>. Staff can then clock in within the radius.</p>
            )}
            {activeOffices.map(o => (
              <div key={o.id} className="border border-slate-100 rounded-xl p-3 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <p className="font-medium text-slate-800 text-sm">{o.name}</p>
                  <a href={mapLink(o.lat, o.lng)} target="_blank" rel="noreferrer" className="text-xs text-green-700 hover:underline">
                    {o.lat.toFixed(6)}, {o.lng.toFixed(6)} · view on map</a>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-xs text-slate-500" htmlFor={`r-${o.id}`}>Radius (m)</label>
                  <input id={`r-${o.id}`} type="number" defaultValue={o.radius_m} min={30} max={5000} step={10}
                    onBlur={e => { const v = Number(e.target.value); if (v !== o.radius_m) setRadius(o, v) }}
                    className="w-20 border border-slate-200 rounded-lg px-2 py-1" />
                  <button onClick={() => officeHere(o)} disabled={officeBusy}
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">Move to where I am</button>
                  <button onClick={() => removeOffice(o)} aria-label={`Remove ${o.name}`} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => officeHere()} disabled={officeBusy}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                <MapPin size={14} /> {activeOffices.length ? 'Add another office here' : 'Set office location here'}
              </button>
              <input value={manual} onChange={e => setManual(e.target.value)} placeholder="or paste coordinates, e.g. 11.958123, 79.812345"
                aria-label="Office coordinates" className="flex-1 min-w-[220px] text-sm border border-slate-200 rounded-lg px-3 py-2" />
              <button onClick={officeManual} disabled={officeBusy || !manual}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">Save coordinates</button>
            </div>
            {officeMsg && <p className="text-sm text-slate-700">{officeMsg}</p>}
            <p className="text-xs text-slate-400">Indoors, phone GPS can be 20–80 m off, so 150–250 m is a sensible radius. The distance check is done on the server, and clock-in / clock-out times are the server’s clock, not the phone’s.</p>
          </div>
        )}

        {/* My history (staff only) */}
        {!isCeo && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <Clock size={16} className="text-green-600" /> My recent attendance
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>{['Date', 'Where', 'Clock In', 'Clock Out', 'Hours'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {history.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-sm">No attendance records yet</td></tr>
                ) : history.map(rec => (
                  <tr key={rec.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">{format(new Date(rec.date), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{placeOf(rec)}</td>
                    <td className="px-4 py-3 text-slate-600">{rec.clock_in_time ? format(new Date(rec.clock_in_time), 'hh:mm a') : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{rec.clock_out_time ? format(new Date(rec.clock_out_time), 'hh:mm a') : <span className="text-amber-500 text-xs">In progress…</span>}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{rec.total_hours != null ? `${Number(rec.total_hours).toFixed(1)}h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        )}
      </div>
    </div>
  )
}
