import React from 'react'
import useMachineStatus from '../hooks/useMachineStatus'

export default function Admin() {
  const { data, isFetching } = useMachineStatus()

  return (
    <div>
      <h2 className="text-2xl font-bold">Admin Dashboard</h2>
      <p className="mt-2 text-slate-600">Admin view for managing and seeing machine cycles</p>

      <section className="mt-4">
        <h3 className="font-medium">Realtime machine info</h3>
        {isFetching && <p className="text-sm text-gray-500">Polling / waiting for updates...</p>}
        <pre className="mt-2 bg-white p-3 rounded shadow text-sm">{JSON.stringify(data || {}, null, 2)}</pre>
      </section>
    </div>
  )
}
