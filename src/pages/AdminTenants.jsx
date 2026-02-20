import React from 'react'
import { useTenant } from '../context/TenantContext'
import RequireAdmin from '../components/RequireAdmin'

export default function AdminTenants() {
  const { tenants = [], createTenant, updateTenant, assignUser, refreshTenants } = useTenant()
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')

  async function handleCreate(e) {
    e.preventDefault()
    if (!name || !slug) return
    try {
      await createTenant({ name, slug })
      setName(''); setSlug('')
    } catch (err) { console.error(err) }
  }

  return (
    <RequireAdmin>
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-3">Tenants</h2>
        <form onSubmit={handleCreate} className="flex gap-2 mb-4">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1" />
          <input placeholder="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="border rounded px-2 py-1" />
          <button className="btn btn-primary" type="submit">Create</button>
        </form>

        <div className="space-y-2">
          {tenants.map(t => (
            <div key={t._id} className="p-2 border rounded flex items-center justify-between">
              <div>
                <div className="font-semibold">{t.name}</div>
                <div className="text-sm text-muted">{t.slug} · {t._id}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={() => { const newName = prompt('Name', t.name); if (newName) updateTenant(t._id, { name: newName }) }}>Rename</button>
                <button className="btn" onClick={() => { const userId = prompt('User ID to assign'); if (userId) assignUser(t._id, userId) }}>Assign user</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </RequireAdmin>
  )
}
