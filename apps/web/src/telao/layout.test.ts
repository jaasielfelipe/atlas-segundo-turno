import { expect, it } from 'vitest';
import { telaoLayout } from './layout';

it('layout preferido por padrão; ?classico volta à v1.0', () => {
  expect(telaoLayout('')).toEqual({
    globe: true,
    grid: true,
    continents: true,
    background: true,
    finish: true,
    light: false,
  });
  expect(telaoLayout('?demo&classico')).toMatchObject({
    globe: false,
    grid: false,
    continents: false,
    background: false,
    finish: false,
  });
  expect(telaoLayout('?luz').light).toBe(true);
});
