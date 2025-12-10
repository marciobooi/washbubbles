import React, { useState } from 'react'
import useMachineStatus from '../hooks/useMachineStatus'
import { useAuth } from '../context/AuthContext'
import LoginForm from '../components/LoginForm'

export default function Pos() {
  const { data, isFetching } = useMachineStatus()
  const [selectedMachine, setSelectedMachine] = useState('')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState(null)
  const { token } = useAuth()
  const { role, logout } = useAuth()

  return (
    <div>
      <h2 className="text-2xl font-bold">Kiosk POS</h2>
      <p className="mt-2 text-neutral-600">Point-of-sale interface for kiosks</p>

      <div className="mt-4">
        <h3 className="font-medium">Machine status</h3>
        {isFetching && <p className="text-sm text-gray-500">Updating...</p>}
        <pre className="mt-2 bg-white p-3 rounded shadow text-sm border border-primary-100">{JSON.stringify(data || {}, null, 2)}</pre>
        <div className="mt-4">
          <label className="block">Machine</label>
          <select value={selectedMachine} onChange={(e) => setSelectedMachine(e.target.value)} className="w-full border rounded p-2 focus:outline-none focus:ring-2 focus:ring-primary-300">
            <option value="">Select a machine</option>
            {(data || []).map((m, idx) => (
              <option key={m.id ?? m._id ?? idx} value={m.id ?? m._id ?? idx}>{m.name}</option>
            ))}
          </select>
          <label className="block mt-2">Amount</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-300" />
          <button className="mt-2 px-3 py-1 rounded btn-primary" onClick={async () => {
            setMessage(null)
            if (!selectedMachine || !amount) { setMessage('Select machine and amount'); return }
            try {
              const res = await fetch('/api/pos/sale', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) }, body: JSON.stringify({ machineId: selectedMachine, amount, items: [] }) })
              if (!res.ok) throw new Error('Sale failed')
              const sale = await res.json()
              setMessage('Sale recorded: ' + (sale.id ?? sale._id ?? ''))
            } catch (err) { setMessage(err.message) }
          }}>Make Sale</button>
          {message && <p className="mt-2 text-sm">{message}</p>}
          {!token && (
            <div className="mt-3">
              <p className="text-sm text-gray-500">Kiosk login</p>
              <LoginForm mode="kiosk" />
            </div>
          )}
          {token && <button className="mt-2 ml-2 px-3 py-1 rounded btn-primary" onClick={() => logout()}>Logout</button>}
        </div>
      </div>
    </div>
  )
}
