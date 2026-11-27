'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format, differenceInMinutes } from 'date-fns'
import { getBestFix, type Fix } from '@/lib/geo'
import { MapPin, Clock, CheckCircle, AlertTriangle, LogIn, LogOut, Building2, HardHat, Users, Settings, Trash2, Smartphone, Wrench, Car } from 'lucide-react'

// Office staff clock in at the office (GPS must be inside the office radius — the database checks it).
// Site staff clock in on their project. Managers see everyone's day; the CEO sets the office location.

interface Project { id: string; name: string; project_number: string }
interface Office { id: string; name: string; lat: number; lng: number; radius_m: number; active: boolean }
interface AttendanceRecord {
  id: string
  employee_id: string
  date: string
  session_no?: number | null
  work_type: 'office' | 'site' | 'outside' | null
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
  service_ticket_id?: string | null
  purpose?: Purpose | null
  purpose_note?: string | null
  quotation_id?: string | null
}
// "Out on work" (attendance_outside_v1.sql): away from the office on company work
type Purpose = 'site_visit' | 'eb_office' | 'purchase' | 'bank_govt' | 'other'
const PURPOSES: [Purpose, string][] = [
  ['site_visit', 'Site visit / survey'], ['eb_office', 'EB office / net meter'],
  ['purchase', 'Supplier / purchase'], ['bank_govt', 'Bank / govt office'], ['other', 'Other work'],
]
const purposeLabel = (p?: string | null) => PURPOSES.find(([k]) => k === p)?.[1] ?? 'Out on work'
interface Lead { id: string; quotation_number: string | null; customer_name: string; city: string | null }
interface Ticket { id: string; ticket_number: string; customer_name: string; site_address: string | null; kind: string }
interface Staff { id: string; full_name: string; designation: string | null; role: string; attendance_mode?: 'office' | 'field' | null }
type Mode = 'office' | 'field'

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

// The street address is a nice-to-have: give up after 6 s and keep the coordinates
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { 'Accept-Language': 'en' }, signal: ctrl.signal })
    const data = await res.json()
    return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } finally { clearTimeout(timer) }
}

// Same rule as the database (attendance_forgot_v1.sql): an open session is "current" if it is from
// today or started under 8 hours ago (a shift past midnight). Older open sessions were forgotten.
const isCurrentSession = (r: { date: string; clock_in_time: string }, today: string) =>
  r.date === today || Date.now() - new Date(r.clock_in_time).getTime() < 8 * 3600 * 1000

