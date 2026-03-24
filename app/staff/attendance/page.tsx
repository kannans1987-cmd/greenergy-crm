'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Header from '@/components/staff/Header'
import { format, differenceInMinutes } from 'date-fns'
import { MapPin, Clock, CheckCircle, AlertTriangle, LogIn, LogOut } from 'lucide-react'

interface Project {
  id: string
  name: string
  project_number: string
}

interface AttendanceRecord {
  id: string
  date: string
  clock_in_time: string
  clock_out_time: string | null
  clock_in_address: string | null
  clock_out_lat: number | null
  clock_out_lng: number | null
  total_hours: number | null
  attendance_status: string
  projects: { name: string } | null
}

function formatHHMM(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

export default function AttendancePage() {
  const supabase = createClient()

  const [userId,          setUserId]          = useState<string | null>(null)
  const [projects,        setProjects]        = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [todayRecord,     setTodayRecord]     = useState<AttendanceRecord | null>(null)
  const [history,         setHistory]         = useState<AttendanceRecord[]>([])
  const [loading,         setLoading]         = useState(false)
  const [pageLoading,     setPageLoading]     = useState(true)
  const [status,          setStatus]          = useState('')
  const [statusType,      setStatusType]      = useState<'success'|'error'|'info'>('info')
  const [elapsed,         setElapsed]         = useState('')

  const today = format(new Date(), 'yyyy-MM-dd')

  // Live elapsed time counter
  useEffect(() => {
    if (!todayRecord?.clock_in_time || todayRecord.clock_out_time) return
    const interval = setInterval(() => {
      const mins = differenceInMinutes(new Date(), new Date(todayRecord.clock_in_time))
      setElapsed(formatHHMM(mins))
    }, 1000)
    return () => clearInterval(interval)
  }, [todayRecord])

  const loadData = useCallback(async (uid: string) => {
    const [{ data: myProjects }, { data: todayAtt }, { data: hist }] = await Promise.all([
      supabase.from('project_employees').select('projects(id,name,project_number)')
        .eq('employee_id', uid).is('released_date', null),
      supabase.from('attendance').select('*,projects(name)').eq('employee_id', uid).eq('date', today).maybeSingle(),
      supabase.from('attendance').select('*,projects(name)').eq('employee_id', uid)
        .order('date', { ascending: false }).limit(10),
    ])
    if (myProjects) {
      const proj = (myProjects as unknown as { projects: Project | null }[]).map(r => r.projects).filter(Boolean) as Project[]
      setProjects(proj)
    }
    if (todayAtt) setTodayRecord(todayAtt as AttendanceRecord)
    if (hist)     setHistory(hist as AttendanceRecord[])
    setPageLoading(false)
  }, [today])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      loadData(user.id)
    })
  }, [loadData])

  const getLocation = (): Promise<GeolocationCoordinates> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'))
        return
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve(pos.coords),
        err => reject(new Error(`Location access denied: ${err.message}`)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      )
    })

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    }
  }

  const handleClockIn = async () => {
    if (!selectedProject) {
      setStatus('Please select a project/site before clocking in.')
      setStatusType('error')
      return
    }
    setLoading(true)
    setStatus('Getting your location…')
    setStatusType('info')

    try {
      const coords  = await getLocation()
      setStatus('Capturing address…')
      const address = await reverseGeocode(coords.latitude, coords.longitude)
      const now     = new Date().toISOString()

      const { data, error } = await supabase.from('attendance').insert({
        employee_id:       userId,
        project_id:        selectedProject,
        date:              today,
        clock_in_time:     now,
        clock_in_lat:      coords.latitude,
        clock_in_lng:      coords.longitude,
        clock_in_address:  address,
        attendance_status: 'present',
      }).select('*,projects(name)').single()

      if (error) throw new Error(error.message)
      setTodayRecord(data as AttendanceRecord)
      setStatus(`Clocked in at ${format(new Date(now), 'hh:mm a')}`)
      setStatusType('success')
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Clock-in failed')
      setStatusType('error')
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!todayRecord) return
    setLoading(true)
    setStatus('Getting your location…')
    setStatusType('info')

    try {
      const coords    = await getLocation()
      const now       = new Date()
      const totalMins = differenceInMinutes(now, new Date(todayRecord.clock_in_time))
      const totalHrs  = Math.round((totalMins / 60) * 100) / 100
      const overtime  = Math.max(0, Math.round(((totalMins - 480) / 60) * 100) / 100)

      const { data, error } = await supabase.from('attendance').update({
        clock_out_time: now.toISOString(),
        clock_out_lat:  coords.latitude,
        clock_out_lng:  coords.longitude,
        total_hours:    totalHrs,
        overtime_hours: overtime,
      }).eq('id', todayRecord.id).select('*,projects(name)').single()

      if (error) throw new Error(error.message)
      setTodayRecord(data as AttendanceRecord)
      setStatus(`Clocked out. Total: ${totalHrs.toFixed(1)} hrs worked.`)
      setStatusType('success')
      loadData(userId!)
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : 'Clock-out failed')
      setStatusType('error')
    } finally {
      setLoading(false)
    }
  }

  const isClockedIn   = !!todayRecord?.clock_in_time && !todayRecord.clock_out_time
  const isClockedOut  = !!todayRecord?.clock_out_time

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Attendance" subtitle="GPS Clock-In / Clock-Out" />

      <div className="flex-1 p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">

        {/* Clock-in card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Status strip */}
          <div className={`p-4 flex items-center gap-3 ${
            isClockedIn  ? 'bg-green-600'  :
            isClockedOut ? 'bg-slate-700'  : 'bg-amber-500'
          }`}>
            <MapPin size={20} className="text-white shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm">
                {isClockedIn
                  ? `Clocked In — ${elapsed || '…'} elapsed`
                  : isClockedOut
                    ? `Day Complete — ${todayRecord?.total_hours?.toFixed(1)} hrs worked`
                    : 'Not Clocked In Today'}
              </p>
              <p className="text-white/70 text-xs">
                {isClockedIn
                  ? `Since ${format(new Date(todayRecord!.clock_in_time), 'hh:mm a')}`
                  : isClockedOut
                    ? `${format(new Date(todayRecord!.clock_in_time), 'hh:mm a')} → ${format(new Date(todayRecord!.clock_out_time!), 'hh:mm a')}`
                    : format(new Date(), 'EEEE, dd MMMM yyyy')}
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {!isClockedOut && (
              <>
                {/* Project selector */}
                {!isClockedIn && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Select Project / Site <span className="text-red-500">*</span>
                    </label>
                    {projects.length === 0 ? (
                      <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3">
                        ⚠ You are not currently assigned to any project. Ask your manager to assign you.
                      </p>
                    ) : (
                      <select
                        value={selectedProject}
                        onChange={e => setSelectedProject(e.target.value)}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      >
                        <option value="">— Choose project/site —</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.project_number} — {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {isClockedIn && (
                  <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                    <p className="text-sm text-green-800 font-medium">
                      Project: {todayRecord?.projects?.name ?? 'Unknown'}
                    </p>
                    {todayRecord?.clock_in_address && (
                      <p className="text-xs text-green-600 mt-1 flex items-start gap-1">
                        <MapPin size={10} className="mt-0.5 shrink-0" />
                        {todayRecord.clock_in_address}
                      </p>
                    )}
                  </div>
                )}

                {/* Status message */}
                {status && (
                  <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${
                    statusType === 'success' ? 'bg-green-50 text-green-700 border border-green-100'
                    : statusType === 'error' ? 'bg-red-50 text-red-700 border border-red-100'
                    : 'bg-blue-50 text-blue-700 border border-blue-100'
                  }`}>
                    {statusType === 'success' ? <CheckCircle size={16} />
                    : statusType === 'error'  ? <AlertTriangle size={16} />
                    : <Clock size={16} />}
                    {status}
                  </div>
                )}

                {/* Action button */}
                <button
                  onClick={isClockedIn ? handleClockOut : handleClockIn}
                  disabled={loading || (!isClockedIn && !selectedProject)}
                  className={`w-full py-4 rounded-xl font-bold text-white text-lg transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg ${
                    isClockedIn
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-200'
                      : 'bg-green-600 hover:bg-green-700 shadow-green-200'
                  }`}
                >
                  {loading ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : isClockedIn ? (
                    <><LogOut size={22} /> Clock Out</>
                  ) : (
                    <><LogIn size={22} /> Clock In</>
                  )}
                </button>

                <p className="text-xs text-slate-400 text-center">
                  📍 Your GPS location will be captured when you clock in/out
                </p>
              </>
            )}

            {isClockedOut && (
              <div className="text-center py-4">
                <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
                <p className="text-slate-800 font-semibold">Great work today!</p>
                <p className="text-slate-500 text-sm mt-1">
                  You worked <strong>{todayRecord?.total_hours?.toFixed(1)} hours</strong> on {todayRecord?.projects?.name}
                </p>
                {status && (
                  <p className="text-green-600 text-sm mt-2">{status}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Attendance History */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <Clock size={16} className="text-green-600" /> Recent Attendance
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Date', 'Project', 'Clock In', 'Clock Out', 'Hours'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-400 text-sm">No attendance records yet</td>
                  </tr>
                ) : history.map(rec => (
                  <tr key={rec.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">{format(new Date(rec.date), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[120px]">{rec.projects?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{rec.clock_in_time ? format(new Date(rec.clock_in_time), 'hh:mm a') : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{rec.clock_out_time ? format(new Date(rec.clock_out_time), 'hh:mm a') : <span className="text-amber-500 text-xs">In progress…</span>}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{rec.total_hours != null ? `${rec.total_hours.toFixed(1)}h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
