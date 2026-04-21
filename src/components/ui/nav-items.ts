import { routes } from "@/lib/routes";

export type NavRole = "user" | "admin" | null;

export type NavItem = {
  id: string;
  label: string;
  href: string;
  stub?: boolean;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", href: routes.home },
  { id: "drops", label: "Drops", href: routes.drops.index },
  { id: "marketplace", label: "Marketplace", href: routes.marketplace.index },
  { id: "auctions", label: "Auctions", href: routes.auctions.index },
  { id: "collection", label: "Collection", href: routes.collection.index },
  { id: "verify", label: "Verify", href: routes.fairness.verifyIndex, stub: true }
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { id: "admin-home", label: "Admin Home", href: routes.admin.index },
  { id: "admin-economics", label: "Economics", href: routes.admin.economics },
  { id: "admin-auction-flags", label: "Auction Flags", href: routes.admin.auctionFlags },
  { id: "admin-drops", label: "Drops", href: routes.admin.drops, stub: true }
];

export function getNavSections(role: NavRole): NavSection[] {
  const sections: NavSection[] = [
    {
      id: "primary",
      label: "Primary",
      items: PRIMARY_NAV_ITEMS
    }
  ];

  if (role === "admin") {
    sections.push({
      id: "admin",
      label: "Admin",
      items: ADMIN_NAV_ITEMS
    });
  }

  return sections;
}
