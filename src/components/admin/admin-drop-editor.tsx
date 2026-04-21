"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  apiClient,
  mapApiErrorToMessage,
  type AdminCardSearchItem,
  type AdminCardSetItem,
  type AdminDropMutationInput,
  type AdminDropPreview,
  type AdminDropStatus
} from "@/lib/api-client";
import { formatDateTime, formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { PackTier, RarityTier } from "@/lib/types";

const TIER_ORDER: PackTier[] = ["standard", "premium", "elite"];
const RARITY_ORDER: RarityTier[] = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"];

type EditorTab = "schedule" | "composition";

type AdminDropEditorProps = {
  mode: "create" | "edit";
  dropId?: string;
  initialStatus?: AdminDropStatus;
  initialInput: AdminDropMutationInput;
  initialPreview?: AdminDropPreview | null;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function toIsoFromLocalInput(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function buildPreviewIndex(preview: AdminDropPreview | null): Record<PackTier, AdminDropPreview["tiers"][number] | null> {
  return {
    standard: preview?.tiers.find((tier) => tier.tier === "standard") ?? null,
    premium: preview?.tiers.find((tier) => tier.tier === "premium") ?? null,
    elite: preview?.tiers.find((tier) => tier.tier === "elite") ?? null
  };
}

export function AdminDropEditor({
  mode,
  dropId,
  initialStatus,
  initialInput,
  initialPreview = null
}: AdminDropEditorProps): JSX.Element {
  const router = useRouter();
  const [tab, setTab] = useState<EditorTab>("schedule");
  const [activeTier, setActiveTier] = useState<PackTier>("standard");
  const [draft, setDraft] = useState<AdminDropMutationInput>(initialInput);
  const [preview, setPreview] = useState<AdminDropPreview | null>(initialPreview);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [publishPending, setPublishPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [setItems, setSetItems] = useState<AdminCardSetItem[]>([]);
  const [setCursor, setSetCursor] = useState<string | null>(null);
  const [setsLoading, setSetsLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [searchItems, setSearchItems] = useState<AdminCardSearchItem[]>([]);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const previewRequestKey = useDebouncedValue(JSON.stringify(draft), 350);

  const activeTierInput = useMemo(() => {
    return draft.tiers.find((tier) => tier.tier === activeTier) ?? draft.tiers[0];
  }, [activeTier, draft.tiers]);

  const previewByTier = useMemo(() => buildPreviewIndex(preview), [preview]);

  useEffect(() => {
    const controller = new AbortController();
    setSetsLoading(true);

    void apiClient
      .listAdminCardSets({ limit: 30 }, controller.signal)
      .then((result) => {
        setSetItems(result.items);
        setSetCursor(result.nextCursor);
      })
      .catch((error) => {
        if ((error as { code?: string }).code === "REQUEST_ABORTED") {
          return;
        }
        setFormError(mapApiErrorToMessage(error) || "Failed to load card sets.");
      })
      .finally(() => {
        setSetsLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSearchLoading(true);

    void apiClient
      .searchAdminCards({ query: debouncedSearchQuery, limit: 20 }, controller.signal)
      .then((result) => {
        setSearchItems(result.items);
        setSearchCursor(result.nextCursor);
      })
      .catch((error) => {
        if ((error as { code?: string }).code === "REQUEST_ABORTED") {
          return;
        }
        setFormError(mapApiErrorToMessage(error) || "Failed to search cards.");
      })
      .finally(() => {
        setSearchLoading(false);
      });

    return () => controller.abort();
  }, [debouncedSearchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    setPreviewLoading(true);

    void apiClient
      .previewAdminDrop(JSON.parse(previewRequestKey) as AdminDropMutationInput, controller.signal)
      .then((result) => {
        setPreview(result.preview);
        setPreviewError(null);
      })
      .catch((error) => {
        if ((error as { code?: string }).code === "REQUEST_ABORTED") {
          return;
        }
        setPreviewError(mapApiErrorToMessage(error) || "Failed to build preview.");
      })
      .finally(() => {
        setPreviewLoading(false);
      });

    return () => controller.abort();
  }, [previewRequestKey]);

  const updateTier = (tier: PackTier, updater: (current: AdminDropMutationInput["tiers"][number]) => AdminDropMutationInput["tiers"][number]): void => {
    setDraft((current) => ({
      ...current,
      tiers: current.tiers.map((item) => (item.tier === tier ? updater(item) : item))
    }));
    setSuccessMessage(null);
  };

  const toggleSetKey = (setKey: string): void => {
    updateTier(activeTier, (current) => {
      const has = current.composition.setKeys.includes(setKey);
      return {
        ...current,
        composition: {
          ...current.composition,
          setKeys: has
            ? current.composition.setKeys.filter((value) => value !== setKey)
            : [...current.composition.setKeys, setKey]
        }
      };
    });
  };

  const toggleRarity = (rarity: RarityTier): void => {
    updateTier(activeTier, (current) => {
      const has = current.composition.includedRarities.includes(rarity);
      const next = has
        ? current.composition.includedRarities.filter((value) => value !== rarity)
        : [...current.composition.includedRarities, rarity];

      return {
        ...current,
        composition: {
          ...current.composition,
          includedRarities: next
        }
      };
    });
  };

  const addExplicitCardId = (modeKey: "include" | "exclude", cardId: string): void => {
    updateTier(activeTier, (current) => {
      if (modeKey === "include") {
        if (current.composition.explicitIncludeCardIds.includes(cardId)) {
          return current;
        }

        return {
          ...current,
          composition: {
            ...current.composition,
            explicitIncludeCardIds: [...current.composition.explicitIncludeCardIds, cardId],
            explicitExcludeCardIds: current.composition.explicitExcludeCardIds.filter((value) => value !== cardId)
          }
        };
      }

      if (current.composition.explicitExcludeCardIds.includes(cardId)) {
        return current;
      }

      return {
        ...current,
        composition: {
          ...current.composition,
          explicitExcludeCardIds: [...current.composition.explicitExcludeCardIds, cardId],
          explicitIncludeCardIds: current.composition.explicitIncludeCardIds.filter((value) => value !== cardId)
        }
      };
    });
  };

  const removeExplicitCardId = (modeKey: "include" | "exclude", cardId: string): void => {
    updateTier(activeTier, (current) => ({
      ...current,
      composition: {
        ...current.composition,
        explicitIncludeCardIds:
          modeKey === "include"
            ? current.composition.explicitIncludeCardIds.filter((value) => value !== cardId)
            : current.composition.explicitIncludeCardIds,
        explicitExcludeCardIds:
          modeKey === "exclude"
            ? current.composition.explicitExcludeCardIds.filter((value) => value !== cardId)
            : current.composition.explicitExcludeCardIds
      }
    }));
  };

  const onSave = async (): Promise<void> => {
    setSavePending(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      if (mode === "create") {
        const result = await apiClient.createAdminDrop(draft);
        router.push(routes.admin.dropsEdit(result.drop.id));
        return;
      }

      if (!dropId) {
        throw new Error("Drop ID is missing.");
      }

      await apiClient.updateAdminDrop(dropId, draft);
      setSuccessMessage("Drop saved.");
      router.refresh();
    } catch (error) {
      setFormError(mapApiErrorToMessage(error) || "Failed to save drop.");
    } finally {
      setSavePending(false);
    }
  };

  const onPublish = async (): Promise<void> => {
    if (!dropId) {
      return;
    }

    setPublishPending(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      await apiClient.publishAdminDrop(dropId);
      setSuccessMessage("Drop published.");
      router.push(routes.admin.drops);
      router.refresh();
    } catch (error) {
      setFormError(mapApiErrorToMessage(error) || "Failed to publish drop.");
    } finally {
      setPublishPending(false);
    }
  };

  const loadMoreSets = async (): Promise<void> => {
    if (!setCursor || setsLoading) {
      return;
    }

    setSetsLoading(true);
    setFormError(null);

    try {
      const result = await apiClient.listAdminCardSets({ cursor: setCursor, limit: 30 });
      setSetItems((current) => {
        const existing = new Set(current.map((item) => item.setKey));
        const merged = [...current];
        for (const item of result.items) {
          if (!existing.has(item.setKey)) {
            merged.push(item);
          }
        }
        return merged;
      });
      setSetCursor(result.nextCursor);
    } catch (error) {
      setFormError(mapApiErrorToMessage(error) || "Failed to load more sets.");
    } finally {
      setSetsLoading(false);
    }
  };

  const loadMoreCards = async (): Promise<void> => {
    if (!searchCursor || searchLoading) {
      return;
    }

    setSearchLoading(true);
    setFormError(null);

    try {
      const result = await apiClient.searchAdminCards({
        query: debouncedSearchQuery,
        cursor: searchCursor,
        limit: 20
      });

      setSearchItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        const merged = [...current];
        for (const item of result.items) {
          if (!existing.has(item.id)) {
            merged.push(item);
          }
        }
        return merged;
      });
      setSearchCursor(result.nextCursor);
    } catch (error) {
      setFormError(mapApiErrorToMessage(error) || "Failed to load more cards.");
    } finally {
      setSearchLoading(false);
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    const order: EditorTab[] = ["schedule", "composition"];
    const currentIndex = order.indexOf(tab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + order.length) % order.length;
    const nextTab = order[nextIndex];
    setTab(nextTab);
    const nextId = nextTab === "schedule" ? "drop-tab-trigger-schedule" : "drop-tab-trigger-composition";
    document.getElementById(nextId)?.focus();
  };

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-pv-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-pv-ink">{mode === "create" ? "Schedule Drop" : "Edit Drop"}</h1>
            <p className="mt-1 text-sm text-pv-muted">
              Configure schedule and pack composition, then publish when readiness checks pass.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => router.push(routes.admin.drops)}>
              Back to drops
            </Button>
            {mode === "edit" && initialStatus === "draft" ? (
              <Button variant="primary" loading={publishPending} onClick={() => void onPublish()}>
                {publishPending ? "Publishing..." : "Publish"}
              </Button>
            ) : null}
            <Button variant="primary" loading={savePending} onClick={() => void onSave()}>
              {savePending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </header>

      {formError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p> : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-2xl border border-pv-border bg-white p-4 shadow-sm">
          <div role="tablist" aria-label="Drop editor tabs" className="mb-4 flex gap-2" onKeyDown={onTabKeyDown}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "schedule"}
              aria-controls="drop-tab-schedule"
              id="drop-tab-trigger-schedule"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                tab === "schedule" ? "bg-pv-accent text-white" : "bg-pv-parchment-soft text-pv-ink"
              }`}
              onClick={() => setTab("schedule")}
            >
              Schedule
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "composition"}
              aria-controls="drop-tab-composition"
              id="drop-tab-trigger-composition"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                tab === "composition" ? "bg-pv-accent text-white" : "bg-pv-parchment-soft text-pv-ink"
              }`}
              onClick={() => setTab("composition")}
            >
              Pack composition
            </button>
          </div>

          {tab === "schedule" ? (
            <div id="drop-tab-schedule" role="tabpanel" aria-labelledby="drop-tab-trigger-schedule" className="space-y-4">
              <label className="block text-sm font-semibold text-pv-ink">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-pv-border px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm font-semibold text-pv-ink">
                Scheduled At (local time)
                <input
                  type="datetime-local"
                  value={toLocalInputValue(draft.scheduledAt)}
                  onChange={(event) => {
                    const nextIso = toIsoFromLocalInput(event.target.value);
                    if (nextIso) {
                      setDraft((current) => ({ ...current, scheduledAt: nextIso }));
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-pv-border px-3 py-2 text-sm"
                />
              </label>
              <p className="text-xs text-pv-muted">UTC preview: {formatDateTime(draft.scheduledAt)}</p>

              <label className="inline-flex items-center gap-2 text-sm text-pv-ink">
                <input
                  type="checkbox"
                  checked={draft.lotteryEnabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      lotteryEnabled: event.target.checked
                    }))
                  }
                />
                Enable waiting-room lottery
              </label>

              <label className="block text-sm font-semibold text-pv-ink">
                Max packs per user (drop-wide)
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={draft.maxPacksPerUser}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      maxPacksPerUser: Math.max(1, Math.trunc(Number(event.target.value) || 1))
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-pv-border px-3 py-2 text-sm"
                />
              </label>

              <div className="space-y-3">
                {draft.tiers.map((tier) => (
                  <section key={tier.tier} className="rounded-lg border border-pv-border p-3">
                    <p className="text-sm font-black text-pv-ink">{tier.tier}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-pv-muted">
                        Price (cents)
                        <input
                          type="number"
                          min={50}
                          value={tier.price}
                          onChange={(event) =>
                            updateTier(tier.tier, (current) => ({
                              ...current,
                              price: Math.max(50, Math.trunc(Number(event.target.value) || 50))
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-pv-border px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs font-semibold text-pv-muted">
                        Total inventory
                        <input
                          type="number"
                          min={1}
                          value={tier.totalInventory}
                          onChange={(event) =>
                            updateTier(tier.tier, (current) => ({
                              ...current,
                              totalInventory: Math.max(1, Math.trunc(Number(event.target.value) || 1))
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-pv-border px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div id="drop-tab-composition" role="tabpanel" aria-labelledby="drop-tab-trigger-composition" className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {TIER_ORDER.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setActiveTier(tier)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      activeTier === tier ? "bg-pv-accent text-white" : "bg-pv-parchment-soft text-pv-ink"
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>

              <section className="space-y-2 rounded-lg border border-pv-border p-3">
                <p className="text-sm font-black text-pv-ink">Set filter</p>
                <p className="text-xs text-pv-muted">Choose sets for {activeTier}. Leave empty to include all sets.</p>
                <div className="max-h-44 space-y-1 overflow-auto pr-1">
                  {setItems.map((setItem) => {
                    const checked = activeTierInput.composition.setKeys.includes(setItem.setKey);
                    return (
                      <label key={setItem.setKey} className="flex items-center justify-between gap-2 rounded border border-pv-border px-2 py-1 text-xs">
                        <span>
                          {setItem.setName} <span className="text-pv-muted">({setItem.totalCount})</span>
                        </span>
                        <input type="checkbox" checked={checked} onChange={() => toggleSetKey(setItem.setKey)} />
                      </label>
                    );
                  })}
                </div>
                {setCursor ? (
                  <Button variant="secondary" size="sm" loading={setsLoading} onClick={() => void loadMoreSets()}>
                    Load more sets
                  </Button>
                ) : null}
              </section>

              <section className="space-y-2 rounded-lg border border-pv-border p-3">
                <p className="text-sm font-black text-pv-ink">Included rarities</p>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {RARITY_ORDER.map((rarity) => {
                    const checked = activeTierInput.composition.includedRarities.includes(rarity);
                    return (
                      <label key={rarity} className="flex items-center gap-2 rounded border border-pv-border px-2 py-1 text-xs">
                        <input type="checkbox" checked={checked} onChange={() => toggleRarity(rarity)} />
                        {rarity}
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-2 rounded-lg border border-pv-border p-3">
                <p className="text-sm font-black text-pv-ink">Explicit card include/exclude</p>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search cards by name, set, or TCG ID"
                  className="w-full rounded-lg border border-pv-border px-3 py-2 text-sm"
                />

                <div aria-live="polite" className="text-xs text-pv-muted">
                  {searchLoading ? "Searching..." : `${searchItems.length} cards loaded`}
                </div>

                <div className="max-h-56 space-y-1 overflow-auto pr-1">
                  {searchItems.map((card) => (
                    <div key={card.id} className="rounded border border-pv-border px-2 py-1 text-xs">
                      <p className="font-semibold text-pv-ink">{card.name}</p>
                      <p className="text-pv-muted">
                        {card.rarityTier} · {card.setName} · {formatMoneyCents(card.currentPrice)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Button variant="secondary" size="sm" onClick={() => addExplicitCardId("include", card.id)}>
                          Include
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => addExplicitCardId("exclude", card.id)}>
                          Exclude
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {searchCursor ? (
                  <Button variant="secondary" size="sm" loading={searchLoading} onClick={() => void loadMoreCards()}>
                    Load more cards
                  </Button>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-pv-border p-2">
                    <p className="text-xs font-semibold text-pv-ink">Explicit includes</p>
                    <ul className="mt-1 space-y-1">
                      {activeTierInput.composition.explicitIncludeCardIds.map((cardId) => (
                        <li key={cardId} className="flex items-center justify-between gap-2 text-xs text-pv-muted">
                          <span className="truncate">{cardId}</span>
                          <button className="text-rose-700" onClick={() => removeExplicitCardId("include", cardId)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded border border-pv-border p-2">
                    <p className="text-xs font-semibold text-pv-ink">Explicit excludes</p>
                    <ul className="mt-1 space-y-1">
                      {activeTierInput.composition.explicitExcludeCardIds.map((cardId) => (
                        <li key={cardId} className="flex items-center justify-between gap-2 text-xs text-pv-muted">
                          <span className="truncate">{cardId}</span>
                          <button className="text-rose-700" onClick={() => removeExplicitCardId("exclude", cardId)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-pv-border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black text-pv-ink">Live preview</h2>
          <p className="mt-1 text-xs text-pv-muted">UTC schedule: {formatDateTime(draft.scheduledAt)}</p>
          {previewLoading ? <p className="mt-2 text-xs text-pv-muted">Refreshing preview...</p> : null}
          {previewError ? <p className="mt-2 text-xs text-rose-700">{previewError}</p> : null}

          <div className="mt-3 space-y-3">
            {TIER_ORDER.map((tier) => {
              const tierPreview = previewByTier[tier];
              return (
                <section key={tier} className="rounded-lg border border-pv-border bg-pv-parchment-soft p-3">
                  <p className="text-sm font-bold text-pv-ink">{tier}</p>
                  {tierPreview ? (
                    <>
                      <p className="mt-1 text-xs text-pv-muted">Cards/pack: {tierPreview.cardsPerPack}</p>
                      <div className="mt-2 space-y-1 text-xs text-pv-muted">
                        {tierPreview.slots.map((slot, index) => (
                          <p key={`${tier}-slot-${index + 1}`}>
                            Slot {index + 1}: {slot.map((entry) => `${entry.rarity} ${(entry.weight * 100).toFixed(0)}%`).join(" · ")}
                          </p>
                        ))}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-pv-muted">
                        {RARITY_ORDER.map((rarity) => (
                          <p key={`${tier}-${rarity}`}>
                            {rarity}: {tierPreview.eligibleCounts[rarity]}
                          </p>
                        ))}
                      </div>
                      <p className={`mt-2 text-xs font-semibold ${tierPreview.readiness.ready ? "text-emerald-700" : "text-rose-700"}`}>
                        {tierPreview.readiness.ready ? "Ready to activate" : "Needs more eligible cards"}
                      </p>
                      {tierPreview.readiness.issues.map((issue) => (
                        <p key={`${tier}-${issue.rarity}`} className="text-xs text-rose-700">
                          {issue.rarity}: required {issue.required}, found {issue.actual}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-pv-muted">Preview unavailable.</p>
                  )}
                </section>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}
