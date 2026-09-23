// Mirrors backend/src/views/landing.js's DEFAULT_CONTENT — same shape, same
// shipped copy. Used two places: AdminSettings.jsx's "Página Inicial" tab
// seeds its editor with this when nothing has been saved yet (so the admin
// edits real starting copy, not a blank form), and "add item"/"reset"
// actions there pull fresh blank/default shapes from here. The backend has
// its own copy rather than importing this file — it must keep rendering
// even if this frontend bundle is unrelated/unavailable, and a shared import
// would couple two different build targets for no real benefit.
export const DEFAULT_LANDING_CONTENT = {
  brand: {
    name: 'Fresh Bubbles',
    tagline: 'Laundry & Ironing',
    email: 'marcacoes@freshbubbles.pt',
    phone: '+351 912 715 258',
    address: {
      street: 'Av. Dr. António Carvalho de Figueiredo 35A',
      postal: '2670-407',
      city: 'Loures',
      country: 'Portugal',
    },
    hours: { open: '07:00', close: '23:30' },
    rating: { value: 4.5, count: 11 },
    social: [
      { name: 'Instagram', url: 'https://www.instagram.com/freshbubblesloures/' },
    ],
  },
  hero: {
    eyebrow: 'Lavandaria em Loures',
    heading: 'Coloque. Pague.',
    accent: 'Retire fresca.',
    subheading: 'Máquinas modernas, dos 8 aos 20kg. Pague em moedas, notas, cartão bancário ou o seu cartão Fresh Bubbles. Sem marcações, sem filas — chegue, lave, siga a sua vida.',
    ctaPrimaryLabel: 'Como funciona',
    ctaSecondaryLabel: 'Visite-nos',
  },
  steps: {
    visible: true,
    eyebrow: 'O processo',
    heading: 'Três passos, sem complicações',
    description: 'Da roupa suja à roupa fresca, sem precisar de mais nada além de tempo livre.',
    items: [
      { t: 'Coloque a roupa', d: 'Escolha a máquina do tamanho certo — dos 8 aos 20kg — e coloque a roupa suja.' },
      { t: 'Pague como preferir', d: 'Moedas, notas, cartão bancário ou o seu cartão Fresh Bubbles. Sem app a instalar.' },
      { t: 'Retire fresca', d: 'Lavagem e secagem rápidas. Enquanto espera, ligue-se ao WiFi grátis.' },
    ],
  },
  features: {
    visible: true,
    eyebrow: 'Porquê a Fresh Bubbles',
    heading: 'Feito para o seu dia a dia',
    description: 'O essencial de uma lavandaria, sem o que não precisa.',
    items: [
      { t: 'Self-service, à sua hora', d: 'Moedas, notas, cartão bancário ou cartão de cliente. Sem marcações — chegue quando lhe for melhor.' },
      { t: 'Engomadoria', d: 'Deixe a roupa connosco e leve-a pronta a vestir, sem passar a ferro em casa.' },
      { t: 'Limpeza a seco', d: 'Para as peças mais delicadas, o cuidado que precisam.' },
      { t: 'Lavagem de tapetes', d: 'Tapetes lavados com o mesmo cuidado da sua roupa.' },
      { t: 'Recolha e entrega ao domicílio', d: 'Não tem de sair de casa — nós vamos buscar e entregamos.' },
      { t: 'Enquanto espera', d: 'Vending de snacks e bebidas, e WiFi grátis — a sua pausa, tratada.' },
    ],
  },
  cta: {
    visible: true,
    heading: 'Pronta para a próxima lavagem?',
    description: 'Sem marcações. Chegue quando lhe for melhor e a sua roupa espera por si, fresca.',
  },
  visit: {
    visible: true,
    eyebrow: 'Visite-nos',
    heading: 'Onde estamos',
    description: 'Em Loures, aberta todos os dias.',
    reviews: [
      { text: 'Serviço impecável e atenção espetacular.', author: 'Daniel Vinhas' },
    ],
  },
  customSections: [],
}
