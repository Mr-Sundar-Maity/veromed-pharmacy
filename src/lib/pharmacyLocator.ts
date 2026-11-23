export interface NearbyPharmacy {
  id: string;
  tenant_name: string;
  license_number: string;
  address: string;
  distanceKm: number;
  etaMinutes: number;
  isOpenNow: boolean;
  is24Hours: boolean;
  deliveryAvailable: boolean;
  expressPickup: boolean;
  hoursLabel: string;
  phone: string;
  services: string[];
  mapX: number; // 0..800 mock SVG coordinates
  mapY: number; // 0..500 mock SVG coordinates
}

export interface PharmacyFilterOptions {
  query?: string;
  open24hOnly?: boolean;
  deliveryOnly?: boolean;
  preferredPharmacyId?: string | null;
}

const DIRECTORY_SPATIAL_PROFILE: Record<
  string,
  Omit<NearbyPharmacy, 'id' | 'tenant_name' | 'license_number' | 'address'>
> = {
  'pharm-1': {
    distanceKm: 0.6,
    etaMinutes: 8,
    isOpenNow: true,
    is24Hours: false,
    deliveryAvailable: true,
    expressPickup: true,
    hoursLabel: '08:00 – 23:00 Daily',
    phone: '+91-22-2640-4821',
    services: ['Express Pickup', 'Cold-Chain Insulin', 'Same-Day Delivery'],
    mapX: 465,
    mapY: 225,
  },
  'pharm-3': {
    distanceKm: 1.1,
    etaMinutes: 12,
    isOpenNow: true,
    is24Hours: false,
    deliveryAvailable: true,
    expressPickup: true,
    hoursLabel: '07:30 – 22:30 Daily',
    phone: '+91-22-2642-5190',
    services: ['Express Pickup', 'Diabetes Care', 'Same-Day Delivery'],
    mapX: 310,
    mapY: 315,
  },
  'pharm-4': {
    distanceKm: 1.4,
    etaMinutes: 15,
    isOpenNow: true,
    is24Hours: true,
    deliveryAvailable: true,
    expressPickup: true,
    hoursLabel: 'Open 24 Hours',
    phone: '+91-22-2600-6341',
    services: ['24/7 Emergency Counter', 'Express Pickup', 'Same-Day Delivery'],
    mapX: 205,
    mapY: 165,
  },
  'pharm-5': {
    distanceKm: 1.9,
    etaMinutes: 18,
    isOpenNow: true,
    is24Hours: false,
    deliveryAvailable: false,
    expressPickup: true,
    hoursLabel: '09:00 – 21:30 Mon–Sat',
    phone: '+91-22-2648-8821',
    services: ['Compounding Counter', 'Express Pickup'],
    mapX: 590,
    mapY: 350,
  },
  'pharm-2': {
    distanceKm: 4.8,
    etaMinutes: 26,
    isOpenNow: true,
    is24Hours: true,
    deliveryAvailable: true,
    expressPickup: false,
    hoursLabel: 'Open 24 Hours',
    phone: '+91-22-2265-7710',
    services: ['24/7 Hospital Liaison', 'Same-Day Delivery'],
    mapX: 675,
    mapY: 130,
  },
};

export function enrichPharmacyWithMapMetadata(row: {
  id: string;
  tenant_name: string;
  license_number: string;
  address: string;
}): NearbyPharmacy {
  const preset = DIRECTORY_SPATIAL_PROFILE[row.id];
  if (preset) {
    return { ...row, ...preset };
  }
  // Deterministic fallback position for newly registered pharmacies
  const hash = Array.from(row.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return {
    ...row,
    distanceKm: 2.5 + (hash % 30) / 10,
    etaMinutes: 18 + (hash % 15),
    isOpenNow: true,
    is24Hours: false,
    deliveryAvailable: true,
    expressPickup: true,
    hoursLabel: '09:00 – 22:00 Daily',
    phone: '+91-22-2650-1000',
    services: ['Express Pickup', 'Standard Refill'],
    mapX: 160 + (hash % 480),
    mapY: 110 + ((hash * 7) % 280),
  };
}

export function filterAndSortNearbyPharmacies(
  pharmacies: NearbyPharmacy[],
  options?: PharmacyFilterOptions
): NearbyPharmacy[] {
  const q = (options?.query ?? '').trim().toLowerCase();
  const open24hOnly = Boolean(options?.open24hOnly);
  const deliveryOnly = Boolean(options?.deliveryOnly);
  const preferredId = options?.preferredPharmacyId ?? null;

  return pharmacies
    .filter((p) => {
      if (open24hOnly && !p.is24Hours) return false;
      if (deliveryOnly && !p.deliveryAvailable) return false;
      if (!q) return true;
      return (
        p.tenant_name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.license_number.toLowerCase().includes(q) ||
        p.services.some((s) => s.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      if (preferredId && a.id === preferredId) return -1;
      if (preferredId && b.id === preferredId) return 1;
      return a.distanceKm - b.distanceKm;
    });
}
