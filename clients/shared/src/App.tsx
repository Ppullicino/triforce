import { PROTOCOL_VERSION } from '@triforce/protocol';

export function App() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">TRIFORCE REMOTE</p>
        <h1 id="app-title">Your agents. Any screen.</h1>
        <p className="lede">
          Connect this shared client to a Triforce server from Android, Windows, or macOS.
        </p>
        <button type="button">Add a Triforce host</button>
        <small>Protocol foundation {PROTOCOL_VERSION}</small>
      </section>
    </main>
  );
}
