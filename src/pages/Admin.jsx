import React, { useEffect, useState } from 'react'
import useMachineStatus from '../hooks/useMachineStatus'
import LoginForm from '../components/LoginForm'
import { useAuth } from '../context/AuthContext'

export default function Admin() {
  const { data, isFetching } = useMachineStatus()
  const { token, role } = useAuth()
  const [machines, setMachines] = useState([])
  const [users, setUsers] = useState([])
  const [name, setName] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/admin/machines', { headers: { 'Authorization': 'Bearer ' + token } })
        if (res.ok) setMachines(await res.json())
      } catch (err) { }
      try {
        const res = await fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer ' + token } })
        if (res.ok) setUsers(await res.json())
      } catch (err) { }
    }
    if (token && role === 'ADMIN') load()
  }, [token, role])

  return (
    <div>
      <h2 className="text-2xl font-bold">Admin Dashboard</h2>
      <p className="mt-2 text-neutral-600">Admin view for managing and seeing machine cycles</p>

      <section className="mt-4">
        <h3 className="font-medium">Realtime machine info</h3>
        {isFetching && <p className="text-sm text-gray-500">Polling / waiting for updates...</p>}
        <pre className="mt-2 bg-white p-3 rounded shadow text-sm border border-primary-100">{JSON.stringify(data || {}, null, 2)}</pre>
        {!token && <div className="mt-4"><LoginForm mode="admin" /></div>}
        {token && role === 'ADMIN' && (
          <div className="mt-4">
            <h3 className="font-medium">Machines</h3>
            <ul className="mt-2">
              {machines.map((m) => <li key={m._id}>{m.name} — cycle: {m.cycle}</li>)}
            </ul>
            <div className="mt-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Machine name" className="border p-1 rounded focus:outline-none focus:ring-2 focus:ring-primary-300" />
              <button className="ml-2 px-2 py-1 rounded btn-primary" onClick={async () => {
                const res = await fetch('/api/admin/machines', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
                if (res.ok) {
                  setName('')
                  // reload machines list
                  const res2 = await fetch('/api/admin/machines', { headers: { 'Authorization': 'Bearer ' + token } })
                  if (res2.ok) setMachines(await res2.json())
                }
              }}>Create</button>
            </div>
            <h3 className="font-medium mt-4">Users</h3>
            <ul className="mt-2 space-y-2">
              {users.map((u) => (
                <li key={u._id} className="flex items-center justify-between">
                  <span>{u.email} — role: {u.role} {u.apiKey && <span className="ml-2 text-sm">apiKey: {u.apiKey}</span>}</span>
                  {u.role === 'KIOSK' && (
                    <button className="ml-2 px-2 py-1 rounded btn-success" onClick={async () => {
                      const res = await fetch(`/api/admin/users/${u._id}/rotate`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })
                      if (res.ok) {
                        const data = await res.json()
                        alert('New API key: ' + data.apiKey)
                        // reload users
                        const r2 = await fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer ' + token } })
                        if (r2.ok) setUsers(await r2.json())
                      }
                    }}>Rotate Key</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
