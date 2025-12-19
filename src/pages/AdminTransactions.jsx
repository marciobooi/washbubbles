import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

export default function AdminTransactions() {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    try {
      const data = await api.getTransactions()
      setTx(data)
    } catch (e) {
      console.error(e)
      // Handle unauthorized explicitly
      if (e && e.status === 401) {
        toast({ title: 'Unauthorized - please login', variant: 'destructive' })
        navigate('/admin')
        return
      }
      toast({ title: 'Erro ao carregar transacções', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Transacções</h2>
      <div className="bg-white rounded shadow p-4">
        {loading ? (
          <div>Loading...</div>
        ) : (
          <table className="w-full text-sm table-auto">
            <thead>
              <tr>
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Machine</th>
                <th className="text-left p-2">Method</th>
                <th className="text-left p-2">Amount</th>
                <th className="text-left p-2">Inserted</th>
                <th className="text-left p-2">Change</th>
                <th className="text-left p-2">Items</th>
              </tr>
            </thead>
            <tbody>
              {tx.map((t) => (
                <tr key={t._id} className="border-t">
                  <td className="p-2">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="p-2">{t.type || 'payment'}</td>
                  <td className="p-2">{t.machineId ? t.machineId.name : '-'}</td>
                  <td className="p-2">{t.method || '-'}</td>
                  <td className="p-2">{t.amount}</td>
                  <td className="p-2">{t.inserted ?? '-'}</td>
                  <td className="p-2">{t.change ?? '-'}</td>
                  <td className="p-2"><pre className="whitespace-pre-wrap">{JSON.stringify(t.items)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}