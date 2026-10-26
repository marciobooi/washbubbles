import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import OnScreenKeyboard from './components/OnScreenKeyboard'
import './lib/i18n'
import './fonts.css'
import './index.css'
import { startAutoReload } from './lib/autoReload'
import CrashGuard from './components/CrashGuard'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(

    <QueryClientProvider client={queryClient}>
      <CrashGuard>
      <AuthProvider>
      <BrowserRouter>
        <App />
        <OnScreenKeyboard />
      </BrowserRouter>
      </AuthProvider>
      </CrashGuard>
    </QueryClientProvider>

)

startAutoReload()
