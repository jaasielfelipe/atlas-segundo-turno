import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MapPrototype from './prototype/MapPrototype';
import RacePrototype from './prototype/RacePrototype';

// Prototypes on the 1st-round replay: /prototipo/mapa (map, feeds) and /prototipo/corrida (race
// experiments). The live telão comes after the visual decisions.
const Page = location.pathname.startsWith('/prototipo/corrida') ? RacePrototype : MapPrototype;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
