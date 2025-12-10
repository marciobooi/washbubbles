import React from 'react'
import useMachineStatus from '../hooks/useMachineStatus'

export default function Pos() {
  const { data, isFetching } = useMachineStatus()

  return (
    <div>
      <h2 className="text-2xl font-bold">Kiosk POS</h2>
      <p className="mt-2 text-slate-600">Point-of-sale interface for kiosks</p>

      <div className="mt-4">
        <h3 className="font-medium">Machine status</h3>
        {isFetching && <p className="text-sm text-gray-500">Updating...</p>}
        <pre className="mt-2 bg-white p-3 rounded shadow text-sm">{JSON.stringify(data || {}, null, 2)}</pre>
      </div>
    </div>
  )
}
