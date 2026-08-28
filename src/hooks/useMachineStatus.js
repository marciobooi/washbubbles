import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { connect, disconnect, subscribe, send } from '../services/websocket'

// Falls back to a same-origin relative path (not localhost:3000) so a missing
// VITE_API_URL at build time doesn't send production kiosks to their own
// browser's localhost.
const API_URL = (import.meta.env.VITE_API_URL || '') + '/api/pos/machine'

async function fetchMachine() {
  try {
    const res = await fetch(API_URL)
    if (!res.ok) throw new Error('Fetch error')
    return res.json()
  } catch (err) {
    // If fetch fails, return null and let WS updates come in
    return null
  }
}

export default function useMachineStatus() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['machine-status'],
    queryFn: fetchMachine,
    refetchInterval: false,
    retry: false,
    staleTime: 1000 * 5,
  })

  useEffect(() => {
    // connect websocket
    connect()

    const unsub = subscribe((message) => {
      // Expected message shape: { type: 'machine-status', payload: {...} }
      if (typeof message === 'object' && message.type === 'machine-status') {
        queryClient.setQueryData(['machine-status'], message.payload)
      } else if (typeof message === 'object' && message.type === 'machine-cycle') {
        // update minimal cycle info
        queryClient.setQueryData(['machine-status'], (old = {}) => ({ ...old, cycle: message.payload }))
      } else {
        // fallback, set raw data
        queryClient.setQueryData(['machine-status'], message)
      }
    })

    return () => {
      unsub()
      // We won't disconnect socket here as other hooks/pages may use it; disconnect when app unmounts
    }
  }, [queryClient])

  return query
}
