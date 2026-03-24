'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { format } from 'date-fns'
import {
  ArrowLeft, CheckCircle, Clock, MapPin, User, Calendar,
  Plus, Camera, Trash2, ChevronDown, ChevronUp,
  Package, Users, Receipt, FlaskConical, ClipboardCheck,
  FileText, AlertTriangle, TrendingUp, IndianRupee
} from 'lucide-react'

// ─── TYPES ───────────────────────────────────────────────────

interface JobCard {
  id: string; job_card_number: string; role_in_project: string | null
  start_date: string | null; end_date: string | null; total_manhours: number
  status: string; current_stage: number; signoff_at: string | null
  completion_notes: string | null; customer_sign_off: boolean
  projects: { name: string; project_number: string; site_address: string | null; customer_name: string | null } | null
  employee: { full_name: string; designation: string | null } | null
}
interface Log      { id:string; log_date:string; log_time:string; work_description:string; materials_used:string|null; observations:string|null; photos:string[]|null; manhours:number }
interface Material { id:string; item_name:string; quantity:number; unit:string; unit_cost:number; total_cost:number; supplier:string|null; serial_number:string|null; issue_date:string; notes:string|null; issued_by_name?:string }
interface Manpower { id:string; work_date:string; check_in:string|null; check_out:string|null; hours_worked:number; role:string|null; work_summary:string|null; employee_name?:string }
interface Expense  { id:string; category:string; description:string; amount:number; expense_date:string; vendor:string|null; receipt_url:string|null; approved:boolean; recorded_by_name?:string }
interface TestResult { id:string; test_type:string; result:string; measured_value:string|null; expected_value:string|null; notes:string|null; photos:string[]|null; test_date:string; tested_by_name?:string }

// ─── CONSTANTS ───────────────────────────────────────────────

const STAGES = [
  { num:1, label:'Project\nApproved',   short:'Approved',    icon:'✅' },
  { num:2, label:'Job Card\nGenerated', short:'Generated',   icon:'📋' },
  { num:3, label:'Material\nIssued',    short:'Materials',   icon:'📦' },
  { num:4, label:'Installation\nWork',  short:'Install',     icon:'🔧' },
  { num:5, label:'Manpower\nRecording', short:'Manpower',    icon:'👷' },
  { num:6, label:'Expense\nRecording',  short:'Expenses',    icon:'💰' },
  { num:7, label:'System\nTesting',     short:'Testing',     icon:'🔬' },
  { num:8, label:'Project\nCompletion', short:'Completion',  icon:'🏁' },
  { num:9, label:'Job Card\nClosed',    short:'Closed',      icon:'🔒' },
]

const UNITS = ['pcs','nos','kg','g','m','ft','rolls','sets','boxes','litres','bags']
const MATERIAL_PRESETS = [
  'Panel','Inverter','Battery (48V)','Structure','DC Cable','AC Cable',
  'Earth Cable','LA (Lightning Arrester)','DCDB','Conduits','Transport',
  'Civil Block','Installation Charge','Other (Custom)',
]
const EXPENSE_CATEGORIES = ['Travel','Tools & Equipment','Safety Equipment','Miscellaneous Supplies','Food & Accommodation','Permits & Inspections','Subcontractor','Equipment Rental','Other']
const TEST_TYPES = ['String Test (Voc/Isc)','Inverter Power-On','Earthing/Grounding','Load Test','Insulation Resistance','Polarity Check','Grid Synchronisation','Visual Inspection','Performance Test','Emergency Shutdown Test']

// ─── HELPERS ─────────────────────────────────────────────────

