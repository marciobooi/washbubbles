import ShutdownScheduleForm from '@/components/ShutdownScheduleForm'
import React from 'react'
import { Cpu, Trash2, Plus, Settings, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import * as ws from '@/services/websocket'
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
  const [showHardware, setShowHardware] = React.useState(false)

  // Coin/Bill acceptor equivalence tables + related hardware settings — moved
  // here from Preços (it's peripheral config, not pricing) and tucked behind
  // "Avançado" since it's raw hardware codes, not something to greet a
  // non-technical admin with.
  const [coinEqTable, setCoinEqTable] = React.useState([])
  const [billEqTable, setBillEqTable] = React.useState([])
  const [rechargeCoinBonus, setRechargeCoinBonus] = React.useState(0)
  const [rechargeBillBonus, setRechargeBillBonus] = React.useState(0)
  const [autoCharge, setAutoCharge] = React.useState(false)
  const [hopperCoinValue, setHopperCoinValue] = React.useState(1)
  const [hopperMaxDispenseCoins, setHopperMaxDispenseCoins] = React.useState(50)
  const [creditRefundSeconds, setCreditRefundSeconds] = React.useState(120)

  // Guided calibration: instead of typing hex codes by hand, insert one coin/
  // note of each denomination and let the hardware tell us which channel code
  // it actually is. `calibrating` is null when idle, otherwise
  // { type: 'coin'|'bill', denoms, index, lastLearned }.
  const [calibrating, setCalibrating] = React.useState(null)
  const calibratingRef = React.useRef(null)
  const unsubscribeWsRef = React.useRef(null)

  React.useEffect(() => { calibratingRef.current = calibrating }, [calibrating])

  React.useEffect(() => () => {
    // Leave no dangling WS subscription/connection if the admin navigates
    // away mid-calibration.
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
    // Both an unmapped code (peripheral:rejected — the common first-time case)
    // and an already-mapped one (peripheral:accepted — recalibrating a code
    // that already has a value) tell us what we need: which channel just
    // fired. A fraud flag is excluded — that's a hardware fault signal, not a
    // real coin/note to learn from.
    if (data.type !== 'peripheral:rejected' && data.type !== 'peripheral:accepted') return
    const payload = data.payload || {}
    if (payload.type !== state.type || payload.code == null) return

    const denomValue = state.denoms[state.index]
    // Controller (low-level gateway) codes are opaque strings matched exactly — "3", not "0x03".
    // Serial ccTalk bytes are stored in the documented 0x.. hex form.
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
      const autoChargeVal = await api.getSetting('autoCharge').catch(() => null)
      const hopperVal = await api.getSetting('hopperCoinValue').catch(() => null)
      const hopperMax = await api.getSetting('hopperMaxDispenseCoins').catch(() => null)
      const refundSecs = await api.getSetting('creditRefundSeconds').catch(() => null)

      setCoinEqTable(coinEq && Array.isArray(coinEq.value) ? coinEq.value : [])
      setBillEqTable(billEq && Array.isArray(billEq.value) ? billEq.value : [])
      setRechargeCoinBonus(coinBonus && coinBonus.value !== undefined ? Number(coinBonus.value) : 0)
      setRechargeBillBonus(billBonus && billBonus.value !== undefined ? Number(billBonus.value) : 0)
      setAutoCharge(autoChargeVal && autoChargeVal.value ? Boolean(autoChargeVal.value) : false)
      setHopperCoinValue(hopperVal && hopperVal.value != null ? Number(hopperVal.value) : 1)
      setHopperMaxDispenseCoins(hopperMax && hopperMax.value != null ? Number(hopperMax.value) : 50)
      setCreditRefundSeconds(refundSecs && refundSecs.value != null ? Number(refundSecs.value) : 120)
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
    if (!Number.isInteger(creditRefundSeconds) || creditRefundSeconds < 0 || creditRefundSeconds > 3600) {
      toast({ title: 'A devolução automática tem de ser entre 0 e 3600 segundos (0 = nunca devolver)', variant: 'destructive' })
      return
    }
    try {
      await api.setSetting({ key: 'coinEqTable', value: coinEqTable })
      await api.setSetting({ key: 'billEqTable', value: billEqTable })
      await api.setSetting({ key: 'rechargeCoinBonus', value: rechargeCoinBonus })
      await api.setSetting({ key: 'rechargeBillBonus', value: rechargeBillBonus })
      await api.setSetting({ key: 'autoCharge', value: autoCharge })
      await api.setSetting({ key: 'hopperCoinValue', value: hopperCoinValue })
      await api.setSetting({ key: 'hopperMaxDispenseCoins', value: hopperMaxDispenseCoins })
      await api.setSetting({ key: 'creditRefundSeconds', value: creditRefundSeconds })
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

  // The tables the legacy shop kiosk actually uses: codes are the controller's own
  // decimal strings (coins 3–8; bills are sent as their euro value).
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

      {/* Calibration overlay — guides inserting one coin/note per denomination
          instead of typing hex codes by hand. */}
      {calibrating && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center">
            <div className="text-xs font-semibold text-[#8a8478] uppercase tracking-wide mb-1">
              Calibração de {calibrating.type === 'coin' ? 'moedas' : 'notas'} — passo {calibrating.index + 1} de {calibrating.denoms.length}
            </div>
            <div className="w-16 h-16 rounded-full bg-[#a9e0bc] mx-auto my-4 flex items-center justify-center">
              <Sparkles className="h-7 w-7 text-[#0f2a2c]" />
            </div>
            <div className="text-2xl font-extrabold text-[#1c2530] mb-1">
              Insira {calibrating.type === 'coin' ? 'uma moeda de' : 'uma nota de'} {calibrating.denoms[calibrating.index]}€
            </div>
            <p className="text-sm text-[#8a8478] mb-1">A aguardar o aceitador detetar…</p>
            {calibrating.lastLearned && (
              <p className="text-xs text-emerald-600 font-medium mb-4">
                ✓ Último detetado: {calibrating.lastLearned.hexKey} → {calibrating.lastLearned.denomValue}€
              </p>
            )}
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={skipCalibrationStep}
                className="flex-1 h-10 rounded-full border border-black/[0.12] text-sm font-semibold text-[#1c2530] hover:bg-[#f7f5f1] transition"
              >
                Saltar esta {calibrating.type === 'coin' ? 'moeda' : 'nota'}
              </button>
              <button
                type="button"
                onClick={stopCalibration}
                className="flex-1 h-10 rounded-full bg-[#f7f5f1] hover:bg-[#eeebe4] text-sm font-semibold text-[#1c2530] transition inline-flex items-center justify-center gap-1.5"
              >
                <X className="h-3.5 w-3.5" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

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
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${peripheral.enabled === false ? 'bg-neutral-400' : getStatusDotColor(peripheral.status)}`} />
                <span className="text-sm font-medium text-[#1c2530]">{peripheral.enabled === false ? 'Desativada (fora de serviço)' : getStatusText(peripheral.status)}</span>
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

      {/* Coin/Bill Machine Settings — hardware-facing config (raw denomination
          codes, hopper limits): not something a non-technical admin should be
          confronted with by default, so it's tucked behind this toggle. */}
      <button
        type="button"
        onClick={() => setShowHardware(s => !s)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100 px-4 py-2.5 text-left transition mt-6"
      >
        <span className="text-xs font-semibold text-neutral-600">
          Avançado — configuração de aceitador de moedas e notas
          <span className="font-normal text-neutral-400 ml-1.5">(só para quem instala/configura o equipamento)</span>
        </span>
        <span className={`text-neutral-400 transition-transform ${showHardware ? 'rotate-180' : ''}`}>&#9660;</span>
      </button>

      {showHardware && (
      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Configurações de Aceitador de Moedas e Notas</CardTitle>
          <CardDescription>Configure mapeamentos de valores de moedas/notas e bónus de recarga</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveCoinMachineSettings} className="space-y-6">
            {/* Coin Equivalence Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Tabela de Equivalência de Moedas</Label>
                <div className="flex gap-2">
                  {coinEqTable.length === 0 && (
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultCoinMappings}>
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
              <p className="text-xs text-muted-foreground">
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
                    <span className="text-muted-foreground">→</span>
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
                      ✕
                    </Button>
                  </div>
                ))}
                {coinEqTable.length === 0 && (
                  <div className="border-2 border-dashed rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-2">Nenhum mapeamento de moedas configurado</p>
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultCoinMappings}>
                      Carregar Mapeamentos Padrão
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Bill Equivalence Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Tabela de Equivalência de Notas</Label>
                <div className="flex gap-2">
                  {billEqTable.length === 0 && (
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultBillMappings}>
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
              <p className="text-xs text-muted-foreground">
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
                    <span className="text-muted-foreground">→</span>
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
                      ✕
                    </Button>
                  </div>
                ))}
                {billEqTable.length === 0 && (
                  <div className="border-2 border-dashed rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-2">Nenhum mapeamento de notas configurado</p>
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultBillMappings}>
                      Carregar Mapeamentos Padrão
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Bonus Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
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
                <p className="text-xs text-muted-foreground">
                  Percentagem de bónus adicionada às recargas com moedas (ex: 10% significa €1.00 → €1.10)
                </p>
              </div>

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
                <p className="text-xs text-muted-foreground">
                  Percentagem de bónus adicionada às recargas com notas
                </p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    id="autoCharge"
                    type="checkbox"
                    checked={autoCharge}
                    onChange={(e) => setAutoCharge(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="autoCharge" className="cursor-pointer">
                    Carregar cartão automaticamente ao remover
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ml-6">
                  Guardar automaticamente o saldo em dinheiro no cartão quando este é removido
                </p>
              </div>
            </div>

            <div className="border-t pt-4">
              <Label className="mb-2 block">Hopper (dispensador de troco)</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="hopperCoinValue">Valor da moeda no hopper (€)</Label>
                  <Input id="hopperCoinValue" type="number" step="0.01" min="0.01" value={hopperCoinValue} onChange={(e) => setHopperCoinValue(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">A maioria dos hoppers guarda uma única denominação de moeda.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hopperMaxDispenseCoins">Máximo de moedas por dispensa</Label>
                  <Input id="hopperMaxDispenseCoins" type="number" step="1" min="1" value={hopperMaxDispenseCoins} onChange={(e) => setHopperMaxDispenseCoins(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Limite de segurança — um pedido acima disto é recusado em vez de arriscar esvaziar o hopper por um erro de cálculo.</p>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <Label className="mb-2 block">Devolução automática do crédito</Label>
              <div className="space-y-2 max-w-md">
                <Label htmlFor="creditRefundSeconds">Devolver o dinheiro não usado ao fim de (segundos)</Label>
                <Input id="creditRefundSeconds" type="number" step="1" min="0" max="3600" value={creditRefundSeconds} onChange={(e) => setCreditRefundSeconds(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">
                  Se o cliente inserir moedas/notas e deixar o quiosque sem tocar neste tempo, o dinheiro é devolvido pelo hopper.
                  Cada moeda, nota ou toque no ecrã reinicia a contagem. <strong>0 = nunca devolver.</strong> Por omissão: 120 (2 minutos).
                  A alteração chega ao quiosque em poucos minutos.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit">Guardar Configurações de Moedas/Notas</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  loadCoinMachineSettings();
                  toast({ title: 'Revertido', variant: 'success' })
                }}
              >
                Reverter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      )}

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
      <ShutdownScheduleForm />
    </div>
  )
}
