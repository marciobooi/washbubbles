import { Link, Routes, Route, Navigate } from 'react-router-dom'
import Pos from './pages/Pos'
import Admin from './pages/Admin'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-sky-50 to-cyan-50">
      <header className="p-4 border-b bg-white/50 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold">Washstore</h1>   
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4">
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>
    </div>
  )
}
