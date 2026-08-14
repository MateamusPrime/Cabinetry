import { useMemo, useState } from 'react';
import { useProject } from '../store/useProject';
import { runStatus } from '../domain/geometry';
import { formatFrac } from '../domain/units';

/**
 * Live read-out of how a wall's run adds up, with the three ways a shop
 * actually closes a gap. Shown continuously rather than behind a toggle,
 * because a run that does not add up is the thing you most need to know.
 */
/**
 * Everything standing in a run, in order along the wall.
 *
 * When a run does not add up, the totals alone cannot tell you which unit is
 * the wrong size or out of place. This lists them so the culprit is obvious.
 */
function RunBreakdown({ wallId, upper }: { wallId: string; upper: boolean }) {
  const project = useProject((s) => s.project);
  const select = useProject((s) => s.select);
  const selectAppliance = useProject((s) => s.selectAppliance);

  const members = useMemo(() => {
    const cabs = project.cabinets
      .filter((c) => c.wallId === wallId && !c.excluded && (c.type === 'wall') === upper)
      .map((c) => ({ id: c.id, kind: 'cabinet' as const, name: c.name, width: c.width, along: c.along ?? 0 }));
    const apps = (project.appliances ?? [])
      .filter((a) => a.wallId === wallId && a.mountHeight >= 48 === upper)
      .map((a) => ({ id: a.id, kind: 'appliance' as const, name: a.name, width: a.width, along: a.along ?? 0 }));
    return [...cabs, ...apps].sort((m, n) => m.along - n.along);
  }, [project, wallId, upper]);

  if (members.length === 0) return null;

  return (
    <table style={{ fontSize: 11, marginTop: 6 }}>
      <tbody>
        {members.map((m, i) => {
          const prev = members[i - 1];
          /*
           * A stray leftover almost always comes down to one of these: a
           * break in the sequence, or two units sitting through each other.
           * An overlap is the sneakier one, because the wall it double-counts
           * shows up as extra space at the end of the run.
           */
          const hole = prev ? m.along - (prev.along + prev.width) : 0;
          return (
            <tr key={m.id}>
              <td
                style={{ padding: '1px 0', border: 'none', cursor: 'pointer' }}
                onClick={() => (m.kind === 'cabinet' ? select(m.id) : selectAppliance(m.id))}
                title="Select this unit"
              >
                {hole > 1 / 16 && (
                  <span style={{ color: 'var(--bad)' }}>▸ {formatFrac(hole)}" gap<br /></span>
                )}
                {hole < -1 / 16 && (
                  <span style={{ color: 'var(--bad)' }}>
                    ▸ {formatFrac(-hole)}" overlap with {prev.name}
                    <br />
                  </span>
                )}
                <span className={m.kind === 'appliance' ? 'dim-text' : undefined}>{m.name}</span>
              </td>
              <td className="num" style={{ padding: '1px 0', border: 'none' }}>
                {formatFrac(m.width)}"
              </td>
              <td className="num dim-text" style={{ padding: '1px 0', border: 'none', fontSize: 10 }}>
                {formatFrac(m.along)}–{formatFrac(m.along + m.width)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function RunStatusBar({ wallId }: { wallId: string }) {
  const project = useProject((s) => s.project);
  const fillRunWithFiller = useProject((s) => s.fillRunWithFiller);
  const distributeRun = useProject((s) => s.distributeRun);
  const stretchLastInRun = useProject((s) => s.stretchLastInRun);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      ([false, true] as const)
        .map((upper) => ({ upper, status: runStatus(project, wallId, upper) }))
        .filter((r) => r.status.cabinetCount > 0),
    [project, wallId],
  );

  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {rows.map(({ upper, status }) => {
        const key = upper ? 'upper' : 'lower';
        const filled = status.used + status.applianceUsed;
        const pct = status.usable > 0 ? Math.min(1, filled / status.usable) : 0;
        const over = filled > status.usable + 1 / 16;
        const blocked = status.wallLength - status.usable;

        return (
          <div
            key={key}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '7px 9px',
              marginBottom: 6,
              background: 'var(--bg-3)',
            }}
          >
            <div className="between" style={{ marginBottom: 5 }}>
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {upper ? 'Wall run' : 'Base run'}
              </strong>
              <button
                className="sm ghost"
                style={{ padding: '1px 5px', fontSize: 11 }}
                onClick={() => setOpenRun(openRun === key ? null : key)}
                title="List everything in this run, in order along the wall"
              >
                {status.cabinetCount} unit{status.cabinetCount === 1 ? '' : 's'}
                {status.applianceCount > 0 && ` + ${status.applianceCount} appl`} {openRun === key ? '▾' : '▸'}
              </button>
            </div>

            {/* Fill bar: how much of the wall the run covers. */}
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--bg)',
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: `${pct * 100}%`,
                  height: '100%',
                  background: over ? 'var(--bad)' : status.full ? 'var(--good)' : 'var(--accent)',
                }}
              />
            </div>

            <table style={{ fontSize: 11 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '1px 0', border: 'none' }}>Wall</td>
                  <td className="num" style={{ padding: '1px 0', border: 'none' }}>
                    {formatFrac(status.wallLength)}"
                  </td>
                </tr>
                {blocked > 1 / 16 && (
                  <tr>
                    <td style={{ padding: '1px 0', border: 'none' }} className="dim-text">
                      {status.blockedBy.length ? status.blockedBy.slice(0, 2).join(', ') : 'Corner'} takes
                    </td>
                    <td className="num dim-text" style={{ padding: '1px 0', border: 'none' }}>
                      {formatFrac(blocked)}"
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={{ padding: '1px 0', border: 'none' }}>Cabinets</td>
                  <td className="num" style={{ padding: '1px 0', border: 'none' }}>
                    {formatFrac(status.used)}"
                  </td>
                </tr>
                {status.applianceUsed > 1 / 16 && (
                  <tr>
                    <td style={{ padding: '1px 0', border: 'none' }} className="dim-text">
                      Appliances ({status.applianceCount})
                    </td>
                    <td className="num dim-text" style={{ padding: '1px 0', border: 'none' }}>
                      {formatFrac(status.applianceUsed)}"
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={{ padding: '1px 0', border: 'none', fontWeight: 600 }}>
                    {over ? 'Over by' : 'Remaining'}
                  </td>
                  <td
                    className="num"
                    style={{
                      padding: '1px 0',
                      border: 'none',
                      fontWeight: 700,
                      color: over ? 'var(--bad)' : status.full ? 'var(--good)' : 'var(--accent-2)',
                    }}
                  >
                    {formatFrac(over ? filled - status.usable : status.remaining)}"
                  </td>
                </tr>
              </tbody>
            </table>

            {openRun === key && <RunBreakdown wallId={wallId} upper={upper} />}

            {over && (
              <div className="field-hint" style={{ color: 'var(--bad)', marginTop: 4 }}>
                This run is longer than the wall. Narrow a cabinet or move one to another wall.
              </div>
            )}

            {!over && !status.full && (
              <>
                <div style={{ display: 'flex', gap: 4, marginTop: 7, flexWrap: 'wrap' }}>
                  <button
                    className="sm"
                    onClick={() => fillRunWithFiller(wallId, upper)}
                    title="Add a scribe filler to close the gap — what a shop normally does at a wall"
                  >
                    Add filler
                  </button>
                  <button
                    className="sm"
                    onClick={() => distributeRun(wallId, upper)}
                    title="Share the leftover equally across every cabinet in this run"
                  >
                    Share out
                  </button>
                  <button
                    className="sm"
                    onClick={() => stretchLastInRun(wallId, upper)}
                    title="Widen only the last cabinet to take up the leftover"
                  >
                    Stretch last
                  </button>
                </div>
                <div className="field-hint" style={{ marginTop: 5 }}>
                  {status.remaining > 6
                    ? 'A gap this size usually wants another cabinet, not a filler.'
                    : 'A filler is the usual answer at a wall — it gives you scribe room.'}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
