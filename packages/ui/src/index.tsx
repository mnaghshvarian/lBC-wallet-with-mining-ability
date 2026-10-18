/// <reference path="./env.d.ts" />
/// <reference path="./assets.d.ts" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Persian, Arabic and Urdu text (SIL Open Font License); other scripts use system fonts.
import '@fontsource-variable/vazirmatn/index.css';
import './styles/global.css';

export { App };
export { goBack } from './store';

/** Renders the wallet UI into `container`. `window.lbc` must be set up first. */
export function mountApp(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
