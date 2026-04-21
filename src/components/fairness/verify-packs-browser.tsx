"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { CardShell } from "@/components/ui/card-shell";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useFairnessMyPacks } from "@/hooks/use-fairness-my-packs";
import { formatDateTime, formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { FairnessMyPack } from "@/lib/api-client";
import { getVerificationStatusLabel } from "@/lib/fairness/verifier-ui";

type VerifyPacksBrowserProps = {
  defaultDate: string;
};

type PackGroup = {
  dropId: string;
  dropScheduledAt: string;
  packs: FairnessMyPack[];
};

function toTodayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStatusStyle(status: FairnessMyPack["verificationStatus"]): {
  icon: string;
  className: string;
} {
  switch (status) {
    case "VERIFIABLE":
      return { icon: "✓", className: "bg-emerald-100 text-emerald-900" };
    case "SEED_UNREVEALED":
      return { icon: "⏳", className: "bg-sky-100 text-sky-900" };
    case "SEED_DECRYPTION_FAILED":
      return { icon: "✕", className: "bg-rose-100 text-rose-900" };
    case "UNVERIFIABLE_LEGACY_PACK":
      return { icon: "!", className: "bg-amber-100 text-amber-900" };
    default:
      return { icon: "?", className: "bg-slate-100 text-slate-900" };
  }
}

function buildPackGroups(packs: FairnessMyPack[]): PackGroup[] {
  const groupsByDropId = new Map<string, PackGroup>();

  for (const pack of packs) {
    const existing = groupsByDropId.get(pack.dropId);
    if (existing) {
      existing.packs.push(pack);
      continue;
    }

    groupsByDropId.set(pack.dropId, {
      dropId: pack.dropId,
      dropScheduledAt: pack.dropScheduledAt,
      packs: [pack]
    });
  }

  return Array.from(groupsByDropId.values()).sort(
    (a, b) => Date.parse(b.dropScheduledAt) - Date.parse(a.dropScheduledAt)
  );
}

function PackCard({ pack }: { pack: FairnessMyPack }): JSX.Element {
  const status = getStatusStyle(pack.verificationStatus);

  return (
    <CardShell
      variant="surface"
      className="min-h-[220px]"
      header={
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">{formatTierLabel(pack.tier)}</p>
            <h3 className="mt-1 text-base font-black text-pv-ink">Pack {pack.id.slice(0, 8)}</h3>
            <p className="text-xs text-pv-muted">Purchased {formatDateTime(pack.purchasedAt)}</p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${status.className}`}>
            <span aria-hidden="true">{status.icon}</span>
            <span>{getVerificationStatusLabel(pack.verificationStatus)}</span>
          </span>
        </div>
      }
      body={
        <div className="space-y-2 text-sm text-pv-muted">
          <p>
            Drop <span className="font-semibold text-pv-ink">{pack.dropId.slice(0, 8)}</span>
          </p>
          <p>
            Scheduled <span className="font-semibold text-pv-ink">{formatDateTime(pack.dropScheduledAt)}</span>
          </p>
        </div>
      }
      actions={
        <Link href={routes.fairness.verify(pack.id)} className={buttonClassName({ variant: "primary", size: "sm", fullWidth: true })}>
          Open Verifier
        </Link>
      }
    />
  );
}

export function VerifyPacksBrowser({ defaultDate }: VerifyPacksBrowserProps): JSX.Element {
  const [selectedDate, setSelectedDate] = useState(defaultDate || toTodayDateInputValue());
  const list = useFairnessMyPacks({ date: selectedDate, limit: 20 });

  const groups = useMemo(() => buildPackGroups(list.packs), [list.packs]);
  const useVirtualGrid = list.packs.length >= 50;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-pv-border bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-pv-ink">Verify Packs</h1>
          <p className="mt-1 text-sm text-pv-muted">Select a drop day and open any pack verifier without manually typing URLs.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-semibold text-pv-ink">
            Drop day
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Filter packs by drop day"
              className="mt-1 block min-h-11 rounded-xl border border-pv-border px-3 py-2 text-sm text-pv-ink outline-none transition focus:border-pv-accent"
            />
          </label>
          <Button variant="secondary" onClick={() => void list.refresh()}>
            Refresh
          </Button>
        </div>
      </header>

      <p className="text-sm text-pv-muted" aria-live="polite">
        {list.packs.length} packs loaded
      </p>

      {list.loading ? <p className="text-sm font-medium text-pv-muted">Loading packs...</p> : null}
      {list.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{list.error}</p> : null}

      {!list.loading && !list.error && list.packs.length === 0 ? (
        <div className="rounded-2xl border border-pv-border bg-white p-5 text-sm text-pv-muted">No packs found for the selected day.</div>
      ) : null}

      {!list.loading && !list.error && list.packs.length > 0 ? (
        useVirtualGrid ? (
          <CardGrid
            items={list.packs}
            itemKey={(pack) => pack.id}
            ariaLabel="Fairness packs"
            renderItem={(pack) => <PackCard pack={pack} />}
            virtualizedItemHeight={260}
          />
        ) : (
          <div className="space-y-4" role="list" aria-label="Packs grouped by drop">
            {groups.map((group) => (
              <section key={group.dropId} className="space-y-3" role="listitem">
                <header className="rounded-xl border border-pv-border bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">Drop {group.dropId.slice(0, 8)}</p>
                  <p className="text-sm font-semibold text-pv-ink">Scheduled {formatDateTime(group.dropScheduledAt)}</p>
                </header>
                <div role="list" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.packs.map((pack) => (
                    <div key={pack.id} role="listitem">
                      <PackCard pack={pack} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : null}

      <PaginationFooter
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onLoadMore={() => {
          void list.loadMore();
        }}
        loadedCount={list.packs.length}
      />
    </section>
  );
}
