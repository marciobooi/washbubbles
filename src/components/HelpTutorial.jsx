import React, { useState } from 'react'
import Joyride, { STATUS } from 'react-joyride'

export default function HelpTutorial({ run, onClose }) {
  const [stepIndex, setStepIndex] = useState(0)

  const steps = [
    {
      target: 'body',
      content: (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-teal-600 mb-3">Bem-vindo ao Washstore! 👋</h2>
          <p className="text-neutral-700">Vamos guiá-lo através do processo de utilização das nossas máquinas.</p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3">Passo 1: Escolha o Tipo de Serviço</h3>
          <div className="space-y-2 text-neutral-700">
            <p>🧺 <strong>Lavagem</strong> - Para lavar a sua roupa</p>
            <p>🌀 <strong>Secagem</strong> - Para secar a sua roupa</p>
            <p>Toque no cartão do serviço pretendido para continuar.</p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3">Passo 2: Selecione uma Máquina</h3>
          <div className="space-y-2 text-neutral-700">
            <p>✅ <strong className="text-green-600">Verde</strong> - Máquina disponível</p>
            <p>🔴 <strong className="text-red-600">Vermelho</strong> - Máquina ocupada</p>
            <p>🟡 <strong className="text-yellow-600">Amarelo</strong> - Manutenção</p>
            <p className="mt-3">Escolha uma máquina <strong>disponível</strong> e toque nela.</p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3">Passo 3: Escolha um Programa</h3>
          <div className="space-y-2 text-neutral-700">
            <p>Visualize os programas disponíveis com diferentes:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Durações</li>
              <li>Temperaturas</li>
              <li>Preços</li>
            </ul>
            <p className="mt-3">Selecione o programa que melhor se adequa às suas necessidades.</p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '[aria-label="Abrir carrinho"]',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3">Passo 4: Carrinho de Compras 🛒</h3>
          <div className="space-y-2 text-neutral-700">
            <p>Todos os serviços selecionados aparecem aqui.</p>
            <p>Pode adicionar vários serviços antes de pagar.</p>
            <p className="mt-3">Toque no ícone do carrinho para ver os seus itens.</p>
          </div>
        </div>
      ),
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3">Passo 5: Pagamento 💳</h3>
          <div className="space-y-2 text-neutral-700">
            <p>No carrinho, tem duas opções de pagamento:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Cartão Fidelidade</strong> - Desconto de 0,50€ por item</li>
              <li><strong>Multibanco/Dinheiro</strong> - Pagamento tradicional</li>
            </ul>
            <p className="mt-3">⚠️ <em>Para recargas de cartão, apenas Multibanco/Dinheiro está disponível.</em></p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3">Cartão Fidelidade 💎</h3>
          <div className="space-y-2 text-neutral-700">
            <p>Toque no <strong>ícone do cartão</strong> no menu superior para:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Ver o seu saldo</li>
              <li>Consultar o histórico de transações</li>
              <li>Recarregar o cartão (5€, 10€, ou 20€)</li>
            </ul>
            <p className="mt-3">💡 Poupe 0,50€ em cada serviço!</p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-teal-600 mb-3">Está Pronto! 🎉</h2>
          <p className="text-neutral-700 mb-4">Agora já sabe como usar o Washstore.</p>
          <p className="text-sm text-neutral-500">Se precisar de ajuda novamente, toque no ícone <strong>?</strong> no menu.</p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
  ]

  const handleJoyrideCallback = (data) => {
    const { status, index, action } = data

    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      onClose()
      setStepIndex(0)
    } else if (action === 'next' || action === 'prev') {
      setStepIndex(index + (action === 'next' ? 1 : -1))
    }
  }

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showProgress
      showSkipButton
      stepIndex={stepIndex}
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: '#0d9488',
          textColor: '#1f2937',
          backgroundColor: '#fff',
          arrowColor: '#fff',
          overlayColor: 'rgba(0, 0, 0, 0.6)',
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: 20,
          padding: 40,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          width: 600,
          height: 450,
        },
        tooltipContainer: {
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          height: '80%',
        },
        tooltipContent: {
          padding: '10px 0',
          fontSize: 18,
          lineHeight: 1.7,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
        buttonNext: {
          backgroundColor: '#0d9488',
          borderRadius: 14,
          padding: '16px 32px',
          fontSize: 18,
          fontWeight: 700,
          boxShadow: '0 4px 6px -1px rgba(13, 148, 136, 0.3)',
          transition: 'all 0.2s',
        },
        buttonBack: {
          color: '#0d9488',
          marginRight: 12,
          borderRadius: 14,
          padding: '16px 32px',
          fontSize: 18,
          fontWeight: 600,
          border: '2px solid #0d9488',
          backgroundColor: 'transparent',
        },
        buttonSkip: {
          color: '#6b7280',
          fontSize: 16,
          fontWeight: 500,
        },
        buttonClose: {
          color: '#6b7280',
          width: 36,
          height: 36,
        },
        spotlight: {
          borderRadius: 12,
        },
      }}
      locale={{
        back: 'Anterior',
        close: 'Fechar',
        last: 'Concluir',
        next: 'Próximo',
        skip: 'Saltar Tutorial',
      }}
    />
  )
}
