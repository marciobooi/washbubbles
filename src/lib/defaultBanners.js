import dryBanner from '@/assets/banner/dry.png'
import carpetBanner from '@/assets/banner/carpet.png'

// Used two places: Banner.jsx falls back to these when the `banners` setting
// has never been saved (so an upgraded kiosk doesn't go blank), and
// AdminSettings.jsx's Banner tab seeds its editor with the same content so
// the admin has something to start editing instead of an empty list.
export const DEFAULT_BANNERS = [
  { id: 'banner1', title: 'Limpeza a seco', text: 'Entre em contacto mail@mail.com', image: dryBanner },
  { id: 'banner2', title: 'Lavagem de carpetes', text: 'Entre em contacto mail@mail.com', image: carpetBanner },
]
