import type { Cabinet, HardwareItem, Part, Project } from './types';
import { isLumber, isSheet } from './materials';
import { buildTakeoff, type MaterialTakeoff } from './nesting';
import { BOUGHT_IN, generateProjectParts, specFor } from './partsGenerator';
import { sqFt } from './units';

export interface CostLine {
  label: string;
  detail?: string;
  qty?: number;
  unit?: string;
  unitCost?: number;
  amount: number;
}

export interface HardwareCount {
  item: HardwareItem;
  qty: number;
  amount: number;
}

export interface Estimate {
  parts: Part[];
  takeoff: MaterialTakeoff;
  warnings: string[];

  sheetLines: CostLine[];
  lumberLines: CostLine[];
  trimLines: CostLine[];
  edgebandLines: CostLine[];
  hardwareCounts: HardwareCount[];
  finishLine: CostLine;
  consumablesLine: CostLine;

  materialSubtotal: number;

  laborLines: CostLine[];
  laborHours: { build: number; finish: number; install: number; design: number; total: number };
  laborSubtotal: number;

  directCost: number;
  overhead: number;
  contingency: number;
  totalCost: number;

  /** Sell price for the cabinetry itself, before extras, delivery and tax. */
  cabinetryPrice: number;
  extrasPrice: number;
  extrasCost: number;
  delivery: number;
  subtotalBeforeTax: number;
  tax: number;
  clientTotal: number;

  grossProfit: number;
  effectiveMarginPct: number;
  deposit: number;
  balance: number;

  finishSqFt: number;
  perCabinet: { cabinetId: string; name: string; cost: number; price: number }[];
}

/** Hinges scale with door height — a 30" door takes two, an 80" door takes four. */
export function hingesForDoor(heightIn: number): number {
  if (heightIn <= 40) return 2;
  if (heightIn <= 60) return 3;
  if (heightIn <= 80) return 4;
  return 5;
}

function addTo(map: Map<string, number>, key: string, n: number) {
  map.set(key, (map.get(key) ?? 0) + n);
}

/** Surfaces that actually get sprayed, in square feet. */
function computeFinishSqFt(project: Project, parts: Part[]): number {
  let area = 0;
  const boxMat = project.materials.find((m) => m.id === project.defaultBoxMaterialId);
  const interiorPrefinished = isSheet(boxMat) && (boxMat.finishGrade === 'prefinished' || boxMat.finishGrade === 'melamine');

  for (const p of parts) {
    const face = sqFt(p.length, p.width) * p.qty;
    switch (p.category) {
      // Both faces of every door and drawer front get coated.
      case 'door':
      case 'drawerFront':
        area += face * 2;
        break;
      case 'faceFrameStile':
      case 'faceFrameRail':
      case 'faceFrameMullion':
      case 'toeKick':
      case 'cornerPost':
      case 'filler':
      case 'lightRail':
        area += face;
        break;
      // Crown is measured as run length, so its finished area is the profile
      // girth (roughly face height plus projection) times the run.
      case 'crown':
        area += ((p.length * (p.width + p.thickness)) / 144) * p.qty;
        break;
      // Panels show one face; the back is against the appliance.
      case 'appliancePanel':
        area += face;
        break;
      case 'side':
      case 'bottom':
      case 'top':
      case 'shelf':
      case 'back':
      case 'stretcher':
        if (!interiorPrefinished) area += face;
        break;
      default:
        break;
    }
  }

  // Exposed ends are finished on the outside face regardless of the interior.
  for (const cab of project.cabinets) {
    if (cab.excluded) continue;
    const ends = (cab.finishedLeft ? 1 : 0) + (cab.finishedRight ? 1 : 0);
    if (ends && interiorPrefinished) area += ends * sqFt(cab.height, cab.depth);
  }

  return area;
}

