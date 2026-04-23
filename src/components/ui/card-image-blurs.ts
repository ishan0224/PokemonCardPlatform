import type { RarityTier } from "@/lib/types";

// Tiny base64 blur placeholders per rarity tier (each <200 bytes).
// 4x4 pixel PNGs with the dominant color of each rarity's glow.
export const rarityBlurMap: Record<RarityTier, string> = {
  common:     "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12NobGxkYAAABDgBkS8nwQAAAABJRU5ErkJggg==",
  uncommon:   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12NoaGhgYAAAA/gBkXtSzRkAAAAASUVORK5CYII=",
  rare:       "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12NISEhgYAAAAwQBkZfLEqgAAAAASUVORK5CYII=",
  holo_rare:  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12M4c+YMAwADhAG/CB7KVAAAAABJRU5ErkJggg==",
  ultra_rare: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12OYP38+AwADZAG/mKG7WwAAAABJRU5ErkJggg==",
  chase:      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADklEQVQI12P4//8/AwAI/AL+hc2rNAAAAABJRU5ErkJggg=="
};
