// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { computeEstimate } from '../../domain/estimate';
import { money } from '../../domain/units';
import { EstimateView } from '../EstimateView';

/**
 * The estimate is quoted from and paid against. Two things matter most: the
 * numbers on screen are the ones the domain worked out, and the client quote
 * never shows the client what the job cost to build.
 */

function projectWith(...presets: string[]) {
  const st = useProject.getState();
  st.newProject('Estimate test');
  st.setActiveWall(useProject.getState().project.room.walls[0].id);
  for (const key of presets) st.addCabinet(key);
  return useProject.getState().project;
}

const estimate = () => computeEstimate(useProject.getState().project);

/** Cells of the roll-up table, keyed by the label in the left column. */
function rollup(container: HTMLElement): Map<string, string> {
  const card = [...container.querySelectorAll('.card')].find(
    (c) => c.querySelector('h4')?.textContent === 'Roll-up',
  )!;
  const out = new Map<string, string>();
  for (const tr of card.querySelectorAll('tr')) {
    const [label, value] = [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
    if (label) out.set(label, value);
  }
  return out;
}

afterEach(cleanup);

describe('EstimateView', () => {
  it('has nothing to price before any cabinets exist', () => {
    projectWith();
    render(<EstimateView />);
    expect(screen.getByText('Nothing to price')).toBeTruthy();
  });

  it('treats an excluded cabinet as nothing to price', () => {
    const st = useProject.getState();
    projectWith('base-2door');
    st.updateCabinet(useProject.getState().project.cabinets[0].id, { excluded: true });

    render(<EstimateView />);
    expect(screen.getByText('Nothing to price')).toBeTruthy();
  });

  it('heads the KPIs with the figures the domain computed', () => {
    projectWith('base-2door', 'wall-2door');
    const est = estimate();
    const { container } = render(<EstimateView />);

    const kpis = new Map(
      [...container.querySelectorAll('.kpi')].map((k) => [
        k.querySelector('.k')!.textContent!,
        k.querySelector('.v')!.textContent!,
      ]),
    );

    expect(kpis.get('Material')).toBe(money(est.materialSubtotal));
    expect(kpis.get('Labor')).toBe(money(est.laborSubtotal));
    expect(kpis.get('Total cost')).toBe(money(est.totalCost));
    expect(kpis.get('Client price')).toBe(money(est.clientTotal));
    expect(kpis.get('Gross profit')).toBe(money(est.grossProfit));
  });

  it('rolls material and labor up into the client total the way the numbers add', () => {
    projectWith('base-2door', 'wall-2door', 'base-3drawer');
    const est = estimate();
    const { container } = render(<EstimateView />);
    const rows = rollup(container);

    expect(rows.get('Material')).toBe(money(est.materialSubtotal));
    expect(rows.get('Labor')).toBe(money(est.laborSubtotal));
    expect(rows.get('Direct cost')).toBe(money(est.directCost));
    expect(rows.get('Total cost')).toBe(money(est.totalCost));
    expect(rows.get('Client total')).toBe(money(est.clientTotal));

    // Direct cost is exactly its two parts, and total cost adds the two loads.
    expect(est.directCost).toBeCloseTo(est.materialSubtotal + est.laborSubtotal, 6);
    expect(est.totalCost).toBeCloseTo(est.directCost + est.overhead + est.contingency, 6);
  });

  it('labels overhead and contingency with the percentages in force', () => {
    projectWith('base-2door');
    const st = useProject.getState();
    st.updatePricing({ overheadPct: 0.18, contingencyPct: 0.04 });

    const { container } = render(<EstimateView />);
    const rows = rollup(container);

    expect([...rows.keys()]).toContain('Overhead (18%)');
    expect([...rows.keys()]).toContain('Contingency (4%)');
  });

  it('moves the price when the margin is changed', () => {
    projectWith('base-2door', 'wall-2door');
    const st = useProject.getState();

    st.updatePricing({ targetMarginPct: 0.3 });
    const low = estimate().cabinetryPrice;
    st.updatePricing({ targetMarginPct: 0.45 });
    const high = estimate().cabinetryPrice;

    expect(high).toBeGreaterThan(low);

    const { container } = render(<EstimateView />);
    expect(rollup(container).get('Cabinetry price at 45% margin')).toBe(money(high));
  });

  it('quotes a per-linear-foot rate against the run it priced', () => {
    projectWith('base-2door', 'wall-2door');
    const est = estimate();
    const { container } = render(<EstimateView />);

    const hint = container.querySelector('.field-hint')!.textContent!;
    const lf = Number(/([\d.]+) linear feet/.exec(hint)![1]);
    expect(lf).toBeGreaterThan(0);
    expect(hint).toContain(money(est.clientTotal / Math.max(lf, 0.01)));
  });

  it('flags that the estimate rests on an unresolved design', () => {
    const st = useProject.getState();
    projectWith('base-1door');
    st.updateCabinet(useProject.getState().project.cabinets[0].id, { width: 34 });

    const est = estimate();
    expect(est.warnings.length).toBeGreaterThan(0);

    render(<EstimateView />);
    const heading = screen.getByText(/open issues?$/).textContent ?? '';
    expect(heading).toBe(
      `The estimate is built on a design with ${est.warnings.length} open issue${est.warnings.length === 1 ? '' : 's'}`,
    );
  });
});

describe('EstimateView client quote', () => {
  /** Switch to the printable quote the client actually receives. */
  function asClient() {
    const view = render(<EstimateView />);
    fireEvent.click(screen.getByText('Client quote'));
    return view;
  }

  it('shows the client what they pay', () => {
    projectWith('base-2door', 'wall-2door');
    const est = estimate();
    const { container } = asClient();

    expect(container.textContent).toContain(money(est.cabinetryPrice));
    expect(container.textContent).toContain(money(est.clientTotal));
  });

  it('never shows the client the cost structure behind the price', () => {
    projectWith('base-2door', 'wall-2door', 'base-3drawer');
    const est = estimate();
    const { container } = asClient();
    const shown = container.textContent ?? '';

    // The headline internal figures.
    expect(shown).not.toContain(money(est.totalCost));
    expect(shown).not.toContain(money(est.grossProfit));
    expect(shown).not.toContain(money(est.materialSubtotal));
    expect(shown).not.toContain(money(est.laborSubtotal));
    expect(shown).not.toContain(money(est.directCost));

    // And the words that would give the game away.
    for (const term of ['Overhead', 'Contingency', 'Gross profit', 'Total cost', 'Direct cost', 'margin']) {
      expect(shown).not.toContain(term);
    }
  });

  it('splits the total into a deposit and a balance that add back up', () => {
    projectWith('base-2door', 'wall-2door');
    const est = estimate();
    const { container } = asClient();
    const shown = container.textContent ?? '';

    expect(shown).toContain(money(est.deposit));
    expect(shown).toContain(money(est.balance));
    expect(est.deposit + est.balance).toBeCloseTo(est.clientTotal, 6);
  });

  it('goes back to the internal view when asked', () => {
    projectWith('base-2door');
    const { container } = asClient();
    expect(container.querySelector('.kpi')).toBeNull();

    fireEvent.click(screen.getByText('Internal cost'));
    expect(container.querySelector('.kpi')).toBeTruthy();
  });
});

describe('EstimateView extras', () => {
  it('adds a priced line and takes it away again', () => {
    projectWith('base-2door');
    const before = useProject.getState().project.extras?.length ?? 0;

    render(<EstimateView />);
    fireEvent.click(screen.getByText('+ Line'));

    const added = useProject.getState().project.extras ?? [];
    expect(added).toHaveLength(before + 1);

    fireEvent.click(screen.getAllByText('×')[0]);
    expect(useProject.getState().project.extras ?? []).toHaveLength(before);
  });

  it('carries an extra through to what the client is asked to pay', () => {
    projectWith('base-2door');
    const st = useProject.getState();
    const withoutExtra = estimate().clientTotal;

    st.addExtra();
    const extra = useProject.getState().project.extras![0];
    st.updateExtra(extra.id, { description: 'Appliance panel', qty: 2, unitCost: 250 });

    const withExtra = estimate();
    expect(withExtra.extrasPrice).toBeGreaterThan(0);
    expect(withExtra.clientTotal).toBeGreaterThan(withoutExtra);

    const { container } = render(<EstimateView />);
    expect(rollup(container).get('Extras')).toBe(money(withExtra.extrasPrice));
  });
});
