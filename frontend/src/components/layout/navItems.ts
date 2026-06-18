import type { LucideIcon } from "lucide-react";
import { BarChart2 } from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { label: "Dashboard", to: "/demo/chart", icon: BarChart2 },
];
