import React, { useEffect, useState, useRef } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useSidebar } from '@/components/ui/sidebar'
import Fuse from 'fuse.js'
import Highlight from './Highlight'

export default function NavSearch({ className = '' }) {
  const { searchQuery, setSearchQuery } = useSidebar()
  const [remoteResults, setRemoteResults] = useState({ users: [], machines: [] })
  const [userMatches, setUserMatches] = useState([])
  const [machineMatches, setMachineMatches] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef()

  // Debounced backend search for queries length >= 3
  useEffect(() => {
    const q = (searchQuery || '').trim()
    if (q.length >= 3) {
      const id = setTimeout(async () => {
        try {
          const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`)
          if (!res.ok) return
          const data = await res.json()
          setRemoteResults(data)
          setOpen(true)
        } catch (e) {
          console.error('Search failed', e)
        }
      }, 250)
      return () => clearTimeout(id)
    }
    setRemoteResults({ users: [], machines: [] })
    setOpen(false)
  }, [searchQuery])

  // Compute local Fuse matches for highlight
  useEffect(() => {
    const q = (searchQuery || '').trim()
    if (!q) {
      setUserMatches([])
      setMachineMatches([])
      return
    }

    if (remoteResults.users && remoteResults.users.length) {
      const fuse = new Fuse(remoteResults.users, { keys: ['username'], includeMatches: true, threshold: 0.4 })
      const r = fuse.search(q)
      setUserMatches(r.map((it) => ({ item: it.item, indices: (it.matches && it.matches.find((m) => m.key === 'username')?.indices) || [] })))
    } else {
      setUserMatches([])
    }

    if (remoteResults.machines && remoteResults.machines.length) {
      const fuse = new Fuse(remoteResults.machines, { keys: ['name'], includeMatches: true, threshold: 0.4 })
      const r = fuse.search(q)
      setMachineMatches(r.map((it) => ({ item: it.item, indices: (it.matches && it.matches.find((m) => m.key === 'name')?.indices) || [] })))
    } else {
      setMachineMatches([])
    }
  }, [remoteResults, searchQuery])

  // Close on outside click
  useEffect(() => {
    function onDoc(e) {
      if (!ref.current || ref.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  return (
    <div ref={ref} className={`relative hidden md:flex items-center ${className}`}>
      <Input
        id="nav-search"
        placeholder="Pesquisar…"
        className="h-10 w-full rounded-full border-black/[0.09] bg-[#f7f5f1] pl-4 pr-10 text-sm text-[#1c2530] shadow-none focus-visible:ring-2 focus-visible:ring-primary-400/40 focus-visible:border-primary-400"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onFocus={() => { if ((searchQuery||'').trim().length >= 3) setOpen(true) }}
      />
      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#1c2530]/40 pointer-events-none">
        <Search className="h-4 w-4" strokeWidth={1.7} />
      </span>

      {open && (userMatches.length || machineMatches.length) ? (
        <div className="absolute left-0 mt-10 w-[28rem] bg-white border border-black/[0.09] shadow-lg rounded-2xl z-50 p-1.5">
          {userMatches.length > 0 && (
            <div className="mb-1.5">
              <div className="text-xs uppercase text-muted-foreground mb-1 px-2 pt-1">Users</div>
              <ul>
                {userMatches.map(({ item, indices }) => (
                  <li key={item._id}>
                    <a className="block px-2.5 py-2 rounded-xl text-sm font-medium hover:bg-[#f5f2ec] hover:text-[var(--primary,#0d9488)]" href={`/admin/users?u=${item._id}`}>
                      <Highlight text={item.username} matches={indices} /> <span className="text-xs text-muted-foreground">{item.role}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {machineMatches.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1 px-2 pt-1">Machines</div>
              <ul>
                {machineMatches.map(({ item, indices }) => (
                  <li key={item._id}>
                    <a className="block px-2.5 py-2 rounded-xl text-sm font-medium hover:bg-[#f5f2ec] hover:text-[var(--primary,#0d9488)]" href={`/admin/machines?m=${item._id}`}>
                      <Highlight text={item.name} matches={indices} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
