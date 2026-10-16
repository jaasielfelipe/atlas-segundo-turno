import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MapPrototype from './prototype/MapPrototype';

// Routes: /prototipo/mapa (map and feed prototype on the 1st-round replay). The live telão comes
// after the visual decisions.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MapPrototype />
  </StrictMode>,
);
