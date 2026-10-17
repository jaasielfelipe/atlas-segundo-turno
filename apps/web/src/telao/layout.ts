/**
 * Telão layout. Default (user decision, 17/10/2026): globe with muted continents and a 5°
 * graticule, map as the background of the whole stage, race to the adjusted target (finish line
 * on the valid votes still possible). `?classico`: the v1.0 layout (flat map in the centre
 * column, track 0–55% of the registered voters with the fixed 50% line). `?luz`: stronger light.
 */
export function telaoLayout(search = location.search) {
  const q = new URLSearchParams(search);
  const preferred = !q.has('classico');
  return {
    globe: preferred,
    grid: preferred,
    continents: preferred,
    background: preferred,
    finish: preferred,
    light: q.has('luz'),
  };
}
