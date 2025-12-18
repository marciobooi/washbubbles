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
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
        <Search className="h-4 w-4" />
      </span>
      <Input
        id="nav-search"
        placeholder="Search..."
        className="pl-9 pr-3 max-w-sm w-full"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onFocus={() => { if ((searchQuery||'').trim().length >= 3) setOpen(true) }}
      />

      {open && (userMatches.length || machineMatches.length) ? (
        <div className="absolute left-0 mt-10 w-[28rem] bg-white shadow rounded z-50 p-2">
          {userMatches.length > 0 && (
            <div className="mb-2">
              <div className="text-xs uppercase text-muted-foreground mb-1">Users</div>
              <ul className="divide-y">
                {userMatches.map(({ item, indices }) => (
                  <li key={item._id} className="py-1">
                    <a className="block px-2 py-1 rounded hover:bg-muted/50" href={`/admin/users?u=${item._id}`}>
                      <Highlight text={item.username} matches={indices} /> <span className="text-xs text-muted-foreground">{item.role}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {machineMatches.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Machines</div>
              <ul className="divide-y">
                {machineMatches.map(({ item, indices }) => (
                  <li key={item._id} className="py-1">
                    <a className="block px-2 py-1 rounded hover:bg-muted/50" href={`/admin/machines?m=${item._id}`}>
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
