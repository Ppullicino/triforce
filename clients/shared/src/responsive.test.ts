import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('defines compact phone and tablet/desktop breakpoints plus reduced motion', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  expect(css).toContain('@media (max-width: 560px)');
  expect(css).toContain('@media (max-width: 800px)');
  expect(css).toContain('prefers-reduced-motion');
});
