'use client'

import { useEffect, useState, useCallback } from 'react'
import Header from '@/components/staff/Header'
import { Loader2, CheckCircle, AlertTriangle, Settings, Zap } from 'lucide-react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface PricingRule {
  id: string
  system_type: string
  consumer_type: string
  dcr_price_per_kw: number | null
  non_dcr_price_per_kw: number | null
  structure_cost_per_kw: number | null
  gst_percentage: number | null
  electricity_tariff: number | null
  subsidy_1kw: number | null
  subsidy_2kw: number | null
  subsidy_3kw: number | null
  updated_at: string | null
}

interface SharedConfig {
  id: string
  key: string
  value: string
  label: string
  description: string | null
}

// Local edit state mirrors PricingRule but with string inputs
type PricingRuleEdit = {
  id: string
  consumer_type: string
  dcr_price_per_kw: string
  non_dcr_price_per_kw: string
  structure_cost_per_kw: string
  gst_percentage: string
  electricity_tariff: string
  subsidy_1kw: string
  subsidy_2kw: string
  subsidy_3kw: string
  dirty: boolean
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SYSTEM_TABS = [
  { value: 'on_grid',    label: 'On-Grid'    },
  { value: 'hybrid',     label: 'Hybrid'     },
  { value: 'off_grid',   label: 'Off-Grid'   },
  { value: 'solar_pump', label: 'Solar Pump' },
]

const CONSUMER_TYPE_LABELS: Record<string, string> = {
  domestic:     'Domestic',
  commercial:   'Commercial',
  industrial:   'Industrial',
  institution:  'Institution',
  agricultural: 'Agricultural',
}

const SHARED_CONFIG_LABELS: Record<string, string> = {
  panel_brand:        'Panel Brand',
  inverter_brand:     'Inverter Brand',
  peak_sun_hours:     'Peak Sun Hours',
  system_efficiency:  'System Efficiency (%)',
  terms_conditions:   'Terms & Conditions',
  disclaimer:         'Disclaimer',
}

const INPUT_CLS = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none bg-white'
const INPUT_NUM = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none bg-white text-right'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function toEdit(rule: PricingRule): PricingRuleEdit {
  return {
    id:                   rule.id,
    consumer_type:        rule.consumer_type,
    dcr_price_per_kw:     rule.dcr_price_per_kw?.toString()     ?? '',
    non_dcr_price_per_kw: rule.non_dcr_price_per_kw?.toString() ?? '',
    structure_cost_per_kw:rule.structure_cost_per_kw?.toString() ?? '',
    gst_percentage:       rule.gst_percentage?.toString()        ?? '',
    electricity_tariff:   rule.electricity_tariff?.toString()    ?? '',
    subsidy_1kw:          rule.subsidy_1kw?.toString()           ?? '',
    subsidy_2kw:          rule.subsidy_2kw?.toString()           ?? '',
    subsidy_3kw:          rule.subsidy_3kw?.toString()           ?? '',
    dirty: false,
  }
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function PricingSettingsPage() {
  const [activeTab,     setActiveTab]     = useState('on_grid')
  const [allRules,      setAllRules]      = useState<PricingRule[]>([])
  const [editState,     setEditState]     = useState<PricingRuleEdit[]>([])
  const [sharedConfig,  setSharedConfig]  = useState<SharedConfig[]>([])
  const [configEdits,   setConfigEdits]   = useState<Record<string, string>>({})
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [savingConfig,  setSavingConfig]  = useState(false)
  const [toast,         setToast]         = useState('')
  const [toastType,     setToastType]     = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 4000)
  }

  // ── LOAD DATA ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [rulesRes, configRes] = await Promise.all([
        fetch('/api/pricing-rules'),
        fetch('/api/pricing-rules/config'),
      ])

      if (rulesRes.ok) {
        const { rules } = await rulesRes.json()
        const r = (rules ?? []) as PricingRule[]
        setAllRules(r)
        setEditState(r.map(toEdit))
      }

      if (configRes.ok) {
        const { config } = await configRes.json()
        const cfg = (config ?? []) as SharedConfig[]
        setSharedConfig(cfg)
        const edits: Record<string, string> = {}
        cfg.forEach((c: SharedConfig) => { edits[c.key] = c.value })
        setConfigEdits(edits)
      }
    } catch {
      showToast('Failed to load pricing settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── TAB RULES ───────────────────────────────────────────────
  const tabRules = editState.filter(r => {
    const orig = allRules.find(a => a.id === r.id)
    return orig?.system_type === activeTab
  })

  // ── FIELD CHANGE ────────────────────────────────────────────
  const handleFieldChange = (id: string, field: keyof Omit<PricingRuleEdit, 'id' | 'consumer_type' | 'dirty'>, value: string) => {
    setEditState(prev => prev.map(r => r.id === id ? { ...r, [field]: value, dirty: true } : r))
  }

  // ── SAVE TAB ────────────────────────────────────────────────
  const handleSaveTab = async () => {
    const dirtyRules = tabRules.filter(r => r.dirty)
    if (dirtyRules.length === 0) {
      showToast('No changes to save')
      return
    }
    setSaving(true)
    try {
      const results = await Promise.all(
        dirtyRules.map(rule => {
          const payload: Record<string, number | null> = {
            dcr_price_per_kw:     rule.dcr_price_per_kw     !== '' ? parseFloat(rule.dcr_price_per_kw)     : null,
            non_dcr_price_per_kw: rule.non_dcr_price_per_kw !== '' ? parseFloat(rule.non_dcr_price_per_kw) : null,
            structure_cost_per_kw:rule.structure_cost_per_kw !== '' ? parseFloat(rule.structure_cost_per_kw): null,
            gst_percentage:       rule.gst_percentage       !== '' ? parseFloat(rule.gst_percentage)       : null,
            electricity_tariff:   rule.electricity_tariff   !== '' ? parseFloat(rule.electricity_tariff)   : null,
            subsidy_1kw:          rule.subsidy_1kw           !== '' ? parseFloat(rule.subsidy_1kw)          : null,
            subsidy_2kw:          rule.subsidy_2kw           !== '' ? parseFloat(rule.subsidy_2kw)          : null,
            subsidy_3kw:          rule.subsidy_3kw           !== '' ? parseFloat(rule.subsidy_3kw)          : null,
          }
          return fetch(`/api/pricing-rules/${rule.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        })
      )
      const allOk = results.every(r => r.ok)
      if (!allOk) throw new Error('Some rules failed to save')
      showToast(`Saved ${dirtyRules.length} rule${dirtyRules.length > 1 ? 's' : ''} successfully`)
      // Mark as clean
      setEditState(prev => prev.map(r => ({ ...r, dirty: false })))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── SAVE CONFIG ─────────────────────────────────────────────
  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      const updates = sharedConfig.map(c => ({
        id: c.id,
        value: configEdits[c.key] ?? c.value,
      }))
      const results = await Promise.all(
        updates.map(u =>
          fetch(`/api/pricing-rules/config/${u.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: u.value }),
          })
        )
      )
      const allOk = results.every(r => r.ok)
      if (!allOk) throw new Error('Some config values failed to save')
      showToast('Configuration saved successfully')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  // ─── LOADING STATE ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <Header title="Pricing Engine Settings" subtitle="Configure auto-calculation rates for quotation estimates" />
        <div className="flex items-center justify-center flex-1">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  const dirtyCount = tabRules.filter(r => r.dirty).length

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Pricing Engine Settings" subtitle="Configure auto-calculation rates for quotation estimates" />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 ${toastType === 'success' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
          {toastType === 'success' ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
          {toast}
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">

        {/* Explanation */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Zap size={18} className="text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Pricing Engine</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Configure default pricing rates used to auto-calculate customer quotation estimates.
              These are preliminary estimates only — admin can override values on each quotation.
            </p>
          </div>
        </div>

        {/* System Type Tabs */}
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-100 shadow-sm w-fit">
          {SYSTEM_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === tab.value
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Pricing Rules Table */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-green-600" />
              <h3 className="font-semibold text-slate-900 text-sm">
                {SYSTEM_TABS.find(t => t.value === activeTab)?.label} — Pricing Rules
              </h3>
              {dirtyCount > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                  {dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={handleSaveTab}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save All
            </button>
          </div>

          {tabRules.length === 0 ? (
            <div className="text-center py-16">
              <Settings size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="text-slate-400 text-sm">No pricing rules configured for this system type.</p>
              <p className="text-slate-300 text-xs mt-1">Add rules via the database or API.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    {[
                      'Consumer Type',
                      'DCR Price/kW (₹)',
                      'Non-DCR Price/kW (₹)',
                      'Structure Cost/kW (₹)',
                      'GST (%)',
                      'Electricity Tariff (₹/kWh)',
                      'Subsidy 1kW (₹)',
                      'Subsidy 2kW (₹)',
                      'Subsidy 3kW (₹)',
                    ].map(h => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {tabRules.map(rule => (
                    <tr
                      key={rule.id}
                      className={`transition ${rule.dirty ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                    >
                      {/* Consumer Type — read-only */}
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-700 whitespace-nowrap">
                          {CONSUMER_TYPE_LABELS[rule.consumer_type] ?? rule.consumer_type}
                        </span>
                        {rule.dirty && (
                          <span className="ml-1.5 w-1.5 h-1.5 bg-amber-400 rounded-full inline-block align-middle" />
                        )}
                      </td>

                      <td className="px-4 py-3 min-w-[120px]">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={rule.dcr_price_per_kw}
                          onChange={e => handleFieldChange(rule.id, 'dcr_price_per_kw', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[130px]">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={rule.non_dcr_price_per_kw}
                          onChange={e => handleFieldChange(rule.id, 'non_dcr_price_per_kw', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[130px]">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={rule.structure_cost_per_kw}
                          onChange={e => handleFieldChange(rule.id, 'structure_cost_per_kw', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[90px]">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={rule.gst_percentage}
                          onChange={e => handleFieldChange(rule.id, 'gst_percentage', e.target.value)}
                          placeholder="12"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[140px]">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={rule.electricity_tariff}
                          onChange={e => handleFieldChange(rule.id, 'electricity_tariff', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[120px]">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={rule.subsidy_1kw}
                          onChange={e => handleFieldChange(rule.id, 'subsidy_1kw', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[120px]">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={rule.subsidy_2kw}
                          onChange={e => handleFieldChange(rule.id, 'subsidy_2kw', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>

                      <td className="px-4 py-3 min-w-[120px]">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={rule.subsidy_3kw}
                          onChange={e => handleFieldChange(rule.id, 'subsidy_3kw', e.target.value)}
                          placeholder="0"
                          className={INPUT_NUM}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Table footer hint */}
          {tabRules.length > 0 && (
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Edited rows are highlighted in amber. Click "Save All" to persist all changes for this tab.
              </p>
              <button
                onClick={handleSaveTab}
                disabled={saving || dirtyCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save All
              </button>
            </div>
          )}
        </div>

        {/* Shared Configuration */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-slate-500" />
              <h3 className="font-semibold text-slate-900 text-sm">Shared Configuration</h3>
            </div>
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig || sharedConfig.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 transition"
            >
              {savingConfig && <Loader2 size={14} className="animate-spin" />}
              Save Config
            </button>
          </div>

          {sharedConfig.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-slate-400 text-sm">No shared configuration found.</p>
              <p className="text-slate-300 text-xs mt-1">Add config keys via the API or database.</p>
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {sharedConfig.map(c => {
                const isLong = c.key === 'terms_conditions' || c.key === 'disclaimer'
                const label  = SHARED_CONFIG_LABELS[c.key] ?? c.label ?? c.key
                return (
                  <div key={c.key} className={isLong ? 'sm:col-span-2' : ''}>
                    <label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                      {label}
                    </label>
                    {c.description && (
                      <p className="text-xs text-slate-400 mb-1.5">{c.description}</p>
                    )}
                    {isLong ? (
                      <textarea
                        rows={4}
                        value={configEdits[c.key] ?? ''}
                        onChange={e => setConfigEdits(prev => ({ ...prev, [c.key]: e.target.value }))}
                        className={`${INPUT_CLS} resize-none`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={configEdits[c.key] ?? ''}
                        onChange={e => setConfigEdits(prev => ({ ...prev, [c.key]: e.target.value }))}
                        className={INPUT_CLS}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {sharedConfig.length > 0 && (
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 transition"
              >
                {savingConfig && <Loader2 size={14} className="animate-spin" />}
                Save Configuration
              </button>
            </div>
          )}
        </div>

        {/* Last updated note */}
        <p className="text-xs text-slate-400 text-center pb-4">
          Changes take effect immediately for new quotation calculations. Existing quotation estimates are not retroactively updated.
        </p>

      </div>
    </div>
  )
}
