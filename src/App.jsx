import { Link, Routes, Route, Navigate } from 'react-router-dom'
import Pos from './pages/Pos'
import Admin from './pages/Admin'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-50 via-primary-100 to-primary-200">
      <header className="p-4 border-b border-primary-100 bg-white/70 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-primary-800">Washstore</h1>   
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
