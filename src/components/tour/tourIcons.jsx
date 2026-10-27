// Icons used by the Platform Tour (imported one by one to keep the bundle small)
import {
  LayoutDashboard, Gauge, Magnet, Target, Lightbulb, CalendarDays, ClipboardCheck, BookOpen,
  Wallet, ListChecks, Receipt, Building2, GraduationCap, ShieldCheck, Compass,
} from 'lucide-react';

export const TOUR_ICONS = {
  LayoutDashboard, Gauge, Magnet, Target, Lightbulb, CalendarDays, ClipboardCheck, BookOpen,
  Wallet, ListChecks, Receipt, Building2, GraduationCap, ShieldCheck, Compass,
};

export function TourIcon({ name, size = 18, ...rest }) {
  const I = TOUR_ICONS[name] || Compass;
  return <I size={size} strokeWidth={1.8} {...rest} />;
}
