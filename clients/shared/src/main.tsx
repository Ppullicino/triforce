import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { installNativeIntegration } from './core/native-integration';
import { handleAndroidCredentialResponse } from './core/platform-credentials';

installNativeIntegration();
window.triforceNativeResponse = handleAndroidCredentialResponse;
if (window.triforceNative) window.triforceNative.onmessage = event => handleAndroidCredentialResponse(event.data);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
