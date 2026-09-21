import React from 'react'
import { Cpu, Trash2, Plus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import billAcceptorImg from '@/assets/geral/bill_acceptor.jpg'
import cardDispenserImg from '@/assets/geral/card_dispenser.jpg'
import coinAcceptorImg from '@/assets/geral/coin_acceptor.jpg'
import miniHopperImg from '@/assets/geral/mini_hopper.jpg'
import printerImg from '@/assets/geral/printer.jpg'
import rfidReaderImg from '@/assets/geral/rfid_reader.jpg'

export default function AdminPeripherals() {
  const [peripherals, setPeripherals] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [selectedPeripheral, setSelectedPeripheral] = React.useState(null)
  const [showConfig, setShowConfig] = React.useState(false)

  const peripheralTypes = [
    { type: 'bill_acceptor', name: 'Leitor de Notas', protocols: ['cctalk', 'MDB'], image: billAcceptorImg },
    { type: 'card_dispenser', name: 'Disp. de Cartões', protocols: ['cctalk', 'pulse'], image: cardDispenserImg },
    { type: 'coin_acceptor', name: 'Leitor de Moedas', protocols: ['cctalk', 'MDB'], image: coinAcceptorImg },
    { type: 'hopper', name: 'Hopper', protocols: ['cctalk', 'MDB'], image: miniHopperImg },
    { type: 'printer', name: 'Impressora', protocols: ['rs232'], image: printerImg },
    { type: 'rfid_reader', name: 'Leitor/Gravador RFID', protocols: [], image: rfidReaderImg }
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

  function getStatusText(status) {
    switch (status) {
      case 'ok': return 'OK'
      case 'fault': return 'Avaria'
      case 'offline': return 'Offline'
      default: return 'Desconhecido'
    }
  }

  function getStatusDotColor(status) {
    switch (status) {
      case 'ok': return 'bg-green-500'
      case 'fault': return 'bg-red-500'
      case 'offline': return 'bg-neutral-400'
      default: return 'bg-yellow-400'
    }
  }

  const availableProtocols = peripheralTypes.find(pt => pt.type === formData.type)?.protocols || []

  if (loading) {
    return <div className="p-8">A carregar...</div>
  }

  return (
    <div className="p-8">
      <h1 className="text-[28px] font-extrabold tracking-tight text-[#1c2530] mb-6">Periféricos</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {peripherals.map(peripheral => {
          const typeInfo = peripheralTypes.find(pt => pt.type === peripheral.type)
          return (
            <div key={peripheral._id} className="bg-white rounded-[20px] p-6 shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.08)]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-[#eef2f5] flex items-center justify-center shrink-0">
                  <Cpu className="h-5 w-5 text-[#4b5573]" strokeWidth={1.8} />
                </div>
                <div className="font-extrabold text-lg text-[#1c2530] truncate">{peripheral.name}</div>
              </div>

              <div className="bg-[#f7f5f1] rounded-2xl h-40 flex items-center justify-center mb-4 overflow-hidden">
                {typeInfo?.image ? (
                  <img src={typeInfo.image} alt="" className="h-full w-full object-contain p-4" />
                ) : (
                  <Cpu className="h-12 w-12 text-neutral-400" />
                )}
              </div>

              <div className="flex items-center gap-2 pb-4 mb-4 border-b border-black/[0.06]">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${getStatusDotColor(peripheral.status)}`} />
                <span className="text-sm font-medium text-[#1c2530]">{getStatusText(peripheral.status)}</span>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  role="switch"
                  aria-checked={peripheral.enabled}
                  onClick={() => handleToggle(peripheral)}
                  className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${peripheral.enabled ? 'bg-[#a9e0bc]' : 'bg-neutral-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${peripheral.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>

                <button
                  onClick={() => handleConfigClick(peripheral)}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-[#f7f5f1] hover:bg-[#eeebe4] text-sm font-semibold text-[#1c2530] transition-colors duration-150"
                >
                  <Settings className="h-4 w-4" strokeWidth={1.8} />
                  Configurar
                </button>
              </div>
            </div>
          )
        })}
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
