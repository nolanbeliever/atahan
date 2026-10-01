// Missions drawer on the right ("Görevler"): today's missions with progress bars, rewards, the
// start button and countdown of timed missions, and what the next levels unlock. It does not
// block the game (you can keep driving with it open).

import { ECONOMY } from "../../../shared/economy.config";
import type { MissionView } from "../../../shared/missions";
import { rewardLabel } from "../../../shared/missions";
import {
  garageSlots,
  marketDiscount,
  reputationUnlocks,
  spawnSlots,
} from "../../../shared/reputation";
import { clear, h } from "./dom";

export class MissionsHud {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private unlocks: HTMLElement;
  private missions: MissionView[] = [];
  private level = 1;
  open = false;
  /** Starts a timed mission (server call). */
  onStart: ((id: string) => void) | null = null;
  onToggle: ((open: boolean) => void) | null = null;

  constructor() {
    this.list = h("div", { class: "ms-list", "data-testid": "missions-list" });
    this.unlocks = h("div", { class: "ms-unlocks" });
    const close = h(
      "button",
      {
        class: "btn small ghost",
        "aria-label": "Close missions",
        onclick: () => this.toggle(false),
      },
      "✕",
    );
    this.el = h(
      "div",
      { class: "missions-drawer", "data-testid": "missions" },
      h(
        "div",
        { class: "ms-head" },
        h(
          "div",
          null,
          h("div", { class: "ms-title" }, "Missions"),
          h(
            "div",
            { class: "ms-sub" },
            "Görevler · new every day at 00:00 UTC",
          ),
        ),
        close,
      ),
      this.list,
      this.unlocks,
    );
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.el.classList.toggle("show", open);
    if (open) this.render();
    this.onToggle?.(open);
  }

  set(missions: MissionView[]): void {
    this.missions = missions;
    if (this.open) this.render();
  }

  setLevel(level: number): void {
    if (level === this.level) return;
    this.level = level;
    if (this.open) this.render();
  }

  /** Missions not done yet (for the dock badge). */
  get pending(): number {
    return this.missions.filter((m) => !m.done).length;
  }

  /** Once a second while open: timed mission countdowns. */
  tick(serverNow: number): void {
    if (!this.open) return;
    for (const el of this.list.querySelectorAll<HTMLElement>("[data-ends]")) {
      const left = Math.max(
        0,
        Math.ceil((Number(el.dataset.ends) - serverNow) / 1000),
      );
      el.textContent = `${left}s left`;
    }
    for (const el of this.list.querySelectorAll<HTMLButtonElement>(
      "[data-cooldown]",
    )) {
      const left = Math.ceil((Number(el.dataset.cooldown) - serverNow) / 1000);
      el.disabled = left > 0;
      el.textContent = left > 0 ? `Retry in ${left}s` : "Start";
    }
  }

  private render(): void {
    clear(this.list);
    for (const m of this.missions) {
      const d = m.def;
      const unit =
        d.kind === "drive_km" ? " km" : d.kind === "hold_speed" ? " s" : "";
      const shown =
        d.kind === "drive_km"
          ? Math.floor(m.progress * 10) / 10
          : Math.floor(m.progress);
      const frac = Math.min(1, m.progress / d.target);
      let action: HTMLElement | null = null;
      if (!m.done && d.timeLimitSec) {
        if (m.endsAt !== null)
          action = h(
            "span",
            { class: "pill gold", "data-ends": String(m.endsAt) },
            "",
          );
        else
          action = h(
            "button",
            {
              class: "btn small primary",
              "data-cooldown": String(m.cooldownUntil),
              "data-testid": `mission-start-${d.id}`,
              onclick: () => this.onStart?.(d.id),
            },
            "Start",
          );
      }
      this.list.append(
        h(
          "div",
          {
            class: `ms-card${m.done ? " done" : ""}`,
            "data-testid": `mission-${d.id}`,
          },
          h(
            "div",
            { class: "ms-row" },
            h("div", { class: "ms-name" }, m.done ? "✓ " : "", d.title),
            action,
          ),
          h(
            "div",
            { class: "ms-desc" },
            d.description,
            d.timeLimitSec && !m.done && m.endsAt === null
              ? " Press Start when you are ready."
              : "",
          ),
          h(
            "div",
            { class: "ms-bar" },
            h("div", { style: { width: `${Math.round(frac * 100)}%` } }),
          ),
          h(
            "div",
            { class: "ms-row small" },
            h(
              "span",
              { class: "muted" },
              m.done ? "Completed" : `${shown} / ${d.target}${unit}`,
            ),
            h("span", { class: "ms-reward" }, rewardLabel(d.reward)),
          ),
        ),
      );
    }
    if (this.missions.length === 0)
      this.list.append(
        h("div", { class: "muted small" }, "Loading missions..."),
      );

    // Reputation track: what you have and what the next levels unlock.
    clear(this.unlocks);
    const next = reputationUnlocks()
      .filter((u) => u.level > this.level)
      .slice(0, 3);
    this.unlocks.append(
      ...[
        h("div", { class: "ms-sec" }, `Level ${this.level} perks`),
        h(
          "div",
          { class: "ms-perks" },
          h("span", { class: "pill" }, `Garage ${garageSlots(this.level)}`),
          h("span", { class: "pill" }, `${spawnSlots(this.level)} on street`),
          h(
            "span",
            { class: "pill" },
            `Market -${Math.round(marketDiscount(this.level) * 100)}%`,
          ),
          h(
            "span",
            {
              class: `pill${this.level >= ECONOMY.unlocks.underglowLevel ? " gold" : ""}`,
            },
            this.level >= ECONOMY.unlocks.underglowLevel
              ? "Underglow ✓"
              : `Underglow at L${ECONOMY.unlocks.underglowLevel}`,
          ),
        ),
        next.length ? h("div", { class: "ms-sec" }, "Coming up") : null,
        ...next.map((u) =>
          h(
            "div",
            { class: "ms-next" },
            h("span", { class: "lvl" }, `L${u.level}`),
            h(
              "div",
              null,
              h("div", null, u.title),
              h("div", { class: "muted tiny" }, u.detail),
            ),
          ),
        ),
      ].filter((x): x is HTMLDivElement => !!x),
    );
  }
}
