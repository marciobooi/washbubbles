import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

export default function AdminSettings(){
  const [list, setList] = useState([])
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  async function load() {
    try {
      const data = await api.getSettings()
      setList(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar definições', variant: 'destructive' })
    }
  }

  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    try {
      await api.setSetting({ key, value })
      toast({ title: 'Definição salva', variant: 'success' })
      setKey('')
      setValue('')
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  async function remove(k) {
    if (!confirm('Remover definição?')) return
    try {
      await api.deleteSetting(k)
      toast({ title: 'Definição removida', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Definições</h2>

      <div className="bg-white rounded shadow p-4 mb-4">
        <form onSubmit={save} className="flex gap-2">
          <input className="border p-2 rounded" placeholder="Key" value={key} onChange={(e) => setKey(e.target.value)} />
          <input className="border p-2 rounded flex-1" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="btn btn-primary" type="submit">Save</button>
        </form>
      </div>

      <div className="bg-white rounded shadow p-4">
        <ul>
          {list.map((s) => (
            <li key={s._id} className="py-2 flex justify-between items-center border-b">
              <div>
                <div className="font-semibold">{s.key}</div>
                <div className="text-xs text-muted-foreground">{JSON.stringify(s.value)}</div>
              </div>
              <div>
                <button className="btn btn-destructive" onClick={() => remove(s.key)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}