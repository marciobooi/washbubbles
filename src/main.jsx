import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import OnScreenKeyboard from './components/OnScreenKeyboard'
import './lib/i18n'
import './index.css'
import { startAutoReload } from './lib/autoReload'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(

    <QueryClientProvider client={queryClient}>
      <AuthProvider>
      <BrowserRouter>
        <App />
        <OnScreenKeyboard />
      </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>

)

startAutoReload()
