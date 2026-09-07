import React from 'react'
import { Cpu, AlertCircle, CheckCircle, WifiOff, HelpCircle, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

export default function AdminPeripherals() {
  const [peripherals, setPeripherals] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [selectedPeripheral, setSelectedPeripheral] = React.useState(null)
  const [showConfig, setShowConfig] = React.useState(false)

  const peripheralTypes = [
    { type: 'bill_acceptor', name: 'Leitor de Notas', protocols: ['cctalk', 'MDB'], image: '/geral/bill_acceptor.jpg' },
    { type: 'card_dispenser', name: 'Disp. de Cartões', protocols: ['cctalk', 'pulse'], image: '/geral/card_dispenser.jpg' },
    { type: 'coin_acceptor', name: 'Leitor de Moedas', protocols: ['cctalk', 'MDB'], image: '/geral/coin_acceptor.jpg' },
    { type: 'hopper', name: 'Hopper', protocols: ['cctalk', 'MDB'], image: '/geral/mini_hopper.jpg' },
    { type: 'printer', name: 'Impressora', protocols: ['rs232'], image: '/geral/printer.jpg' },
    { type: 'rfid_reader', name: 'Leitor/Gravador RFID', protocols: [], image: '/geral/rfid_reader.jpg' }
  ]

  const [formData, setFormData] = React.useState({
    name: '',
    type: '',
    enabled: true,
    protocol: '',
    address: '',
    baudRate: '',
    brand: '',
    model: '',
    serialNumber: '',
    status: 'unknown',
    image: ''
  })

  React.useEffect(() => {
    loadPeripherals()
    // Add custom style to disable hover on this page
    const style = document.createElement('style')
    style.textContent = `
      .no-hover-transform .glass-card:hover {
        transform: none !important;
      }
    `
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])

  async function loadPeripherals() {
    try {
      setLoading(true)
      const data = await api.getPeripherals()
      setPeripherals(data || [])
      
      // If no peripherals exist, create default ones
      if (!data || data.length === 0) {
        await initializeDefaultPeripherals()
      }
    } catch (err) {
      console.error('Failed to load peripherals', err)
      toast({ title: 'Erro ao carregar periféricos', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function initializeDefaultPeripherals() {
    try {
      for (const pt of peripheralTypes) {
        await api.createPeripheral({
          name: pt.name,
          type: pt.type,
          enabled: false,
          protocol: pt.protocols[0],
          status: 'unknown',
          image: pt.image
        })
      }
      await loadPeripherals()
    } catch (err) {
      console.error('Failed to initialize peripherals', err)
    }
  }

  async function handleToggle(peripheral) {
    try {
      await api.updatePeripheral(peripheral._id, { enabled: !peripheral.enabled })
      toast({ title: `${peripheral.name} ${!peripheral.enabled ? 'ativado' : 'desativado'}` })
      loadPeripherals()
    } catch (err) {
      toast({ title: 'Erro ao atualizar periférico', variant: 'destructive' })
    }
  }

  async function handleStatusToggle(peripheral) {
    try {
      const newStatus = peripheral.status === 'ok' ? 'fault' : 'ok'
      await api.updatePeripheral(peripheral._id, { status: newStatus })
      toast({ title: `Estado alterado para ${newStatus === 'ok' ? 'OK' : 'Avaria'}` })
      loadPeripherals()
    } catch (err) {
      toast({ title: 'Erro ao atualizar estado', variant: 'destructive' })
    }
  }

  function handleConfigClick(peripheral) {
    setSelectedPeripheral(peripheral)
    setFormData({
      name: peripheral.name || '',
      type: peripheral.type || '',
      enabled: peripheral.enabled,
      protocol: peripheral.protocol || '',
      address: peripheral.address || '',
      baudRate: peripheral.baudRate || '',
      brand: peripheral.brand || '',
      model: peripheral.model || '',
      serialNumber: peripheral.serialNumber || '',
      status: peripheral.status || 'unknown',
      image: peripheral.image || ''
    })
    setShowConfig(true)
  }

  async function handleSaveConfig() {
    try {
      await api.updatePeripheral(selectedPeripheral._id, formData)
      toast({ title: 'Configuração guardada' })
      setShowConfig(false)
      loadPeripherals()
    } catch (err) {
      toast({ title: 'Erro ao guardar configuração', variant: 'destructive' })
    }
  }

  function getStatusIcon(status) {
    switch (status) {
      case 'ok': return <CheckCircle className="h-5 w-5 text-green-600" />
      case 'fault': return <AlertCircle className="h-5 w-5 text-red-600" />
      case 'offline': return <WifiOff className="h-5 w-5 text-gray-600" />
      default: return <HelpCircle className="h-5 w-5 text-yellow-600" />
    }
  }

  function getStatusText(status) {
    switch (status) {
      case 'ok': return 'OK'
      case 'fault': return 'Avaria'
      case 'offline': return 'Offline'
      default: return 'Desconhecido'
    }
  }

  function getStatusColor(status) {
    switch (status) {
      case 'ok': return 'bg-green-100 text-green-800 border-green-300'
      case 'fault': return 'bg-red-100 text-red-800 border-red-300'
      case 'offline': return 'bg-gray-100 text-gray-800 border-gray-300'
      default: return 'bg-yellow-100 text-yellow-800 border-yellow-300'
    }
  }

  const availableProtocols = peripheralTypes.find(pt => pt.type === formData.type)?.protocols || []

  if (loading) {
    return <div className="p-8">A carregar...</div>
  }

  return (
    <div className="p-8 no-hover-transform">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Configuração de Periféricos</h1>
        <p className="text-neutral-600 mt-1">Gerir dispositivos conectados ao POS</p>
      </div>

      {/* Enable/Disable Checkboxes */}
      <div className="glass-card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Dispositivos Ativos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {peripherals.map(peripheral => (
            <div key={peripheral._id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3 flex-1">
                <input
                  type="checkbox"
                  checked={peripheral.enabled}
                  onChange={() => handleToggle(peripheral)}
                  className="w-5 h-5 rounded border-gray-300 cursor-pointer"
                />
                <span className="font-medium">{peripheral.name}</span>
              </div>
              {getStatusIcon(peripheral.status)}
            </div>
          ))}
        </div>
      </div>

      {/* Status Cards */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-4">Estado dos Periféricos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {peripherals.filter(p => p.enabled).map(peripheral => {
            const typeInfo = peripheralTypes.find(pt => pt.type === peripheral.type)
            return (
              <Card key={peripheral._id} className={`border-2 ${getStatusColor(peripheral.status)}`}>
                <div className="p-4">
                  <div className="flex items-center justify-center mb-3">
                    {typeInfo?.image ? (
                      <img src={typeInfo.image} alt={peripheral.name} className="h-32 w-32 object-contain" />
                    ) : (
                      <Cpu className="h-16 w-16 text-neutral-600" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-center mb-2">{peripheral.name}</h3>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    {getStatusIcon(peripheral.status)}
                    <span className="font-medium">{getStatusText(peripheral.status)}</span>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleConfigClick(peripheral)}
                  >
                    Configurar
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Configuration Modal */}
      {showConfig && selectedPeripheral && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Configurar {selectedPeripheral.name}</h2>
                <Button variant="ghost" onClick={() => setShowConfig(false)}>✕</Button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {availableProtocols.length > 0 && (
                    <div>
                      <Label>Protocolo *</Label>
                      <select
                        className="w-full border rounded-md p-2"
                        value={formData.protocol}
                        onChange={e => setFormData({ ...formData, protocol: e.target.value })}
                      >
                        <option value="">Selecionar...</option>
                        {availableProtocols.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {formData.type === 'printer' ? (
                    <div>
                      <Label>Baud rate *</Label>
                      <select
                        className="w-full border rounded-md p-2"
                        value={formData.baudRate}
                        onChange={e => setFormData({ ...formData, baudRate: e.target.value })}
                      >
                        <option value="">Selecionar...</option>
                        <option value="9600">9600</option>
                        <option value="19200">19200</option>
                        <option value="38400">38400</option>
                        <option value="115200">115200</option>
                      </select>
                    </div>
                  ) : (
                    <div>
                      <Label>Endereço *</Label>
                      <Input
                        value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Ex: COM1, /dev/ttyUSB0"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Marca</Label>
                    <Input
                      value={formData.brand}
                      onChange={e => setFormData({ ...formData, brand: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Input
                      value={formData.model}
                      onChange={e => setFormData({ ...formData, model: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>Número de Série *</Label>
                  <Input
                    value={formData.serialNumber}
                    onChange={e => setFormData({ ...formData, serialNumber: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button onClick={handleSaveConfig} className="flex-1">
                  Guardar
                </Button>
                <Button variant="outline" onClick={() => setShowConfig(false)} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
