import React from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export default function NavSearch({ className = '' }) {
  return (
    <div className={`relative hidden md:flex items-center ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
        <Search className="h-4 w-4" />
      </span>
      <Input id="nav-search" placeholder="Search..." className="pl-9 pr-3 max-w-sm w-full" />
    </div>
  )
}