function friendly(msg: string) {
  if (/p_purpose|p_quotation|attendance_purpose|purpose_note/i.test(msg))
    return '“Out on work” needs the latest database update (attendance_outside_v1.sql). Ask the CEO to run it, or clock in at the office / a project site for now.'
  if (/attendance_one_per_day|attendance_session_per_day|duplicate key/i.test(msg)) return 'You have already clocked in. Refresh the page.'
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
  const [allocLevel,      setAllocLevel]      = useState<string | null>(null)
  const [projects,        setProjects]        = useState<Project[]>([])
  const [offices,         setOffices]         = useState<Office[]>([])
  const [workType,        setWorkType]        = useState<'office' | 'site' | 'service' | 'outside'>('office')
  const [purpose,         setPurpose]         = useState<Purpose | ''>('')
  const [purposeNote,     setPurposeNote]     = useState('')
  const [selectedLead,    setSelectedLead]    = useState('')
  const [outProject,      setOutProject]      = useState('')
  const [leads,           setLeads]           = useState<Lead[]>([])
  const [allProjects,     setAllProjects]     = useState<Project[]>([])
  const [tickets,         setTickets]         = useState<Ticket[]>([])
  const [selectedTicket,  setSelectedTicket]  = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [todayRecs,       setTodayRecs]       = useState<AttendanceRecord[]>([])
  const [mode,            setMode]            = useState<Mode>('office')
  const [history,         setHistory]         = useState<AttendanceRecord[]>([])
  const [loading,         setLoading]         = useState(false)
  const [pageLoading,     setPageLoading]     = useState(true)
  const [status,          setStatus]          = useState('')
  const [statusType,      setStatusType]      = useState<'success'|'error'|'info'>('info')
  const [elapsed,         setElapsed]         = useState('')

  // Managers: team view
  const [teamDate, setTeamDate] = useState(() => {
    const d = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('date') : null
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : format(new Date(), 'yyyy-MM-dd')
  })
  const [pastOpen,  setPastOpen]  = useState<AttendanceRecord | null>(null)
  const [forgotten, setForgotten] = useState<(AttendanceRecord & { employee?: { full_name: string } | null })[]>([])
  const [staff,    setStaff]    = useState<Staff[]>([])
  const [teamRows, setTeamRows] = useState<AttendanceRecord[]>([])
  const [modeMsg,  setModeMsg]  = useState('')

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
  // Sr / Jr Admin Manager: see the team's attendance, read only (attendance_view_v1.sql)
  const seesTeam  = isManager || (role === 'employee' && !!allocLevel)
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

  // Today's sessions (office staff: at most one; site / O&M staff: one per visit)
  const pastCurrent = pastOpen && isCurrentSession(pastOpen, today) ? pastOpen : null
  const pastForgot  = pastOpen && !pastCurrent ? pastOpen : null
  const openRec     = todayRecs.find(r => r.clock_in_time && !r.clock_out_time) ?? pastCurrent
  const lastRec     = todayRecs[todayRecs.length - 1] ?? null
  const todayRecord = openRec ?? lastRec
  const todayHours  = todayRecs.reduce((t, r) => t + Number(r.total_hours ?? 0), 0)
  const multi       = mode === 'field'

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
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('project_employees').select('projects(id,name,project_number)').eq('employee_id', uid).is('released_date', null),
      supabase.from('attendance').select(SELECT).eq('employee_id', uid).eq('date', today).order('clock_in_time'),
      supabase.from('attendance').select(SELECT).eq('employee_id', uid).order('date', { ascending: false }).order('clock_in_time', { ascending: false }).limit(20),
    ])
    if (me?.role) setRole(me.role)
    setAllocLevel(me?.allocation_level ?? null)
    const m: Mode = me?.attendance_mode === 'field' ? 'field' : 'office'
    setMode(m)
    if (m === 'field') setWorkType(w => w === 'office' ? 'site' : w)
    loadDevices(uid, me?.role === 'admin')
    const proj = ((myProjects ?? []) as unknown as { projects: Project | null }[]).map(r => r.projects).filter(Boolean) as Project[]
    setProjects(proj)
    setTodayRecs((todayAtt as AttendanceRecord[]) ?? [])
    const { data: po } = await supabase.from('attendance').select(SELECT).eq('employee_id', uid).lt('date', today)
      .is('clock_out_time', null).order('clock_in_time', { ascending: false }).limit(1)
    setPastOpen(((po as AttendanceRecord[]) ?? [])[0] ?? null)
    setHistory((hist as AttendanceRecord[]) ?? [])
    // Service jobs given to this person (service_v1.sql); none before that update
    const { data: tk } = await supabase.from('service_tickets').select('id, ticket_number, customer_name, site_address, kind')
      .eq('assigned_to', uid).in('status', ['open', 'assigned', 'in_progress']).order('due_date')
    setTickets((tk as Ticket[]) ?? [])
    // For "Out on work": open leads and projects this person can see (the database limits the list)
    const [{ data: ld }, { data: pj }] = await Promise.all([
      supabase.from('quotation_requests').select('id, quotation_number, customer_name, city')
        .not('status', 'in', '(project_created,cancelled,rejected)').order('created_at', { ascending: false }).limit(300),
      supabase.from('projects').select('id, name, project_number').order('created_at', { ascending: false }).limit(300),
    ])
    setLeads((ld as Lead[]) ?? [])
    setAllProjects((pj as Project[]) ?? [])
    await loadOffices()
    setPageLoading(false)
  }, [today, loadOffices, loadDevices])

  const loadTeam = useCallback(async (date: string) => {
    const [{ data: people }, { data: rows }] = await Promise.all([
      supabase.from('profiles').select('*').eq('status', 'active').neq('role', 'admin').order('full_name'),
      supabase.from('attendance').select(SELECT).eq('date', date).order('clock_in_time'),
    ])
    setStaff((people as Staff[]) ?? [])
    setTeamRows((rows as AttendanceRecord[]) ?? [])
    const { data: fg } = await supabase.from('attendance').select(SELECT).lt('date', format(new Date(), 'yyyy-MM-dd'))
      .is('clock_out_time', null).order('clock_in_time')
    setForgotten((fg as AttendanceRecord[]) ?? [])
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      loadData(user.id)
    })
  }, [loadData])

  useEffect(() => { if (seesTeam) loadTeam(teamDate) }, [seesTeam, teamDate, loadTeam])

  const say = (msg: string, type: 'success'|'error'|'info') => { setStatus(msg); setStatusType(type) }

  // A note is needed unless the session names a lead / project (and always for "Other work")
  const outsideNeedsNote = purpose === 'other' || (purpose === 'site_visit' ? !selectedLead : !outProject)

  const handleClockIn = async () => {
    if (workType === 'site' && !selectedProject) { say('Please select the project / site before clocking in.', 'error'); return }
    if (workType === 'service' && !selectedTicket) { say('Choose the service job you are at.', 'error'); return }
    if (workType === 'outside' && !purpose) { say('Choose what you are going out for.', 'error'); return }
    if (workType === 'outside' && outsideNeedsNote && purposeNote.trim().length < 3) { say('Write where you are going and why.', 'error'); return }
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
        p_work_type: workType === 'office' ? 'office' : workType === 'outside' ? 'outside' : 'site',
        p_project:   workType === 'site' ? selectedProject : workType === 'outside' && purpose !== 'site_visit' && outProject ? outProject : null,
        p_lat:       fix.latitude,
        p_lng:       fix.longitude,
        p_accuracy:  fix.accuracy,
        p_address:   address,
        // only sent for a service job, so clock-in keeps working before service_v1.sql is run
        ...(workType === 'service' ? { p_ticket: selectedTicket } : {}),
        // only sent for "Out on work", so the other choices keep working before attendance_outside_v1.sql is run
        ...(workType === 'outside' ? {
          p_purpose: purpose, p_note: purposeNote.trim() || null,
          p_quotation: purpose === 'site_visit' && selectedLead ? selectedLead : null,
        } : {}),
      })
      if (error) throw new Error(friendly(error.message))
      const { data } = await supabase.from('attendance').select(SELECT).eq('id', newId as string).single()
      const rec = data as AttendanceRecord
      setTodayRecs(rs => [...rs.filter(r => r.id !== rec.id), rec])
      say(`Clocked in at ${format(new Date(rec.clock_in_time), 'hh:mm a')}${multi && (rec.session_no ?? 1) > 1 ? ` (session ${rec.session_no})` : ''}${rec.work_type === 'office' && rec.clock_in_distance_m != null ? ` · ${rec.clock_in_distance_m} m from the office` : ''}`, 'success')
      if (seesTeam) loadTeam(teamDate)
      setPurpose(''); setPurposeNote(''); setSelectedLead(''); setOutProject('')
    } catch (err: unknown) {
      say(err instanceof Error ? err.message : 'Clock-in failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!openRec) return
    if (!window.confirm(multi
      ? 'Clock out of this session? You can clock in again when you reach the next site.'
      : 'Clock out now? You cannot clock in again today.')) return
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
      setTodayRecs(rs => rs.map(r => r.id === rec.id ? rec : r))
      say(multi
        ? `Clocked out. This session: ${Number(rec.total_hours ?? 0).toFixed(1)} hrs. Clock in again at the next site.`
        : `Clocked out. Total: ${Number(rec.total_hours ?? 0).toFixed(1)} hrs worked.`, 'success')
      loadData(userId!)
      if (seesTeam) loadTeam(teamDate)
    } catch (err: unknown) {
      say(err instanceof Error ? err.message : 'Clock-out failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── CEO: set the clock-out time of a forgotten session ──
  const [fixMsg, setFixMsg] = useState('')
  const fixClockOut = async (r: AttendanceRecord, who: string) => {
    const day = format(new Date(r.date + 'T12:00:00'), 'dd MMM')
    const ans = window.prompt(`${who} clocked in on ${day} at ${fmtT(r.clock_in_time)} and did not clock out.\n\nWhat time did they leave on ${day}? (24-hour, e.g. 18:30 or 21:15)`)
    if (!ans) return
    const m = ans.trim().match(/^(\d{1,2})[:.](\d{2})$/)
    if (!m || +m[1] > 23 || +m[2] > 59) { setFixMsg('❌ Type the time like 18:30.'); return }
    const out = new Date(`${r.date}T${m[1].padStart(2, '0')}:${m[2]}:00+05:30`)
    if (out <= new Date(r.clock_in_time)) { setFixMsg(`❌ The clock-out must be after the clock-in (${fmtT(r.clock_in_time)}). For a shift that ended after midnight, change it in Supabase.`); return }
    if (out > new Date()) { setFixMsg('❌ That time has not happened yet.'); return }
    const { error } = await supabase.from('attendance').update({ clock_out_time: out.toISOString() }).eq('id', r.id)
    setFixMsg(error ? `❌ ${error.message}` : `✅ ${who}, ${day}: clocked out at ${format(out, 'hh:mm a')} (${((out.getTime() - new Date(r.clock_in_time).getTime()) / 3600000).toFixed(1)} h)`)
    loadTeam(teamDate)
  }

  // ── CEO: attendance type per person ──
  const changeMode = async (p: Staff, m: Mode) => {
    const { error } = await supabase.from('profiles').update({ attendance_mode: m }).eq('id', p.id)
    if (error) setModeMsg(/attendance_mode|schema cache/i.test(error.message)
      ? '❌ The database update for site / O&M attendance has not been run yet (supabase/attendance_multi_v1.sql).' : `❌ ${error.message}`)
    else setModeMsg(`✅ ${p.full_name}: ${m === 'field' ? 'can clock in and out several times a day' : 'clocks in once a day'}`)
    loadTeam(teamDate)
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

  const isClockedIn  = !!openRec
  // Office staff: the day is complete after one clock-out. Site / O&M staff can start another session.
  const isClockedOut = !openRec && !multi && !!lastRec?.clock_out_time
  const leadName = (id?: string | null) => leads.find(x => x.id === id)?.customer_name ?? 'lead'
  const placeOf = (r: AttendanceRecord) =>
    r.work_type === 'office' ? `🏢 ${r.office_locations?.name ?? 'Office'}`
      : r.work_type === 'outside' ? `🚗 ${purposeLabel(r.purpose)}${r.quotation_id ? ' · ' + leadName(r.quotation_id) : ''}${r.projects?.name ? ' · ' + r.projects.name : ''}${r.purpose_note ? ' · ' + r.purpose_note : ''}`
      : r.service_ticket_id ? `🔧 Service job${r.projects?.name ? ' · ' + r.projects.name : ''}` : (r.projects?.name ?? '—')

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const byEmp = new Map<string, AttendanceRecord[]>()
  for (const r of teamRows) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) ?? []), r])
  const fmtT = (t: string) => format(new Date(t), 'hh:mm a')

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

        {!isCeo && pastForgot && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex gap-3">
            <AlertTriangle size={20} className="shrink-0 text-amber-600 mt-0.5" />
            <p>
              <b>You did not clock out on {format(new Date(pastForgot.date + 'T12:00:00'), 'dd MMM')}</b> (clocked in at {fmtT(pastForgot.clock_in_time)}).
              The CEO has been told and will set the time you left. You can clock in for today as normal.
            </p>
          </div>
        )}

        {/* Clock-in card (staff only: the CEO does not clock in) */}
        {!isCeo && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className={`p-4 flex items-center gap-3 ${isClockedIn ? 'bg-green-600' : isClockedOut ? 'bg-slate-700' : 'bg-amber-500'}`}>
            <MapPin size={20} className="text-white shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm">
                {isClockedIn ? `Clocked In${multi ? ` · session ${openRec!.session_no ?? 1}` : ''} — ${elapsed || '…'} so far`
                  : isClockedOut ? `Day Complete — ${todayHours.toFixed(1)} hrs worked`
                  : multi && todayRecs.length ? `Not clocked in · ${todayHours.toFixed(1)} hrs today in ${todayRecs.length} session${todayRecs.length > 1 ? 's' : ''}`
                  : 'Not Clocked In Today'}
              </p>
              <p className="text-white/70 text-xs">
                {isClockedIn ? `Since ${fmtT(openRec!.clock_in_time)} · ${placeOf(openRec!)}`
                  : isClockedOut ? `${fmtT(lastRec!.clock_in_time)} → ${fmtT(lastRec!.clock_out_time!)}`
                  : multi && todayRecs.length ? 'Clock in again when you reach the next site'
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
                      <p className="block text-sm font-medium text-slate-700 mb-1.5">{multi && todayRecs.length ? 'Where are you now?' : 'Where are you working today?'}</p>
                      <div className={`grid gap-2 grid-cols-2 ${tickets.length ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                        {([['office', 'At the office', Building2], ['site', 'Project site', HardHat], ['outside', 'Out on work', Car], ...(tickets.length ? [['service', 'Service job', Wrench]] as const : [])] as const).map(([v, label, Icon]) => (
                          <button key={v} type="button" onClick={() => { setWorkType(v); setStatus('') }}
                            className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition ${
                              workType === v ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            <Icon size={18} /> {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {workType === 'outside' ? (
                      <div className="space-y-3">
                        <div>
                          <p className="block text-sm font-medium text-slate-700 mb-1.5">Going out for <span className="text-red-500">*</span></p>
                          <div className="flex flex-wrap gap-2">
                            {PURPOSES.map(([k, label]) => (
                              <button key={k} type="button" onClick={() => { setPurpose(k); setStatus('') }}
                                className={`px-3 py-2 rounded-lg border text-sm font-medium ${purpose === k ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {purpose === 'site_visit' && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">For which lead? <span className="text-slate-400 font-normal">(optional)</span></label>
                            <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)}
                              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                              <option value="">— Not in the list / new customer —</option>
                              {leads.map(l => <option key={l.id} value={l.id}>{l.customer_name}{l.city ? ' · ' + l.city : ''}{l.quotation_number ? ' · ' + l.quotation_number : ''}</option>)}
                            </select>
                          </div>
                        )}
                        {purpose && purpose !== 'site_visit' && purpose !== 'other' && allProjects.length > 0 && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">For which project? <span className="text-slate-400 font-normal">(optional)</span></label>
                            <select value={outProject} onChange={e => setOutProject(e.target.value)}
                              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                              <option value="">— General / several projects —</option>
                              {allProjects.map(p => <option key={p.id} value={p.id}>{p.project_number} — {p.name}</option>)}
                            </select>
                          </div>
                        )}
                        {purpose && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                              Where and what {outsideNeedsNote ? <span className="text-red-500">*</span> : <span className="text-slate-400 font-normal">(optional)</span>}
                            </label>
                            <input value={purposeNote} onChange={e => setPurposeNote(e.target.value)} maxLength={300}
                              placeholder={purpose === 'eb_office' ? 'e.g. EB Lawspet – net meter file of Ravi' : purpose === 'site_visit' ? 'e.g. Survey at Muthialpet, new enquiry' : 'e.g. Inverter pickup from supplier, Villianur'}
                              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500" />
                          </div>
                        )}
                        <p className="text-xs text-slate-500">Your GPS location is recorded at clock-in and clock-out. Clock out when this work is done{multi ? ', then clock in again at the next place' : ''}.</p>
                        {!multi && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">Your attendance is once a day, so this will be your only session today. If you move between the office and outside work, ask the CEO to set your attendance type to “Field · several a day”.</p>}
                      </div>
                    ) : workType === 'service' ? (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Which service job? <span className="text-red-500">*</span></label>
                        <select value={selectedTicket} onChange={e => setSelectedTicket(e.target.value)}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                          <option value="">— Choose the job —</option>
                          {tickets.map(t => <option key={t.id} value={t.id}>{t.ticket_number} · {t.customer_name}{t.site_address ? ' · ' + t.site_address.slice(0, 40) : ''}</option>)}
                        </select>
                        <p className="text-xs text-slate-500 mt-1">Your time here is counted on this job. Clock out when you leave the customer.</p>
                      </div>
                    ) : workType === 'office' ? (
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

                {isClockedIn && openRec?.clock_in_address && (
                  <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                    <p className="text-sm text-green-800 font-medium">{placeOf(openRec)}</p>
                    <p className="text-xs text-green-600 mt-1 flex items-start gap-1">
                      <MapPin size={10} className="mt-0.5 shrink-0" /> {openRec.clock_in_address}
                    </p>
                  </div>
                )}

                {multi && todayRecs.length > 0 && (
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-50">
                    <p className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Today’s sessions</p>
                    {todayRecs.map(r => (
                      <div key={r.id} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-slate-800 truncate">{r.session_no ?? 1}. {placeOf(r)}</p>
                          <p className="text-xs text-slate-500">{fmtT(r.clock_in_time)} → {r.clock_out_time ? fmtT(r.clock_out_time) : <span className="text-amber-600">now</span>}</p>
                        </div>
                        <span className="font-semibold text-slate-700 shrink-0">{r.total_hours != null ? `${Number(r.total_hours).toFixed(1)}h` : '…'}</span>
                      </div>
                    ))}
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
                  disabled={loading || !canClock || (!isClockedIn && workType === 'site' && !selectedProject) || (!isClockedIn && workType === 'service' && !selectedTicket) || (!isClockedIn && workType === 'outside' && (!purpose || (outsideNeedsNote && purposeNote.trim().length < 3))) || (!isClockedIn && workType === 'office' && activeOffices.length === 0)}
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
                  You worked <strong>{todayHours.toFixed(1)} hours</strong> · {placeOf(lastRec!)}
                </p>
                {status && <p className="text-green-600 text-sm mt-2">{status}</p>}
              </div>
            )}
          </div>
        </div>

        )}

        {/* CEO: sessions nobody clocked out of */}
        {isCeo && (forgotten.length > 0 || fixMsg) && (
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-2">
            <h3 className="font-semibold text-amber-900 text-sm flex items-center gap-2"><AlertTriangle size={16} /> Forgot to clock out</h3>
            {forgotten.map(r => {
              const who = staff.find(p => p.id === r.employee_id)?.full_name ?? 'Staff'
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-lg border border-amber-100 px-3 py-2 text-sm">
                  <span><b>{who}</b> · {format(new Date(r.date + 'T12:00:00'), 'dd MMM')} · in at {fmtT(r.clock_in_time)} · {placeOf(r)}</span>
                  <button onClick={() => fixClockOut(r, who)} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700">Set clock-out time</button>
                </div>
              )
            })}
            {fixMsg && <p className="text-sm text-slate-700">{fixMsg}</p>}
          </div>
        )}

        {/* Managers, Sr / Jr Admin Manager: everyone's attendance for a day (only the CEO changes anything) */}
        {seesTeam && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                <Users size={16} className="text-green-600" /> Team attendance · {byEmp.size} of {staff.length} clocked in
                {!isManager && <span className="text-[11px] font-normal text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">View only</span>}
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
                    const rs = byEmp.get(p.id) ?? []
                    const dayTotal = rs.reduce((t, r) => t + Number(r.total_hours ?? 0), 0)
                    const pMode: Mode = p.attendance_mode === 'field' ? 'field' : 'office'
                    const nameCell = (
                      <td className="px-4 py-3 align-top" rowSpan={Math.max(rs.length, 1) + (rs.length > 1 ? 1 : 0)}>
                        <p className="font-medium text-slate-800">{p.full_name}</p>
                        {p.designation && <p className="text-xs text-slate-400">{p.designation}</p>}
                        {isCeo ? (
                          <select value={pMode} onChange={e => changeMode(p, e.target.value as Mode)} aria-label={`Attendance type of ${p.full_name}`}
                            className="mt-1 text-xs border border-slate-200 rounded-md px-1.5 py-0.5 bg-white text-slate-600">
                            <option value="office">Office · once a day</option>
                            <option value="field">Field · several a day</option>
                          </select>
                        ) : pMode === 'field' && <p className="text-[11px] text-slate-400">Field · several a day</p>}
                      </td>
                    )
                    if (rs.length === 0) return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        {nameCell}
                        <td colSpan={5} className="px-4 py-3 text-xs text-slate-400 align-top">Not clocked in</td>
                      </tr>
                    )
                    return [
                      ...rs.map((r, i) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          {i === 0 && nameCell}
                          <td className="px-4 py-3 text-slate-600">
                            {rs.length > 1 && <span className="text-xs text-slate-400 mr-1">{r.session_no ?? i + 1}.</span>}
                            {placeOf(r)}
                            {r.work_type === 'office' && r.clock_in_distance_m != null && <span className="block text-xs text-slate-400">{r.clock_in_distance_m} m from office</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{fmtT(r.clock_in_time)}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {r.clock_out_time ? fmtT(r.clock_out_time) : isCurrentSession(r, today) ? <span className="text-amber-500 text-xs">Working…</span> : (
                              <span className="text-xs text-red-600">Forgot to clock out{isCeo && <button onClick={() => fixClockOut(r, p.full_name)} className="block mt-0.5 text-green-700 underline">Set time</button>}</span>)}
                            {r.is_location_mismatch && <span className="block text-xs text-red-500">⚠ clocked out {r.clock_out_distance_m != null ? `${r.clock_out_distance_m} m away` : 'away from the office'}</span>}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{r.total_hours != null ? `${Number(r.total_hours).toFixed(1)}h` : '—'}</td>
                          <td className="px-4 py-3">
                            {r.clock_in_lat != null && r.clock_in_lng != null && (
                              <a href={mapLink(r.clock_in_lat, r.clock_in_lng)} target="_blank" rel="noreferrer" className="text-xs text-green-700 hover:underline">Map</a>)}
                          </td>
                        </tr>
                      )),
                      ...(rs.length > 1 ? [(
                        <tr key={`${p.id}-total`} className="bg-slate-50/60">
                          <td colSpan={3} className="px-4 py-2 text-xs text-slate-500">Day total · {rs.length} sessions</td>
                          <td className="px-4 py-2 font-bold text-slate-900">{dayTotal.toFixed(1)}h</td>
                          <td />
                        </tr>
                      )] : []),
                    ]
                  })}
                </tbody>
              </table>
            </div>
            {isCeo && (
              <p className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
                <b>Attendance type:</b> “Office” staff clock in once a day. “Site / O&amp;M” staff (installation, operation &amp; maintenance) clock in and out at every site they visit; their day total is the sum of the sessions.
                {modeMsg && <span className="block mt-1 text-slate-700">{modeMsg}</span>}
              </p>
            )}
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
                    <td className="px-4 py-3 font-medium text-slate-800">{format(new Date(rec.date), 'dd MMM yyyy')}
                      {(rec.session_no ?? 1) > 1 && <span className="block text-xs font-normal text-slate-400">session {rec.session_no}</span>}</td>
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
