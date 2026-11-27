'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Copy, MessageSquare, Plus } from 'lucide-react'
import Header from '@/components/staff/Header'
import { createClient } from '@/lib/supabase/client'
import { inr, isManager, whatsappLink } from '@/lib/workflow'
import { referralLink, groupLink } from '@/lib/growth'

// Cheapest new leads: happy customers and neighbours. Every customer has a referral code; each lead from their
// link is tracked, and the reward is due when that lead becomes a job. Neighbour groups get a shared link and
// a bigger discount as more homes join (tiers in Business rules).

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm'
const INPUT = 'border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white'

export default function Growth() {
  const supabase = createClient()
  const [role, setRole] = useState<string | null>(null)
  const [projects, setProjects] = useState<Row[]>([])
  const [quotes, setQuotes] = useState<Row[]>([])
  const [rewards, setRewards] = useState<Row[]>([])
  const [groups, setGroups] = useState<Row[]>([])
  const [rules, setRules] = useState<{ reward: number; tiers: { homes: number; discount_pct: number }[] }>({ reward: 0, tiers: [] })
  const [newGroup, setNewGroup] = useState({ name: '', area: '', closes_on: '' })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    setRole(me?.role ?? null)
    if (!isManager(me?.role)) { setLoading(false); return }
    const [p, q, r, g, s] = await Promise.all([
      supabase.from('projects').select('id, job_number, customer_name, customer_mobile, referral_code, report_token, status').not('job_number', 'is', null).order('created_at', { ascending: false }),
      supabase.from('quotation_requests').select('id, quotation_number, customer_name, status, referred_by_project, group_buy_id, created_at'),
      supabase.from('referral_rewards').select('*, quotation:quotation_id(customer_name, job_number), referrer:referrer_project_id(customer_name, customer_mobile, job_number)').order('created_at', { ascending: false }),
      supabase.from('group_buys').select('*').order('created_at', { ascending: false }),
      supabase.from('business_settings').select('key, data').in('key', ['referral', 'group_buy']),
    ])
    setMissing(!!g.error)
    setProjects(p.data ?? []); setQuotes(q.data ?? []); setRewards(r.data ?? []); setGroups(g.data ?? [])
    const sv = Object.fromEntries((s.data ?? []).map((x: Row) => [x.key, x.data]))
    setRules({ reward: Number(sv.referral?.reward_amount ?? 0), tiers: (sv.group_buy?.tiers ?? []).sort((a: Row, b: Row) => a.homes - b.homes) })
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-green-600" /></div>
  if (!isManager(role)) return <div className="p-10 text-center text-slate-500">This page is for the CEO and the admin manager.</div>

  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }
  const copy = (t: string) => { navigator.clipboard?.writeText(t); say('Link copied') }
  const live = (q: Row) => !['cancelled', 'rejected'].includes(q.status)
  const tierFor = (n: number) => rules.tiers.filter(t => n >= t.homes).pop()
  const askMsg = (p: Row) => `Dear ${p.customer_name}, thank you for choosing Greenergy Solar Solutions! If friends or neighbours ask about your solar system, please share your personal link: ${referralLink(p.referral_code)}${rules.reward ? `. As a thank-you, you receive ₹${rules.reward.toLocaleString('en-IN')} for every one who installs.` : '.'}`
  const groupMsg = (g: Row) => `Solar for ${g.name}${g.area ? ' (' + g.area + ')' : ''}: neighbours who book together get a group discount from Greenergy Solar Solutions${rules.tiers.length ? ' (' + rules.tiers.map(t => `${t.homes}+ homes: ${t.discount_pct}% off`).join(', ') + ')' : ''}. Free site assessment: ${groupLink(g.code)}`

  async function addGroup() {
    if (newGroup.name.trim().length < 2) return say('Give the group a name, e.g. the street or apartment.')
    const { error } = await supabase.from('group_buys').insert({ name: newGroup.name.trim(), area: newGroup.area || null, closes_on: newGroup.closes_on || null })
    if (error) return say(error.message)
    setNewGroup({ name: '', area: '', closes_on: '' }); say('Group created: share its link'); load()
  }
  async function reward(r: Row, status: string) {
    const note = status === 'paid' ? window.prompt(`Paid ₹${r.amount} to ${r.referrer?.customer_name ?? 'the customer'}? How (e.g. GPay ref, cash, discount on AMC):`) : window.prompt('Why cancel this reward?')
    if (note === null) return
    const { error } = await supabase.rpc('mark_referral_reward', { p_reward: r.id, p_status: status, p_note: note })
    if (error) return say(error.message)
    say(status === 'paid' ? 'Reward marked paid' : 'Reward cancelled'); load()
  }

  const due = rewards.filter(r => r.status === 'due')
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header title="Referrals & neighbour groups" subtitle="New customers through the ones you already have" />
      {msg && <div role="status" className="fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm text-white bg-slate-900">{msg}</div>}
      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
        {missing && <p className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">The growth database update has not been run yet (supabase/growth_v1.sql).</p>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([['Referred enquiries', quotes.filter(q => q.referred_by_project).length], ['Referred jobs', quotes.filter(q => q.referred_by_project && q.status === 'project_created').length],
             ['Rewards to pay', `${due.length} · ${inr(due.reduce((t, r) => t + Number(r.amount), 0))}`], ['Group enquiries', quotes.filter(q => q.group_buy_id && live(q)).length]] as [string, string | number][]).map(([l, v]) => (
            <div key={l} className={`${CARD} p-4`}><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-bold text-slate-900">{v}</p></div>))}
        </div>

        {due.length > 0 && (
          <div className={CARD}>
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-semibold text-sm">Rewards to pay</h2><p className="text-xs text-slate-500">Paying promptly is what makes customers refer again.</p></div>
            <ul className="divide-y divide-slate-50 text-sm">{due.map(r => (
              <li key={r.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3">
                <span className="flex-1"><b>{r.referrer?.customer_name}</b> referred {r.quotation?.customer_name} ({r.quotation?.job_number})</span>
                <b>{inr(r.amount)}</b>
                {r.referrer?.customer_mobile && <a target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 hover:underline" href={whatsappLink(r.referrer.customer_mobile, `Dear ${r.referrer.customer_name}, thank you for recommending us to ${r.quotation?.customer_name}! Their solar system is going ahead, and your thank-you of ₹${r.amount} is on its way. — Greenergy Solar Solutions`)}>WhatsApp thanks</a>}
                <button className="text-xs font-semibold text-green-700 hover:underline" onClick={() => reward(r, 'paid')}>Mark paid</button>
                <button className="text-xs text-slate-500 hover:underline" onClick={() => reward(r, 'cancelled')}>Cancel</button>
              </li>))}</ul>
          </div>
        )}

        <div className={CARD}>
          <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-semibold text-sm">Neighbour groups</h2>
            <p className="text-xs text-slate-500">One link for a street, apartment block or association. Everyone who enquires through it is grouped; the discount tier reached shows on each of their quotations{rules.tiers.length ? `: ${rules.tiers.map(t => `${t.homes}+ homes → ${t.discount_pct}%`).join(', ')}` : ''}. You apply the discount when preparing the quotation.</p></div>
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-end">
            <input className={`${INPUT} flex-1 min-w-[180px]`} placeholder="Group name, e.g. Lawspet 4th Cross" value={newGroup.name} onChange={e => setNewGroup({ ...newGroup, name: e.target.value })} />
            <input className={INPUT} placeholder="Area" value={newGroup.area} onChange={e => setNewGroup({ ...newGroup, area: e.target.value })} />
            <label className="text-xs text-slate-500">Offer ends <input type="date" className={INPUT} value={newGroup.closes_on} onChange={e => setNewGroup({ ...newGroup, closes_on: e.target.value })} /></label>
            <button className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1" onClick={addGroup}><Plus size={14} /> Create group</button>
          </div>
          <ul className="divide-y divide-slate-50 text-sm">
            {groups.length === 0 ? <li className="px-5 py-6 text-center text-slate-400">No groups yet.</li> : groups.map(g => {
              const members = quotes.filter(q => q.group_buy_id === g.id && live(q))
              const tier = tierFor(members.length)
              return (
                <li key={g.id} className="px-5 py-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><b>{g.name}</b><span className="font-mono text-xs text-slate-500">{g.code}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] ${g.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>{g.status}</span>
                    <span className="text-xs text-slate-600">{members.length} home{members.length === 1 ? '' : 's'}{tier ? ` · ${tier.discount_pct}% reached` : ''}{g.closes_on ? ` · ends ${g.closes_on}` : ''}</span>
                    <span className="ml-auto flex gap-3 text-xs font-semibold">
                      <button className="text-slate-600 flex items-center gap-1" onClick={() => copy(groupLink(g.code))}><Copy size={12} /> Link</button>
                      <a target="_blank" rel="noopener noreferrer" className="text-green-700 flex items-center gap-1" href={`https://wa.me/?text=${encodeURIComponent(groupMsg(g))}`}><MessageSquare size={12} /> Share on WhatsApp</a>
                      <button className="text-slate-500" onClick={async () => { await supabase.from('group_buys').update({ status: g.status === 'open' ? 'closed' : 'open' }).eq('id', g.id); load() }}>{g.status === 'open' ? 'Close' : 'Reopen'}</button>
                    </span>
                  </div>
                  {members.length > 0 && <p className="text-xs text-slate-500">{members.map(q => <Link key={q.id} href={`/staff/quotations/${q.id}`} className="hover:underline mr-2">{q.customer_name}</Link>)}</p>}
                </li>)
            })}
          </ul>
        </div>

        <div className={CARD}>
          <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-semibold text-sm">Customer referral links</h2>
            <p className="text-xs text-slate-500">Send each happy customer their link, best at handover and again after the first good electricity bill.{rules.reward ? ` Reward: ${inr(rules.reward)} per installed referral (Business rules).` : ''} The link is also on their commissioning report.</p></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Customer', 'Code', 'Referred', 'Won', ''].map(h => <th key={h} className="text-left px-4 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {projects.filter(p => p.referral_code).length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Customers get a code once they have a job card.</td></tr>
                : projects.filter(p => p.referral_code).map(p => {
                  const refs = quotes.filter(q => q.referred_by_project === p.id)
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2"><Link href={`/staff/projects/${p.id}`} className="font-medium hover:underline">{p.customer_name}</Link><p className="text-xs text-slate-500">{p.job_number}</p></td>
                      <td className="px-4 py-2 font-mono text-xs">{p.referral_code}</td>
                      <td className="px-4 py-2 tabular-nums">{refs.length}</td>
                      <td className="px-4 py-2 tabular-nums">{refs.filter(q => q.status === 'project_created').length}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap text-xs font-semibold">
                        <button className="text-slate-600 mr-3" onClick={() => copy(referralLink(p.referral_code))}>Copy link</button>
                        {p.customer_mobile && <a target="_blank" rel="noopener noreferrer" className="text-green-700" href={whatsappLink(p.customer_mobile, askMsg(p))}>WhatsApp customer</a>}
                      </td>
                    </tr>)
                })}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  )
}
