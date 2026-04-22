"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { StatTile } from "@/components/ui/stat-tile";
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

function tierChipTone(tier: FairnessMyPack["tier"]): "neutral" | "info" | "gold" {
  if (tier === "elite") return "gold";
  if (tier === "premium") return "info";
  return "neutral";
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

function statusCell(status: FairnessMyPack["verificationStatus"]): JSX.Element {
  if (status === "VERIFIABLE") {
    return <span className="font-semibold text-pv-good">✓ Verifiable</span>;
  }
  if (status === "SEED_UNREVEALED") {
    return <span className="text-pv-muted">Pending reveal</span>;
  }
  if (status === "SEED_DECRYPTION_FAILED") {
    return <span className="font-semibold text-pv-accent">✕ Decryption failed</span>;
  }
  if (status === "UNVERIFIABLE_LEGACY_PACK") {
    return <span className="font-semibold text-pv-warn">! Legacy pack</span>;
  }
  return <span className="text-pv-muted">{getVerificationStatusLabel(status)}</span>;
}

export function VerifyPacksBrowser({ defaultDate }: VerifyPacksBrowserProps): JSX.Element {
  const [selectedDate, setSelectedDate] = useState(defaultDate || toTodayDateInputValue());
  const list = useFairnessMyPacks({ date: selectedDate, limit: 20 });

  const groups = useMemo(() => buildPackGroups(list.packs), [list.packs]);
  const verifiableCount = list.packs.filter((p) => p.verificationStatus === "VERIFIABLE").length;
  const pendingCount = list.packs.filter((p) => p.verificationStatus === "SEED_UNREVEALED").length;

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Provable fairness</h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-pv-muted">
            Every pack is generated deterministically from a committed server seed + your client seed.
            Pick any of yours and re-derive the cards in your browser — we can&apos;t tamper after the
            fact.
          </p>
        </div>
        <Chip tone="gold">Algorithm · pack-gen-v2-deterministic</Chip>
      </header>

      {/* DAY PICKER + STATS */}
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Drop day
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Filter packs by drop day"
              className="mt-1 block min-h-11 rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
            />
          </label>
          <Button variant="ghost" size="sm" onClick={() => void list.refresh()}>
            Refresh
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <StatTile
            label="Verifiable"
            value={<span className="text-pv-good">{verifiableCount}</span>}
            tone="good"
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
          <StatTile
            label="Pending reveal"
            value={pendingCount}
            tone="muted"
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
        </div>
      </section>

      {list.loading ? <p className="text-sm font-medium text-pv-muted">Loading packs…</p> : null}
      {list.error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-sm font-medium text-[#fca5a5]"
        >
          {list.error}
        </p>
      ) : null}

      {!list.loading && !list.error && list.packs.length === 0 ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-sm text-pv-muted">
          No packs found for the selected day.
        </div>
      ) : null}

      {!list.loading && !list.error && groups.length > 0
        ? groups.map((group) => (
            <section
              key={group.dropId}
              className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-pv-h2">
                  {formatDateTime(group.dropScheduledAt)} · Drop {group.dropId.slice(0, 8)}
                </div>
                <div className="text-[12px] text-pv-muted">{group.packs.length} of yours</div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                      <th className="border-b border-pv-line px-2 py-2">Pack</th>
                      <th className="border-b border-pv-line px-2 py-2">Tier</th>
                      <th className="border-b border-pv-line px-2 py-2">Status</th>
                      <th className="border-b border-pv-line px-2 py-2">Purchased</th>
                      <th className="border-b border-pv-line px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.packs.map((pack) => (
                      <tr key={pack.id} className="border-b border-pv-line last:border-b-0">
                        <td className="px-2 py-3 font-mono text-[12px] text-pv-muted">
                          {pack.id.slice(0, 8)}…
                        </td>
                        <td className="px-2 py-3">
                          <Chip tone={tierChipTone(pack.tier)}>{formatTierLabel(pack.tier)}</Chip>
                        </td>
                        <td className="px-2 py-3">{statusCell(pack.verificationStatus)}</td>
                        <td className="px-2 py-3 text-[12px] text-pv-muted">
                          {formatDateTime(pack.purchasedAt)}
                        </td>
                        <td className="px-2 py-3 text-right">
                          {pack.verificationStatus === "SEED_UNREVEALED" ? (
                            <Link
                              href={routes.packs.reveal(pack.id)}
                              className={buttonClassName({ variant: "ghost", size: "xs" })}
                            >
                              Open pack first
                            </Link>
                          ) : (
                            <Link
                              href={routes.fairness.verify(pack.id)}
                              className={buttonClassName({ variant: "secondary", size: "xs" })}
                            >
                              Verify
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        : null}

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
