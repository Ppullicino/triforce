import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';

test('renders the shared client independently of a native shell', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /your agents/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add a triforce host/i })).toBeEnabled();
});