function currency(n: number) { return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

function SectionHeader({ icon: Icon, title, count, color = 'text-green-600' }: { icon: React.ElementType; title: string; count?: number; color?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
      <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
        <Icon size={16} className={color} /> {title}
      </h3>
      {count !== undefined && <span className="text-xs text-slate-400">{count} {count === 1 ? 'entry' : 'entries'}</span>}
    </div>
  )
}

function EmptyState({ icon, message, sub }: { icon: string; message: string; sub?: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-3xl mb-2">{icon}</p>
      <p className="text-slate-400 text-sm">{message}</p>
      {sub && <p className="text-slate-300 text-xs mt-1">{sub}</p>}
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────

export default function JobCardDetailPage() {
  const params   = useParams()
  const supabase = createClient()
  const id       = params.id as string

  const [card,      setCard]      = useState<JobCard | null>(null)
  const [profile,   setProfile]   = useState<{ id: string; role: string; full_name: string } | null>(null)
  const [logs,      setLogs]      = useState<Log[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [manpower,  setManpower]  = useState<Manpower[]>([])
  const [expenses,  setExpenses]  = useState<Expense[]>([])
  const [tests,     setTests]     = useState<TestResult[]>([])
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState(2)
  const [toast,     setToast]     = useState('')
  const [toastType, setToastType] = useState<'success'|'error'>('success')
  const [advancing, setAdvancing] = useState(false)

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 4000)
  }

  const today   = format(new Date(), 'yyyy-MM-dd')
  const nowTime = format(new Date(), 'HH:mm')

  // ── LOAD ALL DATA ──────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [cardRes, logsRes, matRes, manRes, expRes, testRes, profRes] = await Promise.all([
      supabase.from('job_cards').select('id,job_card_number,role_in_project,start_date,end_date,total_manhours,status,current_stage,signoff_at,completion_notes,customer_sign_off,projects(name,project_number,site_address,customer_name),employee:employee_id(full_name,designation)').eq('id', id).single(),
      supabase.from('job_card_logs').select('id,log_date,log_time,work_description,materials_used,observations,photos,manhours').eq('job_card_id', id).order('log_date', { ascending: false }),
      supabase.from('job_card_materials').select('id,item_name,quantity,unit,unit_cost,total_cost,supplier,serial_number,issue_date,notes,issuer:issued_by(full_name)').eq('job_card_id', id).order('issue_date', { ascending: false }),
      supabase.from('job_card_manpower').select('id,work_date,check_in,check_out,hours_worked,role,work_summary,worker:employee_id(full_name)').eq('job_card_id', id).order('work_date', { ascending: false }),
      supabase.from('job_card_expenses').select('id,category,description,amount,expense_date,vendor,receipt_url,approved,recorder:recorded_by(full_name)').eq('job_card_id', id).order('expense_date', { ascending: false }),
      supabase.from('job_card_tests').select('id,test_type,result,measured_value,expected_value,notes,photos,test_date,tester:tested_by(full_name)').eq('job_card_id', id).order('test_date', { ascending: false }),
      supabase.from('profiles').select('id,role,full_name').eq('id', user.id).single(),
    ])

    if (cardRes.data) setCard(cardRes.data as unknown as JobCard)
    if (logsRes.data) setLogs(logsRes.data as unknown as Log[])
    if (matRes.data)  setMaterials((matRes.data as unknown as { issuer: { full_name: string } | null }[]).map((r: any) => ({ ...r, issued_by_name: r.issuer?.full_name })))
    if (manRes.data)  setManpower((manRes.data as unknown as { worker: { full_name: string } | null }[]).map((r: any) => ({ ...r, employee_name: r.worker?.full_name })))
    if (expRes.data)  setExpenses((expRes.data as unknown as { recorder: { full_name: string } | null }[]).map((r: any) => ({ ...r, recorded_by_name: r.recorder?.full_name })))
    if (testRes.data) setTests((testRes.data as unknown as { tester: { full_name: string } | null }[]).map((r: any) => ({ ...r, tested_by_name: r.tester?.full_name })))
    if (profRes.data) setProfile(profRes.data as { id: string; role: string; full_name: string })
    setLoading(false)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  const isManager = profile?.role !== 'employee'
  const isActive  = card?.status === 'active'

  // ── ADVANCE STAGE ──────────────────────────────────────────
  const handleAdvanceStage = async () => {
    if (!card || card.current_stage >= 9) return
    setAdvancing(true)
    const nextStage = card.current_stage + 1
    const updates: Record<string, unknown> = { current_stage: nextStage }
    if (nextStage === 9) { updates.status = 'completed'; updates.end_date = today; updates.signoff_at = new Date().toISOString() }
    await supabase.from('job_cards').update(updates).eq('id', id)
    setCard(prev => prev ? { ...prev, current_stage: nextStage, status: nextStage === 9 ? 'completed' : prev.status } : prev)
    setActiveTab(nextStage)
    showToast(`Advanced to: ${STAGES[nextStage - 1].short}`)
    setAdvancing(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!card) return <div className="flex items-center justify-center h-screen"><p className="text-slate-400">Job card not found.</p></div>

  const totalMaterialCost = materials.reduce((s, m) => s + (m.total_cost || 0), 0)
  const totalExpenses      = expenses.reduce((s, e) => s + e.amount, 0)
  const totalManHours      = manpower.reduce((s, m) => s + m.hours_worked, 0)
  const testsPassed        = tests.filter(t => t.result === 'pass').length

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/staff/job-cards" className="p-2 hover:bg-slate-100 rounded-lg transition shrink-0">
              <ArrowLeft size={18} className="text-slate-600" />
            </Link>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-mono truncate">{card.job_card_number}</p>
              <h1 className="text-sm font-bold text-slate-900 truncate">{card.projects?.name ?? 'Job Card'}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${card.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {card.status.toUpperCase()}
            </span>
            {isManager && isActive && card.current_stage < 9 && (
              <button onClick={handleAdvanceStage} disabled={advancing}
                className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition flex items-center gap-1.5">
                {advancing ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                Next Stage →
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 ${toastType === 'success' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
          {toastType === 'success' ? <CheckCircle size={15} /> : <AlertTriangle size={15} />} {toast}
        </div>
      )}

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-5 space-y-5">

        {/* ── STAGE PROGRESS BAR ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 overflow-x-auto">
          <div className="flex items-center min-w-max gap-0">
            {STAGES.map((stage, idx) => {
              const done    = card.current_stage > stage.num
              const current = card.current_stage === stage.num
              const future  = card.current_stage < stage.num
              return (
                <div key={stage.num} className="flex items-center">
                  <button onClick={() => setActiveTab(stage.num)}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition cursor-pointer ${activeTab === stage.num ? 'bg-green-50 ring-2 ring-green-500' : 'hover:bg-slate-50'}`}>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold transition ${
                      done    ? 'bg-green-500 text-white' :
                      current ? 'bg-green-600 text-white ring-4 ring-green-100' :
                                'bg-slate-100 text-slate-400'
                    }`}>
                      {done ? '✓' : stage.icon}
                    </div>
                    <span className={`text-[10px] font-semibold text-center leading-tight whitespace-nowrap ${
                      done ? 'text-green-600' : current ? 'text-green-700' : 'text-slate-400'
                    }`}>
                      {stage.short}
                    </span>
                  </button>
                  {idx < STAGES.length - 1 && (
                    <div className={`w-6 h-0.5 mx-0.5 ${card.current_stage > stage.num ? 'bg-green-400' : 'bg-slate-200'}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── QUICK STATS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Hours',   value: `${card.total_manhours.toFixed(1)}h`,  icon: Clock,    color: 'bg-blue-50 text-blue-600' },
            { label: 'Material Cost', value: currency(totalMaterialCost),            icon: Package,  color: 'bg-amber-50 text-amber-600' },
            { label: 'Total Expense', value: currency(totalExpenses),                icon: IndianRupee, color: 'bg-red-50 text-red-600' },
            { label: 'Tests Passed',  value: `${testsPassed}/${tests.length}`,       icon: FlaskConical, color: 'bg-green-50 text-green-600' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-4 flex items-center gap-3 ${s.color.split(' ')[0]} border border-slate-100`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon size={16} />
              </div>
              <div>
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="text-sm font-bold text-slate-800">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── STAGE CONTENT ── */}

        {/* STAGE 1 & 2 — Info */}
        {(activeTab === 1 || activeTab === 2) && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <SectionHeader icon={FileText} title={activeTab === 1 ? 'Project Approval Details' : 'Job Card Details'} />
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Job Card No.',   value: card.job_card_number },
                { label: 'Project',        value: card.projects?.name ?? '—' },
                { label: 'Project No.',    value: card.projects?.project_number ?? '—' },
                { label: 'Customer',       value: card.projects?.customer_name ?? '—' },
                { label: 'Site Address',   value: card.projects?.site_address ?? '—' },
                { label: 'Assigned To',    value: card.employee?.full_name ?? '—' },
                { label: 'Role',           value: card.role_in_project ?? '—' },
                { label: 'Start Date',     value: card.start_date ? format(new Date(card.start_date), 'dd MMM yyyy') : '—' },
                { label: 'Status',         value: card.status.toUpperCase() },
                { label: 'Current Stage',  value: STAGES[(card.current_stage ?? 2) - 1]?.label.replace('\n', ' ') ?? '—' },
              ].map(item => (
                <div key={item.label} className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">{item.label}</p>
                  <p className="text-sm font-semibold text-slate-800">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STAGE 3 — Materials */}
        {activeTab === 3 && (
          <StageSection title="Material Issuance" icon={Package} count={materials.length}
            isEmpty={materials.length === 0} emptyIcon="📦" emptyMsg="No materials issued yet" emptySub="Add materials issued for this job"
            canAdd={isActive} addLabel="Add Material"
            form={(onClose) => <MaterialForm jobCardId={id} userId={profile?.id ?? ''} onSuccess={() => { showToast('Material added!'); loadAll(); onClose() }} />}
          >
            <div className="divide-y divide-slate-50">
              {materials.map(m => (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{m.item_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {m.quantity} {m.unit} {m.unit_cost > 0 && `× ${currency(m.unit_cost)} = `}
                        {m.unit_cost > 0 && <span className="font-semibold text-slate-700">{currency(m.total_cost)}</span>}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{format(new Date(m.issue_date), 'dd MMM')}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
                    {m.supplier && <span>🏪 {m.supplier}</span>}
                    {m.serial_number && <span>🔖 {m.serial_number}</span>}
                    {m.issued_by_name && <span>👤 {m.issued_by_name}</span>}
                    {m.notes && <span className="text-slate-500 italic">{m.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
            {materials.length > 0 && (
              <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-700">Total Material Cost</span>
                <span className="text-sm font-bold text-amber-700">{currency(totalMaterialCost)}</span>
              </div>
            )}
          </StageSection>
        )}

        {/* STAGE 4 — Installation Work Logs */}
        {activeTab === 4 && (
          <StageSection title="Installation Work Log" icon={TrendingUp} count={logs.length}
            isEmpty={logs.length === 0} emptyIcon="🔧" emptyMsg="No work logs yet" emptySub="Log daily installation progress"
            canAdd={isActive} addLabel="Add Daily Log"
            form={(onClose) => <WorkLogForm jobCardId={id} userId={profile?.id ?? ''} totalHours={card.total_manhours} onSuccess={(hrs) => { showToast('Work logged!'); setCard(p => p ? { ...p, total_manhours: p.total_manhours + hrs } : p); loadAll(); onClose() }} />}
          >
            <div className="divide-y divide-slate-50">
              {logs.map(log => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          </StageSection>
        )}

        {/* STAGE 5 — Manpower */}
        {activeTab === 5 && (
          <StageSection title="Manpower Recording" icon={Users} count={manpower.length}
            isEmpty={manpower.length === 0} emptyIcon="👷" emptyMsg="No manpower entries yet" emptySub="Record daily manpower on site"
            canAdd={isActive} addLabel="Add Entry"
            form={(onClose) => <ManpowerForm jobCardId={id} userId={profile?.id ?? ''} onSuccess={() => { showToast('Manpower recorded!'); loadAll(); onClose() }} />}
          >
            <div className="divide-y divide-slate-50">
              {manpower.map(m => (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{m.employee_name ?? '—'}</p>
                      <p className="text-xs text-slate-500">{m.role ?? 'Worker'} · <span className="font-semibold text-blue-600">{m.hours_worked}h</span></p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{format(new Date(m.work_date), 'dd MMM')}</span>
                  </div>
                  {m.work_summary && <p className="text-xs text-slate-500 mt-1 italic">{m.work_summary}</p>}
                  {(m.check_in || m.check_out) && (
                    <p className="text-xs text-slate-400 mt-1">⏰ {m.check_in ?? '—'} → {m.check_out ?? '—'}</p>
                  )}
                </div>
              ))}
            </div>
            {manpower.length > 0 && (
              <div className="px-5 py-3 bg-blue-50 border-t border-blue-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700">Total Manpower Hours</span>
                <span className="text-sm font-bold text-blue-700">{totalManHours.toFixed(1)}h</span>
              </div>
            )}
          </StageSection>
        )}

        {/* STAGE 6 — Expenses */}
        {activeTab === 6 && (
          <StageSection title="Expense Recording" icon={Receipt} count={expenses.length}
            isEmpty={expenses.length === 0} emptyIcon="💰" emptyMsg="No expenses recorded yet" emptySub="Track all project expenses here"
            canAdd={isActive} addLabel="Add Expense"
            form={(onClose) => <ExpenseForm jobCardId={id} userId={profile?.id ?? ''} supabase={supabase} onSuccess={() => { showToast('Expense recorded!'); loadAll(); onClose() }} />}
          >
            <div className="divide-y divide-slate-50">
              {expenses.map(exp => (
                <div key={exp.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-full">{exp.category}</span>
                        {exp.approved && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold rounded-full">Approved</span>}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-1">{exp.description}</p>
                      {exp.vendor && <p className="text-xs text-slate-400">🏪 {exp.vendor}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-red-600">{currency(exp.amount)}</p>
                      <p className="text-xs text-slate-400">{format(new Date(exp.expense_date), 'dd MMM')}</p>
                    </div>
                  </div>
                  {exp.receipt_url && (
                    <a href={exp.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline mt-1 block">📎 View Receipt</a>
                  )}
                  {isManager && !exp.approved && (
                    <button onClick={async () => {
                      await supabase.from('job_card_expenses').update({ approved: true }).eq('id', exp.id)
                      showToast('Expense approved!'); loadAll()
                    }} className="mt-2 px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-200 transition">
                      ✓ Approve
                    </button>
                  )}
                </div>
              ))}
            </div>
            {expenses.length > 0 && (
              <div className="px-5 py-3 bg-red-50 border-t border-red-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-red-700">Total Expenses</span>
                <span className="text-sm font-bold text-red-700">{currency(totalExpenses)}</span>
              </div>
            )}
          </StageSection>
        )}

        {/* STAGE 7 — System Testing */}
        {activeTab === 7 && (
          <StageSection title="System Testing" icon={FlaskConical} count={tests.length}
            isEmpty={tests.length === 0} emptyIcon="🔬" emptyMsg="No tests recorded yet" emptySub="Record commissioning and test results"
            canAdd={isActive} addLabel="Add Test Result"
            form={(onClose) => <TestForm jobCardId={id} userId={profile?.id ?? ''} supabase={supabase} onSuccess={() => { showToast('Test recorded!'); loadAll(); onClose() }} />}
          >
            <div className="divide-y divide-slate-50">
              {tests.map(t => (
                <div key={t.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{t.test_type}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.result === 'pass' ? 'bg-green-100 text-green-700' :
                          t.result === 'fail' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{t.result.toUpperCase()}</span>
                        {t.measured_value && <span className="text-xs text-slate-500">Measured: <strong>{t.measured_value}</strong></span>}
                        {t.expected_value && <span className="text-xs text-slate-500">Expected: <strong>{t.expected_value}</strong></span>}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{format(new Date(t.test_date), 'dd MMM')}</span>
                  </div>
                  {t.notes && <p className="text-xs text-slate-500 mt-1 italic">{t.notes}</p>}
                  {t.photos && t.photos.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {t.photos.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </StageSection>
        )}

        {/* STAGE 8 — Project Completion */}
        {activeTab === 8 && (
          <CompletionStage card={card} isManager={isManager} supabase={supabase}
            onSuccess={() => { showToast('Completion details saved!'); loadAll() }} />
        )}

        {/* STAGE 9 — Job Card Closed */}
        {activeTab === 9 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <SectionHeader icon={CheckCircle} title="Job Card Sign-Off" color="text-blue-600" />
            <div className="p-6 space-y-4">
              {card.status === 'completed' && card.signoff_at ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
                  <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
                  <p className="font-bold text-green-800 text-lg">Job Card Closed</p>
                  <p className="text-green-600 text-sm mt-1">Signed off on {format(new Date(card.signoff_at), 'dd MMM yyyy, hh:mm a')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-800 font-semibold">⚠️ Job card not yet closed</p>
                    <p className="text-xs text-amber-600 mt-1">Complete all previous stages before closing this job card.</p>
                  </div>
                  {isManager && (
                    <button onClick={async () => {
                      await supabase.from('job_cards').update({ status: 'completed', current_stage: 9, signoff_at: new Date().toISOString(), end_date: today }).eq('id', id)
                      showToast('Job card closed successfully!'); loadAll()
                    }} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2">
                      <CheckCircle size={18} /> Close & Sign Off Job Card
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── STAGE SECTION WRAPPER ────────────────────────────────────

function StageSection({ title, icon: Icon, count, isEmpty, emptyIcon, emptyMsg, emptySub, canAdd, addLabel, form, children }: {
  title: string; icon: React.ElementType; count: number
  isEmpty: boolean; emptyIcon: string; emptyMsg: string; emptySub?: string
  canAdd: boolean; addLabel: string
  form: (onClose: () => void) => React.ReactNode
  children?: React.ReactNode
}) {
  const [showForm, setShowForm] = useState(false)
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
          <Icon size={16} className="text-green-600" /> {title}
          <span className="text-xs text-slate-400 font-normal">({count})</span>
        </h3>
        {canAdd && (
          <button onClick={() => setShowForm(!showForm)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${showForm ? 'bg-slate-200 text-slate-700' : 'bg-green-600 text-white hover:bg-green-700'}`}>
            <Plus size={13} /> {showForm ? 'Cancel' : addLabel}
          </button>
        )}
      </div>
      {showForm && (
        <div className="border-b border-slate-100 p-5 bg-slate-50">
          {form(() => setShowForm(false))}
        </div>
      )}
      {isEmpty && !showForm ? <EmptyState icon={emptyIcon} message={emptyMsg} sub={emptySub} /> : children}
    </div>
  )
}

// ─── MATERIAL FORM ────────────────────────────────────────────

function MaterialForm({ jobCardId, userId, onSuccess }: { jobCardId: string; userId: string; onSuccess: () => void }) {
  const supabase = createClient()
  const [selected,    setSelected]    = useState('')
  const [customName,  setCustomName]  = useState('')
  // Panel-specific fields
  const [panelCount,  setPanelCount]  = useState('')
  const [panelWatts,  setPanelWatts]  = useState('')  // Wp per panel
  const [pricePerWp,  setPricePerWp]  = useState('')  // ₹/Wp
  // Common fields
  const [form, setForm] = useState({ quantity:'', unit:'pcs', unit_cost:'', supplier:'', serial_number:'', issue_date: format(new Date(),'yyyy-MM-dd'), notes:'' })
  const [saving, setSaving] = useState(false)

  const isPanel  = selected === 'Panel'
  const isCustom = selected === 'Other (Custom)'
  const finalName = isCustom ? customName : selected

  // Panel auto-calculations
  const totalWp      = panelCount && panelWatts ? parseFloat(panelCount) * parseFloat(panelWatts) : 0
  const panelTotalCost = totalWp && pricePerWp ? totalWp * parseFloat(pricePerWp) : 0

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!finalName.trim()) return
    setSaving(true)

    let insertData: Record<string, unknown>
    if (isPanel) {
      // Store: quantity = totalWp, unit = Wp, unit_cost = price/Wp
      insertData = {
        job_card_id: jobCardId, issued_by: userId,
        item_name:   `Panel (${panelCount} nos × ${panelWatts}Wp)`,
        quantity:    totalWp,
        unit:        'Wp',
        unit_cost:   parseFloat(pricePerWp) || 0,
        supplier:    form.supplier  || null,
        serial_number: form.serial_number || null,
        issue_date:  form.issue_date,
        notes:       form.notes ? `${panelCount} panels × ${panelWatts}Wp each. ${form.notes}` : `${panelCount} panels × ${panelWatts}Wp each`,
      }
    } else {
      insertData = {
        job_card_id: jobCardId, issued_by: userId,
        item_name:   finalName.trim(),
        quantity:    parseFloat(form.quantity),
        unit:        form.unit,
        unit_cost:   parseFloat(form.unit_cost) || 0,
        supplier:    form.supplier  || null,
        serial_number: form.serial_number || null,
        issue_date:  form.issue_date,
        notes:       form.notes || null,
      }
    }

    const { error } = await supabase.from('job_card_materials').insert(insertData)
    if (!error) {
      onSuccess()
      setSelected(''); setCustomName('')
      setPanelCount(''); setPanelWatts(''); setPricePerWp('')
      setForm({ quantity:'', unit:'pcs', unit_cost:'', supplier:'', serial_number:'', issue_date: format(new Date(),'yyyy-MM-dd'), notes:'' })
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handle} className="space-y-3">
      {/* Item selection */}
      <div>
        <label className={LBL}>Item Name *</label>
        <select required value={selected} onChange={e => setSelected(e.target.value)} className={INPUT}>
          <option value="">— Select material —</option>
          {MATERIAL_PRESETS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {isCustom && (
        <div>
          <label className={LBL}>Custom Item Name *</label>
          <input required value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Enter material name…" className={INPUT} />
        </div>
      )}

      {/* ── PANEL MODE — special Wp pricing ── */}
      {isPanel && (
        <>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-yellow-800 mb-0.5">☀️ Solar Panel — Watt-Peak Pricing</p>
            <p className="text-[11px] text-yellow-700">Enter number of panels, wattage per panel, and price per Wp.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LBL}>No. of Panels *</label>
              <input required type="number" min="1" step="1" value={panelCount} onChange={e => setPanelCount(e.target.value)} placeholder="e.g. 10" className={INPUT} />
            </div>
            <div>
              <label className={LBL}>Watts per Panel (Wp) *</label>
              <input required type="number" min="1" step="1" value={panelWatts} onChange={e => setPanelWatts(e.target.value)} placeholder="e.g. 400" className={INPUT} />
            </div>
            <div>
              <label className={LBL}>Price per Wp (₹) *</label>
              <input required type="number" min="0" step="0.01" value={pricePerWp} onChange={e => setPricePerWp(e.target.value)} placeholder="e.g. 25" className={INPUT} />
            </div>
          </div>
          {totalWp > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <p className="text-[10px] text-amber-600 uppercase tracking-wide">Total Capacity</p>
                <p className="font-bold text-amber-800">{totalWp.toLocaleString()} Wp</p>
                <p className="text-[10px] text-amber-500">({(totalWp/1000).toFixed(2)} kWp)</p>
              </div>
              <div>
                <p className="text-[10px] text-amber-600 uppercase tracking-wide">Rate</p>
                <p className="font-bold text-amber-800">₹{pricePerWp || 0}/Wp</p>
              </div>
              <div>
                <p className="text-[10px] text-amber-600 uppercase tracking-wide">Total Cost</p>
                <p className="font-bold text-amber-800">{currency(panelTotalCost)}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── STANDARD MODE ── */}
      {!isPanel && selected && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LBL}>Quantity *</label>
            <div className="flex gap-2">
              <input required type="number" step="0.01" min="0" value={form.quantity} onChange={e=>setForm(p=>({...p,quantity:e.target.value}))} placeholder="e.g. 10" className={`${INPUT} flex-1`} />
              <select value={form.unit} onChange={e=>setForm(p=>({...p,unit:e.target.value}))} className={`${INPUT} w-24`}>
                {UNITS.map(u=><option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LBL}>Unit Cost (₹)</label>
            <input type="number" step="0.01" min="0" value={form.unit_cost} onChange={e=>setForm(p=>({...p,unit_cost:e.target.value}))} placeholder="0.00" className={INPUT} />
          </div>
          {form.quantity && form.unit_cost && (
            <div className="sm:col-span-2 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2 flex items-center justify-between text-sm">
              <span className="text-amber-700">Total Cost</span>
              <span className="font-bold text-amber-800">{currency(parseFloat(form.quantity) * parseFloat(form.unit_cost))}</span>
            </div>
          )}
        </div>
      )}

      {/* Common fields — shown for all items once selected */}
      {selected && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LBL}>Supplier</label>
            <input value={form.supplier} onChange={e=>setForm(p=>({...p,supplier:e.target.value}))} placeholder="Supplier name" className={INPUT} />
          </div>
          <div>
            <label className={LBL}>Serial / Batch No.</label>
            <input value={form.serial_number} onChange={e=>setForm(p=>({...p,serial_number:e.target.value}))} placeholder="Optional" className={INPUT} />
          </div>
          <div>
            <label className={LBL}>Issue Date</label>
            <input type="date" value={form.issue_date} onChange={e=>setForm(p=>({...p,issue_date:e.target.value}))} className={INPUT} />
          </div>
          <div>
            <label className={LBL}>Notes</label>
            <input value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Optional notes" className={INPUT} />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={saving || !selected} className={BTN}>{saving ? 'Saving…' : 'Add Material'}</button>
      </div>
    </form>
  )
}

// ─── WORK LOG FORM ────────────────────────────────────────────

function WorkLogForm({ jobCardId, userId, totalHours, onSuccess }: { jobCardId:string; userId:string; totalHours:number; onSuccess:(hrs:number)=>void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ log_date:format(new Date(),'yyyy-MM-dd'), log_time:format(new Date(),'HH:mm'), manhours:'', work_description:'', materials_used:'', observations:'', photos:[] as File[] })
  const [saving,    setSaving]    = useState(false)
  const [uploading, setUploading] = useState(false)
  const handle = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const urls: string[] = []
    if (form.photos.length > 0) {
      setUploading(true)
      for (const file of form.photos) {
        const path = `${jobCardId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`
        const { error: upErr } = await supabase.storage.from('job-card-photos').upload(path, file)
        if (!upErr) { const { data } = supabase.storage.from('job-card-photos').getPublicUrl(path); urls.push(data.publicUrl) }
      }
      setUploading(false)
    }
    const hrs = parseFloat(form.manhours)||0
    await supabase.from('job_card_logs').insert({ job_card_id:jobCardId, employee_id:userId, log_date:form.log_date, log_time:form.log_time, work_description:form.work_description, materials_used:form.materials_used||null, observations:form.observations||null, photos:urls.length>0?urls:null, manhours:hrs })
    if (hrs>0) await supabase.from('job_cards').update({ total_manhours: totalHours+hrs }).eq('id',jobCardId)
    onSuccess(hrs); setForm({ log_date:format(new Date(),'yyyy-MM-dd'), log_time:format(new Date(),'HH:mm'), manhours:'', work_description:'', materials_used:'', observations:'', photos:[] })
    setSaving(false)
  }
  return (
    <form onSubmit={handle} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div><label className={LBL}>Date</label><input type="date" value={form.log_date} onChange={e=>setForm(p=>({...p,log_date:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Time</label><input type="time" value={form.log_time} onChange={e=>setForm(p=>({...p,log_time:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Hours</label><input type="number" step="0.5" min="0" max="24" value={form.manhours} onChange={e=>setForm(p=>({...p,manhours:e.target.value}))} placeholder="4.5" className={INPUT} /></div>
      </div>
      <div><label className={LBL}>Work Done Today *</label><textarea required rows={3} value={form.work_description} onChange={e=>setForm(p=>({...p,work_description:e.target.value}))} placeholder="Describe work completed…" className={`${INPUT} resize-none`} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={LBL}>Materials Used</label><textarea rows={2} value={form.materials_used} onChange={e=>setForm(p=>({...p,materials_used:e.target.value}))} placeholder="Materials & quantities…" className={`${INPUT} resize-none`} /></div>
        <div><label className={LBL}>Observations / Issues</label><textarea rows={2} value={form.observations} onChange={e=>setForm(p=>({...p,observations:e.target.value}))} placeholder="Issues, delays, notes…" className={`${INPUT} resize-none`} /></div>
      </div>
      <div>
        <label className={LBL}>Site Photos</label>
        <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50 transition">
          <Camera size={18} className="text-slate-400" /><span className="text-sm text-slate-500">Click to select photos</span>
          <input type="file" multiple accept="image/*" onChange={e=>e.target.files&&setForm(p=>({...p,photos:[...p.photos,...Array.from(e.target.files!)]}))} className="hidden" />
        </label>
        {form.photos.length>0&&<div className="flex flex-wrap gap-2 mt-2">{form.photos.map((f,i)=>(
          <div key={i} className="relative group">
            <img src={URL.createObjectURL(f)} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
            <button type="button" onClick={()=>setForm(p=>({...p,photos:p.photos.filter((_,j)=>j!==i)}))} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 size={9}/></button>
          </div>
        ))}</div>}
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving||uploading} className={BTN}>{uploading?'Uploading…':saving?'Saving…':'Save Log'}</button></div>
    </form>
  )
}

// ─── MANPOWER FORM ────────────────────────────────────────────

function ManpowerForm({ jobCardId, userId, onSuccess }: { jobCardId:string; userId:string; onSuccess:()=>void }) {
  const supabase = createClient()
  const [profiles, setProfiles] = useState<{id:string;full_name:string}[]>([])
  const [form, setForm] = useState({ employee_id: userId, work_date:format(new Date(),'yyyy-MM-dd'), check_in:'', check_out:'', hours_worked:'', role:'', work_summary:'' })
  const [saving, setSaving] = useState(false)
  useEffect(() => { supabase.from('profiles').select('id,full_name').eq('status','active').order('full_name').then(({data})=>{ if(data) setProfiles(data as {id:string;full_name:string}[]) }) },[])
  const handle = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    await supabase.from('job_card_manpower').insert({ job_card_id:jobCardId, employee_id:form.employee_id, work_date:form.work_date, check_in:form.check_in||null, check_out:form.check_out||null, hours_worked:parseFloat(form.hours_worked), role:form.role||null, work_summary:form.work_summary||null })
    onSuccess(); setForm({ employee_id:userId, work_date:format(new Date(),'yyyy-MM-dd'), check_in:'', check_out:'', hours_worked:'', role:'', work_summary:'' })
    setSaving(false)
  }
  return (
    <form onSubmit={handle} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={LBL}>Worker</label>
          <select value={form.employee_id} onChange={e=>setForm(p=>({...p,employee_id:e.target.value}))} className={INPUT}>
            {profiles.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div><label className={LBL}>Date</label><input type="date" value={form.work_date} onChange={e=>setForm(p=>({...p,work_date:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Check In</label><input type="time" value={form.check_in} onChange={e=>setForm(p=>({...p,check_in:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Check Out</label><input type="time" value={form.check_out} onChange={e=>setForm(p=>({...p,check_out:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Hours Worked *</label><input required type="number" step="0.5" min="0" value={form.hours_worked} onChange={e=>setForm(p=>({...p,hours_worked:e.target.value}))} placeholder="8" className={INPUT} /></div>
        <div><label className={LBL}>Role</label><input value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} placeholder="e.g. Electrician" className={INPUT} /></div>
        <div className="sm:col-span-2"><label className={LBL}>Work Summary</label><textarea rows={2} value={form.work_summary} onChange={e=>setForm(p=>({...p,work_summary:e.target.value}))} placeholder="Summary of work done…" className={`${INPUT} resize-none`} /></div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className={BTN}>{saving?'Saving…':'Record Manpower'}</button></div>
    </form>
  )
}

// ─── EXPENSE FORM ─────────────────────────────────────────────

function ExpenseForm({ jobCardId, userId, supabase, onSuccess }: { jobCardId:string; userId:string; supabase:ReturnType<typeof createClient>; onSuccess:()=>void }) {
  const [form, setForm] = useState({ category:EXPENSE_CATEGORIES[0], description:'', amount:'', expense_date:format(new Date(),'yyyy-MM-dd'), vendor:'', receipt:null as File|null })
  const [saving, setSaving] = useState(false)
  const handle = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    let receiptUrl = null
    if (form.receipt) {
      const path = `receipts/${jobCardId}/${Date.now()}.${form.receipt.name.split('.').pop()}`
      const { error:upErr } = await supabase.storage.from('job-card-photos').upload(path, form.receipt)
      if (!upErr) { const { data } = supabase.storage.from('job-card-photos').getPublicUrl(path); receiptUrl = data.publicUrl }
    }
    await supabase.from('job_card_expenses').insert({ job_card_id:jobCardId, recorded_by:userId, category:form.category, description:form.description, amount:parseFloat(form.amount), expense_date:form.expense_date, vendor:form.vendor||null, receipt_url:receiptUrl })
    onSuccess(); setForm({ category:EXPENSE_CATEGORIES[0], description:'', amount:'', expense_date:format(new Date(),'yyyy-MM-dd'), vendor:'', receipt:null })
    setSaving(false)
  }
  return (
    <form onSubmit={handle} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={LBL}>Category</label>
          <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))} className={INPUT}>
            {EXPENSE_CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div><label className={LBL}>Amount (₹) *</label><input required type="number" step="0.01" min="0" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0.00" className={INPUT} /></div>
        <div className="sm:col-span-2"><label className={LBL}>Description *</label><input required value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Describe the expense…" className={INPUT} /></div>
        <div><label className={LBL}>Date</label><input type="date" value={form.expense_date} onChange={e=>setForm(p=>({...p,expense_date:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Vendor</label><input value={form.vendor} onChange={e=>setForm(p=>({...p,vendor:e.target.value}))} placeholder="Vendor name" className={INPUT} /></div>
        <div className="sm:col-span-2">
          <label className={LBL}>Receipt Photo</label>
          <label className="flex items-center gap-3 px-4 py-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition">
            <Camera size={16} className="text-slate-400" />
            <span className="text-sm text-slate-500">{form.receipt ? form.receipt.name : 'Upload receipt (optional)'}</span>
            <input type="file" accept="image/*,application/pdf" onChange={e=>setForm(p=>({...p,receipt:e.target.files?.[0]||null}))} className="hidden" />
          </label>
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className={BTN}>{saving?'Saving…':'Record Expense'}</button></div>
    </form>
  )
}

// ─── TEST FORM ────────────────────────────────────────────────

function TestForm({ jobCardId, userId, supabase, onSuccess }: { jobCardId:string; userId:string; supabase:ReturnType<typeof createClient>; onSuccess:()=>void }) {
  const [form, setForm] = useState({ test_type:TEST_TYPES[0], result:'pass', measured_value:'', expected_value:'', notes:'', test_date:format(new Date(),'yyyy-MM-dd'), photos:[] as File[] })
  const [saving, setSaving] = useState(false)
  const handle = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    const urls: string[] = []
    for (const file of form.photos) {
      const path = `tests/${jobCardId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`
      const { error:upErr } = await supabase.storage.from('job-card-photos').upload(path, file)
      if (!upErr) { const { data } = supabase.storage.from('job-card-photos').getPublicUrl(path); urls.push(data.publicUrl) }
    }
    await supabase.from('job_card_tests').insert({ job_card_id:jobCardId, tested_by:userId, test_type:form.test_type, result:form.result, measured_value:form.measured_value||null, expected_value:form.expected_value||null, notes:form.notes||null, photos:urls.length>0?urls:null, test_date:form.test_date })
    onSuccess(); setForm({ test_type:TEST_TYPES[0], result:'pass', measured_value:'', expected_value:'', notes:'', test_date:format(new Date(),'yyyy-MM-dd'), photos:[] })
    setSaving(false)
  }
  return (
    <form onSubmit={handle} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={LBL}>Test Type *</label>
          <select value={form.test_type} onChange={e=>setForm(p=>({...p,test_type:e.target.value}))} className={INPUT}>
            {TEST_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
        </div>
        <div><label className={LBL}>Result *</label>
          <select value={form.result} onChange={e=>setForm(p=>({...p,result:e.target.value}))} className={INPUT}>
            <option value="pass">✅ Pass</option>
            <option value="fail">❌ Fail</option>
            <option value="conditional">⚠️ Conditional</option>
          </select>
        </div>
        <div><label className={LBL}>Measured Value</label><input value={form.measured_value} onChange={e=>setForm(p=>({...p,measured_value:e.target.value}))} placeholder="e.g. 48.5V, 10.2A" className={INPUT} /></div>
        <div><label className={LBL}>Expected Value</label><input value={form.expected_value} onChange={e=>setForm(p=>({...p,expected_value:e.target.value}))} placeholder="e.g. 48V ±5%" className={INPUT} /></div>
        <div><label className={LBL}>Test Date</label><input type="date" value={form.test_date} onChange={e=>setForm(p=>({...p,test_date:e.target.value}))} className={INPUT} /></div>
        <div><label className={LBL}>Notes</label><input value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Observations…" className={INPUT} /></div>
        <div className="sm:col-span-2">
          <label className={LBL}>Test Photos</label>
          <label className="flex items-center gap-3 px-4 py-2.5 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50 transition">
            <Camera size={16} className="text-slate-400" /><span className="text-sm text-slate-500">Upload test photos</span>
            <input type="file" multiple accept="image/*" onChange={e=>e.target.files&&setForm(p=>({...p,photos:[...p.photos,...Array.from(e.target.files!)]}))} className="hidden" />
          </label>
          {form.photos.length>0&&<div className="flex flex-wrap gap-2 mt-2">{form.photos.map((f,i)=>(
            <div key={i} className="relative group">
              <img src={URL.createObjectURL(f)} className="w-14 h-14 object-cover rounded-lg border" />
              <button type="button" onClick={()=>setForm(p=>({...p,photos:p.photos.filter((_,j)=>j!==i)}))} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 size={9}/></button>
            </div>
          ))}</div>}
        </div>
      </div>
      <div className="flex justify-end"><button type="submit" disabled={saving} className={BTN}>{saving?'Saving…':'Record Test'}</button></div>
    </form>
  )
}

// ─── COMPLETION STAGE ─────────────────────────────────────────

function CompletionStage({ card, isManager, supabase, onSuccess }: { card:JobCard; isManager:boolean; supabase:ReturnType<typeof createClient>; onSuccess:()=>void }) {
  const [notes, setNotes]   = useState(card.completion_notes ?? '')
  const [saving, setSaving] = useState(false)
  const CHECKLIST = ['All materials accounted for','Installation completed per specifications','All safety inspections passed','All test results documented & passed','Site cleaned up','Customer walkthrough completed','System operating normally','Emergency shutdown explained to customer','Warranty documents provided','Monitoring app access provided to customer']
  const [checked, setChecked] = useState<string[]>([])
  const toggle = (item: string) => setChecked(p => p.includes(item) ? p.filter(i=>i!==item) : [...p, item])
  const saveNotes = async () => {
    setSaving(true)
    await supabase.from('job_cards').update({ completion_notes: notes }).eq('id', card.id)
    onSuccess(); setSaving(false)
  }
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <SectionHeader icon={ClipboardCheck} title="Project Completion" color="text-green-600" />
      <div className="p-5 space-y-5">
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-3 uppercase tracking-wide">Completion Checklist</p>
          <div className="space-y-2">
            {CHECKLIST.map(item => (
              <label key={item} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition ${checked.includes(item) ? 'bg-green-50 border border-green-200' : 'bg-slate-50 border border-slate-100 hover:border-slate-200'}`}>
                <input type="checkbox" checked={checked.includes(item)} onChange={()=>toggle(item)} className="w-4 h-4 accent-green-600 rounded" />
                <span className={`text-sm ${checked.includes(item) ? 'text-green-800 font-medium' : 'text-slate-700'}`}>{item}</span>
                {checked.includes(item) && <CheckCircle size={14} className="text-green-500 ml-auto shrink-0" />}
              </label>
            ))}
          </div>
          <div className="mt-3 bg-slate-50 rounded-xl p-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">Completion Progress</span>
            <span className="text-xs font-bold text-green-700">{checked.length}/{CHECKLIST.length} items</span>
          </div>
          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(checked.length/CHECKLIST.length)*100}%` }} />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 mb-2 block uppercase tracking-wide">Completion Notes & Remarks</label>
          <textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Add final notes, remarks, or any pending items for handover…" className={`${INPUT} resize-none w-full`} />
          <div className="flex justify-end mt-2">
            <button onClick={saveNotes} disabled={saving} className={BTN}>{saving?'Saving…':'Save Notes'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── LOG ENTRY ────────────────────────────────────────────────

function LogEntry({ log }: { log: Log }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between cursor-pointer" onClick={()=>setOpen(!open)}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle size={14} className="text-green-600" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-slate-800">{format(new Date(log.log_date),'dd MMM yyyy')}</p>
              <span className="text-xs text-slate-400">{log.log_time?.slice(0,5)}</span>
              {log.manhours>0&&<span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">{log.manhours}h</span>}
              {log.photos&&log.photos.length>0&&<span className="text-xs text-blue-500">📷 {log.photos.length}</span>}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{log.work_description}</p>
          </div>
        </div>
        {open?<ChevronUp size={14} className="text-slate-400 shrink-0"/>:<ChevronDown size={14} className="text-slate-400 shrink-0"/>}
      </div>
      {open&&(
        <div className="mt-3 ml-11 space-y-2">
          <div className="bg-slate-50 rounded-xl p-3"><p className="text-xs font-semibold text-slate-500 mb-1">Work Done</p><p className="text-sm text-slate-700 whitespace-pre-line">{log.work_description}</p></div>
          {log.materials_used&&<div className="bg-amber-50 rounded-xl p-3"><p className="text-xs font-semibold text-amber-600 mb-1">Materials Used</p><p className="text-sm text-slate-700">{log.materials_used}</p></div>}
          {log.observations&&<div className="bg-blue-50 rounded-xl p-3"><p className="text-xs font-semibold text-blue-600 mb-1">Observations</p><p className="text-sm text-slate-700">{log.observations}</p></div>}
          {log.photos&&log.photos.length>0&&(
            <div><p className="text-xs font-semibold text-slate-500 mb-2">Photos</p>
              <div className="grid grid-cols-4 gap-2">
                {log.photos.map((url,i)=>(
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt="" className="w-full aspect-square object-cover rounded-xl border border-slate-200 hover:opacity-80 transition" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── STYLE CONSTANTS ─────────────────────────────────────────
const INPUT = 'w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white'
const LBL   = 'text-xs font-medium text-slate-600 mb-1 block'
const BTN   = 'px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition'
