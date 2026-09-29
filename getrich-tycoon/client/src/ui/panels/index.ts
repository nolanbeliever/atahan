import type { Panel, PanelArg } from '../Panel';
import type { UI } from '../UI';
import { AuctionsPanel } from './auctions';
import { DealershipPanel, PlotPanel } from './dealership';
import { DragPanel } from './drag';
import { InventoryPanel } from './inventory';
import { InspectPanel, MarketPanel, PlayerListingPanel } from './market';
import { MapPanel, MenuPanel, ProfilePanel, SettingsPanel } from './misc';
import { TuningGaragePanel } from './garage';
import { BankPanel, FuelPanel, PartsPanel, RepairPanel, WashPanel } from './services';

const PANELS = {
  menu: MenuPanel,
  market: MarketPanel,
  inspect: InspectPanel,
  playerListing: PlayerListingPanel,
  inventory: InventoryPanel,
  dealership: DealershipPanel,
  plot: PlotPanel,
  auctions: AuctionsPanel,
  auction: AuctionsPanel,
  map: MapPanel,
  profile: ProfilePanel,
  settings: SettingsPanel,
  repair: RepairPanel,
  wash: WashPanel,
  fuel: FuelPanel,
  custom: TuningGaragePanel,
  parts: PartsPanel,
  bank: BankPanel,
  market_lot: MarketPanel,
  drag: DragPanel,
} satisfies Record<string, new (ui: UI, arg: PanelArg) => Panel>;

export type PanelName = keyof typeof PANELS;

export function createPanel(name: PanelName, ui: UI, arg: PanelArg): Panel {
  const Ctor = PANELS[name] ?? MenuPanel;
  return new Ctor(ui, arg);
}
