import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';

export function installNativeIntegration() {
  if (!('__TAURI_INTERNALS__' in window)) return () => {};
  const click = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor || new URL(anchor.href).origin === location.origin) return;
    event.preventDefault();
    void openUrl(anchor.href);
  };
  document.addEventListener('click', click);
  const unlisten = listen('switch-host', () => {
    localStorage.removeItem('triforce.selected-host.v1');
    location.reload();
  });
  return () => {
    document.removeEventListener('click', click);
    void unlisten.then(remove => remove());
  };
}
