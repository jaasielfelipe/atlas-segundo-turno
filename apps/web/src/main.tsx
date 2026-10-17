import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MapPrototype from './prototype/MapPrototype';
import RacePrototype from './prototype/RacePrototype';
import MosaicPrototype from './prototype/MosaicPrototype';
import Telao from './telao/Telao';

// /telao: live telão (?demo: synthetic demonstration). Prototypes on the 1st-round replay:
// /prototipo/mapa, /prototipo/corrida, /prototipo/mosaico.
const Page = location.pathname.startsWith('/telao')
  ? Telao
  : location.pathname.startsWith('/prototipo/corrida')
    ? RacePrototype
    : location.pathname.startsWith('/prototipo/mosaico')
      ? MosaicPrototype
      : MapPrototype;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
