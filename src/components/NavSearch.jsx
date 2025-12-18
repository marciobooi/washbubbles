import React, { useEffect, useState, useRef } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useSidebar } from '@/components/ui/sidebar'
import api from '@/services/api'

export default function NavSearch({ className = '' }) {
  const { searchQuery, setSearchQuery } = useSidebar()
  const [remoteResults, setRemoteResults] = useState({ users: [], machines: [] })
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

      {open && (remoteResults.users.length || remoteResults.machines.length) ? (
        <div className="absolute left-0 mt-10 w-[28rem] bg-white shadow rounded z-50 p-2">
          {remoteResults.users.length > 0 && (
            <div className="mb-2">
              <div className="text-xs uppercase text-muted-foreground mb-1">Users</div>
              <ul className="divide-y">
                {remoteResults.users.map((u) => (
                  <li key={u._id} className="py-1">
                    <a className="block px-2 py-1 rounded hover:bg-muted/50" href={`/admin/users?u=${u._id}`}>{u.username} <span className="text-xs text-muted-foreground">{u.role}</span></a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {remoteResults.machines.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Machines</div>
              <ul className="divide-y">
                {remoteResults.machines.map((m) => (
                  <li key={m._id} className="py-1">
                    <a className="block px-2 py-1 rounded hover:bg-muted/50" href={`/admin/machines?m=${m._id}`}>{m.name}</a>
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