export function computeEstimate(project: Project): Estimate {
  const { parts, warnings } = generateProjectParts(project);
  const { pricing, labor, materials, hardware } = project;

  const cabinetById = new Map(project.cabinets.map((c) => [c.id, c]));

  const takeoff = buildTakeoff(
    parts,
    materials,
    project.defaults.kerf,
    project.defaults.sheetTrim,
    pricing.lumberWasteFactor,
    (part) => {
      const cab = cabinetById.get(part.cabinetId);
      const anyBanded = part.banded.front || part.banded.back || part.banded.left || part.banded.right;
      if (!anyBanded) return undefined;
      // Solid stock is edged by shaping, not banding.
      const mat = materials.find((m) => m.id === part.materialId);
      if (!isSheet(mat)) return undefined;
      return cab?.edgebandId ?? project.defaultEdgebandId;
    },
  );

  // --- Sheet goods --------------------------------------------------------
  const sheetLines: CostLine[] = [];
  for (const res of takeoff.sheetResults) {
    const mat = materials.find((m) => m.id === res.materialId);
    if (!isSheet(mat)) continue;
    const nested = res.sheets.length;
    const purchase = Math.ceil(nested * (1 + pricing.sheetWasteFactor));
    sheetLines.push({
      label: mat.name,
      detail: `${nested} sheet${nested === 1 ? '' : 's'} nested at ${(res.averageYield * 100).toFixed(0)}% yield, +${(pricing.sheetWasteFactor * 100).toFixed(0)}% waste allowance`,
      qty: purchase,
      unit: 'sheet',
      unitCost: mat.costPerSheet,
      amount: purchase * mat.costPerSheet,
    });
  }

  // --- Solid lumber -------------------------------------------------------
  const lumberLines: CostLine[] = [];
  for (const plan of takeoff.lumberPlans) {
    const mat = materials.find((m) => m.id === plan.materialId);
    if (!isLumber(mat)) continue;
    lumberLines.push({
      label: mat.name,
      detail: `${plan.netBoardFeet.toFixed(1)} bd ft net, +${(plan.wasteFactor * 100).toFixed(0)}% for defect and ripping loss`,
      qty: Math.ceil(plan.grossBoardFeet * 10) / 10,
      unit: 'bd ft',
      unitCost: mat.costPerBoardFoot,
      amount: plan.grossBoardFeet * mat.costPerBoardFoot,
    });
  }

  // --- Bought-in trim -----------------------------------------------------
  // Crown and light rail that is not milled in the shop never touches the
  // sheet or board-foot takeoff, so it is priced here from its run length.
  const trimLines: CostLine[] = [];
  const trimGroups = new Map<string, { feet: number; rate: number; label: string }>();
  for (const p of parts) {
    if (p.materialId !== BOUGHT_IN) continue;
    const rate =
      p.category === 'crown' ? project.crown.costPerLinearFoot : project.lightRail.costPerLinearFoot;
    const key = p.name;
    const g = trimGroups.get(key) ?? { feet: 0, rate, label: p.name };
    g.feet += (p.length * p.qty) / 12;
    trimGroups.set(key, g);
  }
  for (const [, g] of trimGroups) {
    const feet = Math.ceil(g.feet);
    trimLines.push({
      label: g.label,
      detail: `${feet} lin ft including mitre waste, bought in`,
      qty: feet,
      unit: 'lin ft',
      unitCost: g.rate,
      amount: feet * g.rate,
    });
  }

  // --- Edgebanding --------------------------------------------------------
  const edgebandLines: CostLine[] = [];
  for (const [ebId, feet] of takeoff.edgebandFeet) {
    const mat = materials.find((m) => m.id === ebId);
    if (!mat || mat.kind !== 'edgeband') continue;
    const withWaste = feet * 1.1;
    edgebandLines.push({
      label: mat.name,
      detail: `${feet.toFixed(0)} lin ft of banded edges, +10% waste`,
      qty: Math.ceil(withWaste),
      unit: 'lin ft',
      unitCost: mat.costPerLinearFoot,
      amount: Math.ceil(withWaste) * mat.costPerLinearFoot,
    });
  }

  // --- Hardware -----------------------------------------------------------
  const hwQty = new Map<string, number>();
  for (const cab of project.cabinets) {
    if (cab.excluded) continue;
    const spec = specFor(cab, project.defaults);
    const cabParts = parts.filter((p) => p.cabinetId === cab.id);

    const doors = cabParts.filter((p) => p.category === 'door');
    for (const d of doors) {
      const hingeId = cab.hingeId ?? (spec.doorMount === 'inset' ? 'hw-hinge-inset' : 'hw-hinge-softclose');
      addTo(hwQty, hingeId, hingesForDoor(d.length) * d.qty);
    }

    for (const dr of cab.drawers) {
      // False fronts are fixed panels — they get a pull but no slides.
      if (dr.falseFront) continue;
      addTo(hwQty, dr.slideId ?? 'hw-slide-undermount', 1);
    }

    if (cab.pullId) {
      const doorPulls = doors.reduce((a, d) => a + d.qty, 0);
      let drawerPulls = 0;
      for (const p of cabParts.filter((x) => x.category === 'drawerFront')) {
        drawerPulls += p.width > 24 ? 2 * p.qty : p.qty;
      }
      addTo(hwQty, cab.pullId, doorPulls + drawerPulls);
    }

    if (cab.adjustableShelves && cab.shelfCount > 0) addTo(hwQty, 'hw-shelfpin', cab.shelfCount * 4);
    addTo(hwQty, 'hw-screws', 1);

    // Corners only work with the gear that makes the dead space reachable.
    if (cab.corner === 'diagonal' && cab.type !== 'wall') addTo(hwQty, 'hw-lazy-susan', 1);
    if (cab.corner === 'blind' && cab.type !== 'wall') addTo(hwQty, 'hw-blind-pullout', 1);
  }

  const hardwareCounts: HardwareCount[] = [];
  for (const [id, qty] of hwQty) {
    const item = hardware.find((h) => h.id === id);
    if (!item) continue;
    hardwareCounts.push({ item, qty, amount: qty * item.cost });
  }
  hardwareCounts.sort((a, b) => b.amount - a.amount);

  // --- Finish -------------------------------------------------------------
  const finishSqFt = computeFinishSqFt(project, parts);
  const finish = project.finishes.find((f) => f.id === project.selectedFinishId);
  const finishLine: CostLine = {
    label: finish?.name ?? 'Finish',
    detail: `${finishSqFt.toFixed(0)} sq ft of finished surface`,
    qty: Math.round(finishSqFt),
    unit: 'sq ft',
    unitCost: finish?.costPerSqFt ?? 0,
    amount: finishSqFt * (finish?.costPerSqFt ?? 0),
  };

  const materialsBeforeConsumables =
    sheetLines.reduce((a, l) => a + l.amount, 0) +
    lumberLines.reduce((a, l) => a + l.amount, 0) +
    trimLines.reduce((a, l) => a + l.amount, 0) +
    edgebandLines.reduce((a, l) => a + l.amount, 0) +
    hardwareCounts.reduce((a, h) => a + h.amount, 0) +
    finishLine.amount;

  const consumablesLine: CostLine = {
    label: 'Consumables',
    detail: `Glue, fasteners, abrasives, spray supplies — ${(pricing.consumablesPct * 100).toFixed(0)}% of material`,
    amount: materialsBeforeConsumables * pricing.consumablesPct,
  };

  const materialSubtotal = materialsBeforeConsumables + consumablesLine.amount;

  // --- Labor --------------------------------------------------------------
  let buildHours = 0;
  let faceFrameCount = 0;
  for (const cab of project.cabinets) {
    if (cab.excluded) continue;
    // A filler is one scribed panel, not a box — a fraction of the work.
    if (cab.type === 'filler') {
      buildHours += 0.35;
      continue;
    }
    const spec = specFor(cab, project.defaults);
    buildHours +=
      cab.type === 'wall'
        ? labor.hoursPerWallCabinet
        : cab.type === 'tall'
          ? labor.hoursPerTallCabinet
          : labor.hoursPerBaseCabinet;
    buildHours += cab.doorCount * labor.hoursPerDoor;
    // A false front is a panel to hang, not a box to build — price it as a door.
    const realDrawers = cab.drawers.filter((d) => !d.falseFront).length;
    const falseFronts = cab.drawers.length - realDrawers;
    buildHours += realDrawers * labor.hoursPerDrawer + falseFronts * labor.hoursPerDoor;
    buildHours += ((cab.finishedLeft ? 1 : 0) + (cab.finishedRight ? 1 : 0)) * labor.hoursPerFinishedEnd;
    if (spec.construction === 'faceFrame') {
      buildHours += labor.hoursPerFaceFrame;
      faceFrameCount++;
    }
    if (cab.corner && cab.corner !== 'none') buildHours += labor.hoursPerCornerCabinet;
  }

  const crownFeet = parts
    .filter((p) => p.category === 'crown')
    .reduce((a, p) => a + (p.length * p.qty) / 12, 0);
  const panelCount = parts
    .filter((p) => p.category === 'appliancePanel')
    .reduce((a, p) => a + p.qty, 0);
  buildHours += crownFeet * labor.hoursPerCrownFoot;
  buildHours += panelCount * labor.hoursPerAppliancePanel;

  /*
   * A bar wall is only ours if we clad it. Choosing a painted wall says
   * somebody else frames and plasters it, so it carries neither parts nor
   * hours — the countertop on top is still an extra either way.
   */
  const shopBuiltBarFeet = (project.barTops ?? [])
    .filter((b) => !b.excluded && (b.panelStyle ?? 'slab') !== 'none')
    .reduce((a, b) => a + b.length / 12, 0);
  buildHours += shopBuiltBarFeet * (labor.hoursPerBarWallFoot ?? 0);

  const activeCabinets = project.cabinets.filter((c) => !c.excluded);
  const finishHours = finishSqFt * labor.finishHoursPerSqFt;
  const installHours = activeCabinets.length * labor.hoursPerCabinetInstall;
  const designHours = activeCabinets.length ? labor.designHoursFlat + activeCabinets.length * labor.designHoursPerCabinet : 0;

  const laborLines: CostLine[] = [
    {
      label: 'Shop build',
      detail: `${activeCabinets.length} cabinets${faceFrameCount ? `, ${faceFrameCount} face-framed` : ''}`,
      qty: Math.round(buildHours * 10) / 10,
      unit: 'hr',
      unitCost: labor.shopRatePerHour,
      amount: buildHours * labor.shopRatePerHour,
    },
    {
      label: 'Finishing',
      detail: `${finishSqFt.toFixed(0)} sq ft at ${labor.finishHoursPerSqFt} hr/sq ft`,
      qty: Math.round(finishHours * 10) / 10,
      unit: 'hr',
      unitCost: labor.shopRatePerHour,
      amount: finishHours * labor.shopRatePerHour,
    },
    {
      label: 'Installation',
      qty: Math.round(installHours * 10) / 10,
      unit: 'hr',
      unitCost: labor.installRatePerHour,
      amount: installHours * labor.installRatePerHour,
    },
    {
      label: 'Design and shop drawings',
      qty: Math.round(designHours * 10) / 10,
      unit: 'hr',
      unitCost: labor.designRatePerHour,
      amount: designHours * labor.designRatePerHour,
    },
  ];

  const laborSubtotal = laborLines.reduce((a, l) => a + l.amount, 0);
  const laborHours = {
    build: buildHours,
    finish: finishHours,
    install: installHours,
    design: designHours,
    total: buildHours + finishHours + installHours + designHours,
  };

  // --- Roll up ------------------------------------------------------------
  const directCost = materialSubtotal + laborSubtotal;
  const overhead = directCost * pricing.overheadPct;
  const contingency = (directCost + overhead) * pricing.contingencyPct;
  const totalCost = directCost + overhead + contingency;

  const margin = Math.min(0.95, Math.max(0, pricing.targetMarginPct));
  const cabinetryPrice = margin >= 1 ? totalCost : totalCost / (1 - margin);

  const extrasCost = project.extras.reduce((a, e) => a + e.qty * e.unitCost, 0);
  const extrasPrice = project.extras.reduce((a, e) => {
    const base = e.qty * e.unitCost;
    if (e.passThrough) return a + base * (1 + (e.markupPct ?? 0.1));
    return a + base / (1 - margin);
  }, 0);

  const delivery = pricing.deliveryFlat;
  const subtotalBeforeTax = cabinetryPrice + extrasPrice + delivery;

  // Many jurisdictions tax materials but not installation labor.
  const laborShareOfPrice = subtotalBeforeTax > 0 ? (laborSubtotal / Math.max(totalCost, 1e-9)) * cabinetryPrice : 0;
  const taxableBase = pricing.taxLabor ? subtotalBeforeTax : Math.max(0, subtotalBeforeTax - laborShareOfPrice);
  const tax = taxableBase * pricing.salesTaxPct;

  const clientTotal = subtotalBeforeTax + tax;
  const grossProfit = cabinetryPrice + extrasPrice - totalCost - extrasCost;
  const effectiveMarginPct = subtotalBeforeTax > 0 ? grossProfit / (cabinetryPrice + extrasPrice) : 0;

  // --- Per-cabinet allocation ---------------------------------------------
  // Allocated by each cabinet's share of build hours, which tracks cost far
  // better than a flat per-unit split.
  const cabHours = activeCabinets.map((cab) => {
    if (cab.type === 'filler') return { cab, h: 0.35 };
    const spec = specFor(cab, project.defaults);
    let h =
      cab.type === 'wall'
        ? labor.hoursPerWallCabinet
        : cab.type === 'tall'
          ? labor.hoursPerTallCabinet
          : labor.hoursPerBaseCabinet;
    const real = cab.drawers.filter((x) => !x.falseFront).length;
    h += cab.doorCount * labor.hoursPerDoor + real * labor.hoursPerDrawer + (cab.drawers.length - real) * labor.hoursPerDoor;
    if (spec.construction === 'faceFrame') h += labor.hoursPerFaceFrame;
    if (cab.corner && cab.corner !== 'none') h += labor.hoursPerCornerCabinet;
    return { cab, h };
  });
  const totalCabHours = cabHours.reduce((a, c) => a + c.h, 0) || 1;
  const perCabinet = cabHours.map(({ cab, h }) => ({
    cabinetId: cab.id,
    name: cab.name,
    cost: (h / totalCabHours) * totalCost,
    price: (h / totalCabHours) * cabinetryPrice,
  }));

  return {
    parts,
    takeoff,
    warnings,
    sheetLines,
    lumberLines,
    trimLines,
    edgebandLines,
    hardwareCounts,
    finishLine,
    consumablesLine,
    materialSubtotal,
    laborLines,
    laborHours,
    laborSubtotal,
    directCost,
    overhead,
    contingency,
    totalCost,
    cabinetryPrice,
    extrasPrice,
    extrasCost,
    delivery,
    subtotalBeforeTax,
    tax,
    clientTotal,
    grossProfit,
    effectiveMarginPct,
    deposit: clientTotal * pricing.depositPct,
    balance: clientTotal * (1 - pricing.depositPct),
    finishSqFt,
    perCabinet,
  };
}

/** Linear feet of cabinetry, the trade's usual sanity check on a quote. */
export function linearFeet(cabinets: Cabinet[]): { base: number; wall: number; tall: number } {
  let base = 0;
  let wall = 0;
  let tall = 0;
  for (const c of cabinets) {
    if (c.excluded) continue;
    if (c.type === 'wall') wall += c.width / 12;
    else if (c.type === 'tall') tall += c.width / 12;
    else base += c.width / 12;
  }
  return { base, wall, tall };
}
