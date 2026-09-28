import {
  Bath,
  Boxes,
  BrickWall,
  ClipboardList,
  DoorOpen,
  Droplets,
  Flame,
  Grid2x2,
  Hammer,
  Lightbulb,
  MessageCircle,
  Package,
  PaintRoller,
  Percent,
  QrCode,
  ShieldCheck,
  Truck,
  Warehouse,
  Zap,
  type LucideProps,
} from "lucide-react";

/**
 * Ícones referenciados por NOME nos dados (categorias, atalhos). Mapa estático
 * para não embarcar a biblioteca inteira no bundle do cliente.
 */
const ICONS = {
  Bath,
  Boxes,
  BrickWall,
  ClipboardList,
  DoorOpen,
  Droplets,
  Flame,
  Grid2x2,
  Hammer,
  Lightbulb,
  MessageCircle,
  Package,
  PaintRoller,
  Percent,
  QrCode,
  ShieldCheck,
  Truck,
  Warehouse,
  Zap,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = (ICONS as Record<string, React.ComponentType<LucideProps>>)[name] ?? Package;
  return <Cmp aria-hidden="true" {...props} />;
}
