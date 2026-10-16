import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MapPrototype from './prototype/MapPrototype';
import RacePrototype from './prototype/RacePrototype';
import MosaicPrototype from './prototype/MosaicPrototype';

// Prototypes on the 1st-round replay: /prototipo/mapa (map, feeds), /prototipo/corrida (race
// experiments), /prototipo/mosaico (states by region). The live telão comes after the visual decisions.
const Page = location.pathname.startsWith('/prototipo/corrida')
  ? RacePrototype
  : location.pathname.startsWith('/prototipo/mosaico')
    ? MosaicPrototype
    : MapPrototype;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
