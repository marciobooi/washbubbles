import { Link, Routes, Route, Navigate } from 'react-router-dom'
import Pos from './pages/Pos'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Admin from './pages/Admin'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-50 via-primary-100 to-primary-200">
      <header className="p-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-primary-800">Washstore</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/pos" className="inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Home">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V20a1 1 0 0 1-1 1h-5.5a1 1 0 0 1-1-1V14a1 1 0 0 0-1-1H10a1 1 0 0 0-1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.75z" />
              </svg>
              <span className="sr-only">Home</span>
            </Link>               
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4">
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route path="/pos/machines" element={<Machines />} />
          <Route path="/pos/machines/:id" element={<MachineDetail />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>
    </div>
  )
}
