import { useState } from 'react';

import { searchDecisions, type SearchHitRow } from '../api';

/**
 * Search the index the way people actually ask.
 *
 * "why does the billing service use Postgres" rather than "get decision 0012".
 * Every hit explains why it matched, so the ranking is auditable rather than
 * authoritative.
 */
export function Search({ onOpen }: { onOpen?: (id: string) => void }): JSX.Element {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHitRow[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    if (!text.trim()) return;
    setBusy(true);
    const result = await searchDecisions(text);
    setHits(result.hits);
    setSummary(result.summary);
    setBusy(false);
  }

  return (
    <section className="card">
      <h2>Ask the index</h2>
      <div className="row">
        <input
          value={text}
          placeholder="why does the billing service use Postgres?"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void run();
          }}
        />
        <button className="btn" onClick={() => void run()} disabled={busy || !text.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {summary && <p className="hint">{summary}</p>}

      <ul className="search">
        {hits.map((hit) => (
          <li key={hit.id} className="search__hit">
            <div className="search__head">
              <span className={`status status--${hit.status}`}>{hit.status}</span>
              <button className="link" onClick={() => onOpen?.(hit.id)}>
                {hit.decision}
              </button>
              <span className="muted">{hit.decidedAt.slice(0, 10)}</span>
            </div>
            {hit.because.length > 0 && <p className="muted">matched: {hit.because.slice(0, 3).join(' · ')}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
