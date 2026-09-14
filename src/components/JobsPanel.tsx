import { useMemo, useState } from 'react';
import { useProject } from '../store/useProject';
import { money } from '../domain/units';

/**
 * The job library. Every project is a job you can come back to, which is the
 * difference between a design toy and something you run a business on.
 */
export function JobsPanel({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project);
  const saveJob = useProject((s) => s.saveJob);
  const listJobs = useProject((s) => s.listJobs);
  const openJob = useProject((s) => s.openJob);
  const deleteJob = useProject((s) => s.deleteJob);
  const newJob = useProject((s) => s.newJob);
  const duplicateJob = useProject((s) => s.duplicateJob);
  const exportJson = useProject((s) => s.exportJson);

  // Bumping this re-reads localStorage after a mutation.
  const [tick, setTick] = useState(0);
  const [newName, setNewName] = useState('');
  const [newClient, setNewClient] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Storage can refuse a write — usually a full quota. Never fail silently
  // here: the whole point of the library is that saved work stays saved.
  const [error, setError] = useState<string | null>(null);

  const jobs = useMemo(() => {
    void tick;
    return listJobs();
  }, [listJobs, tick]);

  const refresh = () => setTick((t) => t + 1);

  const saveCurrent = () => {
    setError(saveJob());
    refresh();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 9, 11, 0.72)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 20px',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 'min(760px, 100%)', maxHeight: '100%', overflowY: 'auto', marginBottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between" style={{ marginBottom: 12 }}>
          <h2>Jobs</h2>
          <button className="ghost sm" onClick={onClose}>Close</button>
        </div>

        {error && <div className="alert bad">{error}</div>}

        <div className="alert info">
          Open job: <strong>{project.name}</strong>
          {project.client ? ` — ${project.client}` : ''}. Changes save to this browser automatically, but
          use <em>Save to library</em> to keep a copy you can come back to.
        </div>

        <div className="row" style={{ marginBottom: 16 }}>
          <button className="primary" onClick={saveCurrent}>Save open job to library</button>
          <button
            onClick={() => {
              const blob = new Blob([exportJson()], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${project.name.replace(/\W+/g, '-')}.cabinetry.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export open job to a file
          </button>
        </div>

        <div className="section-title">Start a New Job</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field">
            <span>Project name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Miller Kitchen" />
          </label>
          <label className="field">
            <span>Client</span>
            <input value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="Dave Miller" />
          </label>
          <div style={{ flex: '0 0 auto', paddingBottom: 9 }}>
            <button
              disabled={!newName.trim()}
              onClick={() => {
                const failed = newJob(newName.trim(), newClient.trim());
                setError(failed);
                refresh();
                if (failed) return;
                setNewName('');
                setNewClient('');
                onClose();
              }}
            >
              Create
            </button>
          </div>
        </div>
        <div className="field-hint" style={{ marginBottom: 14 }}>
          The job you have open is saved to the library first, so nothing is lost.
        </div>

        <div className="section-title">Saved Jobs ({jobs.length})</div>
        {jobs.length === 0 && (
          <div className="field-hint">
            Nothing saved yet. Hit <em>Save open job to library</em> above and it will appear here.
          </div>
        )}

        {jobs.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Client</th>
                  <th className="num">Cabinets</th>
                  <th className="num">Lin ft</th>
                  <th className="num">Quote</th>
                  <th>Saved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} style={j.id === project.id ? { background: 'var(--bg-4)' } : undefined}>
                    <td>
                      {j.name}
                      {j.id === project.id && <span className="chip" style={{ marginLeft: 6 }}>open</span>}
                    </td>
                    <td className="dim-text">{j.client || '—'}</td>
                    <td className="num">{j.cabinetCount}</td>
                    <td className="num">{j.linearFeet.toFixed(1)}</td>
                    <td className="num">{j.clientTotal > 0 ? money(j.clientTotal) : '—'}</td>
                    <td className="dim-text" style={{ fontSize: 11 }}>
                      {new Date(j.updatedAt).toLocaleDateString()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="sm"
                        disabled={j.id === project.id}
                        onClick={() => {
                          const failed = openJob(j.id);
                          setError(failed);
                          refresh();
                          if (!failed) onClose();
                        }}
                      >
                        Open
                      </button>{' '}
                      <button
                        className="sm ghost"
                        onClick={() => {
                          setError(duplicateJob(j.id));
                          refresh();
                        }}
                      >
                        Copy
                      </button>{' '}
                      {confirmDelete === j.id ? (
                        <button
                          className="sm danger"
                          onClick={() => {
                            setError(deleteJob(j.id));
                            setConfirmDelete(null);
                            refresh();
                          }}
                        >
                          Really delete?
                        </button>
                      ) : (
                        <button
                          className="sm ghost"
                          disabled={j.id === project.id}
                          title={j.id === project.id ? 'Close this job before deleting it' : 'Delete'}
                          onClick={() => setConfirmDelete(j.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
