import React from 'react'
import { Cpu, Trash2, Plus, Settings, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import * as ws from '@/services/websocket'
import CalibrationOverlay from './CalibrationOverlay'
import PeripheralCard from './PeripheralCard'
import billAcceptorImg from '@/assets/geral/bill_acceptor.jpg'
import cardDispenserImg from '@/assets/geral/card_dispenser.jpg'
import coinAcceptorImg from '@/assets/geral/coin_acceptor.jpg'
import miniHopperImg from '@/assets/geral/mini_hopper.jpg'
import printerImg from '@/assets/geral/printer.jpg'
import rfidReaderImg from '@/assets/geral/rfid_reader.jpg'
import PageHeader from '@/components/PageHeader'
import Modal from '@/components/ui/Modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function AdminPeripherals() {
  const [peripherals, setPeripherals] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [selectedPeripheral, setSelectedPeripheral] = React.useState(null)
  const [showConfig, setShowConfig] = React.useState(false)

  // Coin/Bill acceptor equivalence tables + related hardware settings
  const [coinEqTable, setCoinEqTable] = React.useState([])
  const [billEqTable, setBillEqTable] = React.useState([])
  const [rechargeCoinBonus, setRechargeCoinBonus] = React.useState(0)
  const [rechargeBillBonus, setRechargeBillBonus] = React.useState(0)
  const [hopperCoinValue, setHopperCoinValue] = React.useState(1)
  const [hopperMaxDispenseCoins, setHopperMaxDispenseCoins] = React.useState(50)

  // Guided calibration
  const [calibrating, setCalibrating] = React.useState(null)
  const calibratingRef = React.useRef(null)
  const unsubscribeWsRef = React.useRef(null)

  React.useEffect(() => { calibratingRef.current = calibrating }, [calibrating])

  React.useEffect(() => () => {
    if (unsubscribeWsRef.current) unsubscribeWsRef.current()
    ws.disconnect()
  }, [])

  function startCalibration(type) {
    const denoms = type === 'coin' ? [0.05, 0.10, 0.20, 0.50, 1.00, 2.00] : [5, 10, 20]
    ws.connect()
    unsubscribeWsRef.current = ws.subscribe(handleCalibrationMessage)
    setCalibrating({ type, denoms, index: 0, lastLearned: null })
  }

  function stopCalibration() {
    if (unsubscribeWsRef.current) { unsubscribeWsRef.current(); unsubscribeWsRef.current = null }
    ws.disconnect()
    setCalibrating(null)
  }

  function handleCalibrationMessage(data) {
    const state = calibratingRef.current
    if (!state) return
    if (!data || typeof data !== 'object') return
    if (data.type !== 'peripheral:rejected' && data.type !== 'peripheral:accepted') return
    const payload = data.payload || {}
    if (payload.type !== state.type || payload.code == null) return

    const denomValue = state.denoms[state.index]
    const hexKey = payload.exact
      ? String(payload.code)
      : `0x${Number(payload.code).toString(16).padStart(2, '0')}`
    const setTable = state.type === 'coin' ? setCoinEqTable : setBillEqTable
    setTable(prev => {
      const idx = prev.findIndex(e => String(e.key) === hexKey)
      const entry = { key: hexKey, value: denomValue }
      if (idx === -1) return [...prev, entry]
      const next = [...prev]
      next[idx] = entry
      return next
    })

    const nextIndex = state.index + 1
    if (nextIndex >= state.denoms.length) {
      toast({ title: `${hexKey} → ${denomValue}€ detetado — calibração concluída`, variant: 'success' })
      stopCalibration()
    } else {
      toast({ title: `${hexKey} → ${denomValue}€ detetado`, variant: 'success' })
      setCalibrating({ ...state, index: nextIndex, lastLearned: { hexKey, denomValue } })
    }
  }

  function skipCalibrationStep() {
    const state = calibratingRef.current
    if (!state) return
    const nextIndex = state.index + 1
    if (nextIndex >= state.denoms.length) { stopCalibration(); return }
    setCalibrating({ ...state, index: nextIndex })
  }

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
    loadCoinMachineSettings()
  }, [])

  async function loadCoinMachineSettings() {
    try {
      const coinEq = await api.getSetting('coinEqTable').catch(() => null)
      const billEq = await api.getSetting('billEqTable').catch(() => null)
      const coinBonus = await api.getSetting('rechargeCoinBonus').catch(() => null)
      const billBonus = await api.getSetting('rechargeBillBonus').catch(() => null)
      const hopperVal = await api.getSetting('hopperCoinValue').catch(() => null)
      const hopperMax = await api.getSetting('hopperMaxDispenseCoins').catch(() => null)

      setCoinEqTable(coinEq && Array.isArray(coinEq.value) ? coinEq.value : [])
      setBillEqTable(billEq && Array.isArray(billEq.value) ? billEq.value : [])
      setRechargeCoinBonus(coinBonus && coinBonus.value !== undefined ? Number(coinBonus.value) : 0)
      setRechargeBillBonus(billBonus && billBonus.value !== undefined ? Number(billBonus.value) : 0)
      setHopperCoinValue(hopperVal && hopperVal.value != null ? Number(hopperVal.value) : 1)
      setHopperMaxDispenseCoins(hopperMax && hopperMax.value != null ? Number(hopperMax.value) : 50)
    } catch (e) {
      console.warn('loadCoinMachineSettings failed', e)
    }
  }

  async function saveCoinMachineSettings(e) {
    e.preventDefault()
    if (hopperMaxDispenseCoins > 200) {
      toast({ title: 'Máximo de moedas a dispensar parece muito alto (>200) — confirme antes de guardar', variant: 'destructive' })
      return
    }
    try {
      await api.setSetting({ key: 'coinEqTable', value: coinEqTable })
      await api.setSetting({ key: 'billEqTable', value: billEqTable })
      await api.setSetting({ key: 'rechargeCoinBonus', value: rechargeCoinBonus })
      await api.setSetting({ key: 'rechargeBillBonus', value: rechargeBillBonus })
      await api.setSetting({ key: 'hopperCoinValue', value: hopperCoinValue })
      await api.setSetting({ key: 'hopperMaxDispenseCoins', value: hopperMaxDispenseCoins })
      toast({ title: 'Configurações de moedas/notas guardadas', variant: 'success' })
      loadCoinMachineSettings()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar configurações', variant: 'destructive' })
    }
  }

  function addCoinMapping() {
    setCoinEqTable([...coinEqTable, { key: '', value: 0 }])
  }

  function updateCoinMapping(index, field, val) {
    const updated = [...coinEqTable]
    updated[index][field] = field === 'value' ? Number(val) : val
    setCoinEqTable(updated)
  }

  function removeCoinMapping(index) {
    setCoinEqTable(coinEqTable.filter((_, i) => i !== index))
  }

  function addBillMapping() {
    setBillEqTable([...billEqTable, { key: '', value: 0 }])
  }

  function updateBillMapping(index, field, val) {
    const updated = [...billEqTable]
    updated[index][field] = field === 'value' ? Number(val) : val
    setBillEqTable(updated)
  }

  function removeBillMapping(index) {
    setBillEqTable(billEqTable.filter((_, i) => i !== index))
  }

  function loadDefaultCoinMappings() {
    const defaults = [
      { key: '0x01', value: 0.05 },
      { key: '0x02', value: 0.10 },
      { key: '0x03', value: 0.20 },
      { key: '0x04', value: 0.50 },
      { key: '0x05', value: 1.00 },
      { key: '0x06', value: 2.00 }
    ]
    setCoinEqTable(defaults)
    toast({ title: 'Mapeamentos padrão de moedas carregados', variant: 'success' })
  }

  function loadShopCoinMappings() {
    setCoinEqTable([
      { key: '3', value: 0.05 },
      { key: '4', value: 0.10 },
      { key: '5', value: 0.20 },
      { key: '6', value: 0.50 },
      { key: '7', value: 1.00 },
      { key: '8', value: 2.00 }
    ])
    toast({ title: 'Padrões da loja (controlador) carregados — moedas', variant: 'success' })
  }

  function loadShopBillMappings() {
    setBillEqTable([
      { key: '5', value: 5 },
      { key: '10', value: 10 },
      { key: '20', value: 20 },
      { key: '50', value: 50 }
    ])
    toast({ title: 'Padrões da loja (controlador) carregados — notas', variant: 'success' })
  }

  function loadDefaultBillMappings() {
    const defaults = [
      { key: '0x10', value: 5 },
      { key: '0x11', value: 10 },
      { key: '0x12', value: 20 }
    ]
    setBillEqTable(defaults)
    toast({ title: 'Mapeamentos padrão de notas carregados', variant: 'success' })
  }

  async function loadPeripherals() {
    try {
      setLoading(true)
      const data = await api.getPeripherals()
      setPeripherals(data || [])
      
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

  const availableProtocols = peripheralTypes.find(pt => pt.type === formData.type)?.protocols || []

  if (loading) {
    return <div className="p-4 md:p-6">A carregar...</div>
  }

  return (
    <div className="p-4 md:p-6 max-w-[1180px] mx-auto">
      <PageHeader title="Periféricos" />

      <CalibrationOverlay
        calibrating={calibrating}
        onSkip={skipCalibrationStep}
        onCancel={stopCalibration}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {peripherals.map((peripheral) => {
          const typeInfo = peripheralTypes.find((pt) => pt.type === peripheral.type)
          return (
            <PeripheralCard
              key={peripheral._id}
              peripheral={peripheral}
              typeInfo={typeInfo}
              onToggle={handleToggle}
              onConfig={handleConfigClick}
            />
          )
        })}
      </div>

      {/* Configuration Modal */}
      {showConfig && selectedPeripheral && (
        <Modal open={true} onClose={() => setShowConfig(false)} title={`Configurar ${selectedPeripheral.name}`} wide>
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {availableProtocols.length > 0 && (
                <div>
                  <Label>Protocolo *</Label>
                  <Select value={formData.protocol} onValueChange={(v) => setFormData({ ...formData, protocol: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProtocols.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {formData.type === 'printer' ? (
                <div>
                  <Label>Baud rate *</Label>
                  <Select value={formData.baudRate} onValueChange={(v) => setFormData({ ...formData, baudRate: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9600">9600</SelectItem>
                      <SelectItem value="19200">19200</SelectItem>
                      <SelectItem value="38400">38400</SelectItem>
                      <SelectItem value="115200">115200</SelectItem>
                    </SelectContent>
                  </Select>
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

            {/* Coin acceptor settings */}
            {selectedPeripheral.type === 'coin_acceptor' && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Moedas aceites</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveCoinMachineSettings} className="space-y-4">
                    {/* Coin Equivalence Table */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-base font-semibold whitespace-nowrap">Tabela de Equivalência de Moedas</Label>
                        <div className="flex justify-end gap-2">
                          {coinEqTable.length === 0 && (
                            <Button type="button" variant="outline" size="sm" onClick={loadDefaultCoinMappings}>
                              Carregar Padrões
                            </Button>
                          )}
                          <Button type="button" variant="outline" size="sm" onClick={loadShopCoinMappings} disabled={!!calibrating}>
                            Padrões da loja
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => startCalibration('coin')} disabled={!!calibrating}>
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Calibrar automaticamente
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={addCoinMapping}>
                            + Adicionar Moeda
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-[#8a8478]">
                        Mapear códigos de moedas do hardware (ex: 0x01, 0x02) para valores em euros
                      </p>
                      <div className="space-y-2">
                        {coinEqTable.map((entry, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <Input
                              placeholder="Código moeda (0x01)"
                              value={entry.key}
                              onChange={(e) => updateCoinMapping(idx, 'key', e.target.value)}
                              className="w-40"
                            />
                            <span className="text-[#8a8478]">→</span>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Valor €"
                              value={entry.value}
                              onChange={(e) => updateCoinMapping(idx, 'value', e.target.value)}
                              className="w-32"
                            />
                            <span className="text-sm">€</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCoinMapping(idx)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {coinEqTable.length === 0 && (
                          <div className="border-2 border-dashed rounded-lg p-4 text-center">
                            <p className="text-sm text-[#8a8478] mb-2">Nenhum mapeamento de moedas configurado</p>
                            <Button type="button" variant="outline" size="sm" onClick={loadDefaultCoinMappings}>
                              Carregar Mapeamentos Padrão
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label htmlFor="rechargeCoinBonus">Bónus de Recarga com Moedas (%)</Label>
                        <Input
                          id="rechargeCoinBonus"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={rechargeCoinBonus}
                          onChange={(e) => setRechargeCoinBonus(Number(e.target.value))}
                        />
                        <p className="text-xs text-[#8a8478]">
                          Percentagem de bónus adicionada às recargas com moedas (ex: 10% significa €1.00 → €1.10)
                        </p>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button type="submit">Guardar moedas aceites</Button>
                        <Button type="button" variant="outline" onClick={() => { loadCoinMachineSettings(); toast({ title: 'Revertido', variant: 'success' }) }}>Reverter</Button>
                      </div>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Bill acceptor settings */}
            {selectedPeripheral.type === 'bill_acceptor' && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Notas aceites</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveCoinMachineSettings} className="space-y-4">
                    {/* Bill Equivalence Table */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-base font-semibold whitespace-nowrap">Tabela de Equivalência de Notas</Label>
                        <div className="flex justify-end gap-2">
                          {billEqTable.length === 0 && (
                            <Button type="button" variant="outline" size="sm" onClick={loadDefaultBillMappings}>
                              Carregar Padrões
                            </Button>
                          )}
                          <Button type="button" variant="outline" size="sm" onClick={loadShopBillMappings} disabled={!!calibrating}>
                            Padrões da loja
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => startCalibration('bill')} disabled={!!calibrating}>
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Calibrar automaticamente
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={addBillMapping}>
                            + Adicionar Nota
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-[#8a8478]">
                        Mapear códigos de notas do hardware (ex: 0x10, 0x11) para valores em euros
                      </p>
                      <div className="space-y-2">
                        {billEqTable.map((entry, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <Input
                              placeholder="Código nota (0x10)"
                              value={entry.key}
                              onChange={(e) => updateBillMapping(idx, 'key', e.target.value)}
                              className="w-40"
                            />
                            <span className="text-[#8a8478]">→</span>
                            <Input
                              type="number"
                              step="1"
                              placeholder="Valor €"
                              value={entry.value}
                              onChange={(e) => updateBillMapping(idx, 'value', e.target.value)}
                              className="w-32"
                            />
                            <span className="text-sm">€</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBillMapping(idx)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {billEqTable.length === 0 && (
                          <div className="border-2 border-dashed rounded-lg p-4 text-center">
                            <p className="text-sm text-[#8a8478] mb-2">Nenhum mapeamento de notas configurado</p>
                            <Button type="button" variant="outline" size="sm" onClick={loadDefaultBillMappings}>
                              Carregar Mapeamentos Padrão
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label htmlFor="rechargeBillBonus">Bónus de Recarga com Notas (%)</Label>
                        <Input
                          id="rechargeBillBonus"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={rechargeBillBonus}
                          onChange={(e) => setRechargeBillBonus(Number(e.target.value))}
                        />
                        <p className="text-xs text-[#8a8478]">
                          Percentagem de bónus adicionada às recargas com notas
                        </p>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button type="submit">Guardar notas aceites</Button>
                        <Button type="button" variant="outline" onClick={() => { loadCoinMachineSettings(); toast({ title: 'Revertido', variant: 'success' }) }}>Reverter</Button>
                      </div>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Hopper settings */}
            {selectedPeripheral.type === 'hopper' && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Hopper e devolução do crédito</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveCoinMachineSettings} className="space-y-4">
                    <div className="border-t pt-4">
                      <Label className="mb-2 block">Hopper (dispensador de troco)</Label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="hopperCoinValue">Valor da moeda no hopper (€)</Label>
                          <Input id="hopperCoinValue" type="number" step="0.01" min="0.01" value={hopperCoinValue} onChange={(e) => setHopperCoinValue(Number(e.target.value))} />
                          <p className="text-xs text-[#8a8478]">A maioria dos hoppers guarda uma única denominação de moeda.</p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="hopperMaxDispenseCoins">Máximo de moedas por dispensa</Label>
                          <Input id="hopperMaxDispenseCoins" type="number" step="1" min="1" value={hopperMaxDispenseCoins} onChange={(e) => setHopperMaxDispenseCoins(Number(e.target.value))} />
                          <p className="text-xs text-[#8a8478]">Limite de segurança — um pedido acima disto é recusado em vez de arriscar esvaziar o hopper por um erro de cálculo.</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button type="submit">Guardar hopper</Button>
                      <Button type="button" variant="outline" onClick={() => { loadCoinMachineSettings(); toast({ title: 'Revertido', variant: 'success' }) }}>Reverter</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-3 mt-6 pt-4 border-t">
              <Button onClick={handleSaveConfig} className="flex-1">
                Guardar
              </Button>
              <Button variant="outline" onClick={() => setShowConfig(false)} className="flex-1">
                Cancelar
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}