export interface NormalizedHostUrl {
  origin: string;
  baseUrl: string;
  apiUrl: string;
  webSocketUrl: string;
  insecure: boolean;
}

export function normalizeHostUrl(input: string): NormalizedHostUrl {
  const candidate = input.trim();
  if (!candidate) throw new Error('Enter a Triforce server URL');
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(candidate) ? candidate : `http://${candidate}`;
  let url: URL;
  try { url = new URL(withScheme); }
  catch { throw new Error('Enter a valid Triforce server URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Triforce URLs must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('Do not put credentials in the server URL');
  if (url.search || url.hash) throw new Error('Server URLs cannot contain a query or fragment');
  url.pathname = url.pathname.replace(/\/+$/, '');
  const baseUrl = url.toString().replace(/\/$/, '');
  const ws = new URL(baseUrl || url.origin);
  ws.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    origin: url.origin,
    baseUrl,
    apiUrl: `${baseUrl}/api`,
    webSocketUrl: ws.toString().replace(/\/$/, ''),
    insecure: url.protocol === 'http:',
  };
}
