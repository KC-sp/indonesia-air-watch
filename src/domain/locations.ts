import type { City } from './air.js';

export type SupportedLocation = City & { latitude: number; longitude: number };

export const SUPPORTED_LOCATIONS: SupportedLocation[] = [
  { city: 'Jakarta', state: 'Jakarta', latitude: -6.2088, longitude: 106.8456 },
  { city: 'Bogor', state: 'West Java', latitude: -6.5971, longitude: 106.8060 },
  { city: 'Bekasi', state: 'West Java', latitude: -6.2383, longitude: 106.9756 },
  { city: 'Tangerang', state: 'Banten', latitude: -6.1783, longitude: 106.6319 },
  { city: 'Depok', state: 'West Java', latitude: -6.4025, longitude: 106.7942 },
  { city: 'Bandung', state: 'West Java', latitude: -6.9175, longitude: 107.6191 },
  { city: 'Semarang', state: 'Central Java', latitude: -6.9667, longitude: 110.4167 },
  { city: 'Surabaya', state: 'East Java', latitude: -7.2575, longitude: 112.7521 },
  { city: 'Yogyakarta', state: 'Yogyakarta', latitude: -7.7956, longitude: 110.3695 },
  { city: 'Medan', state: 'North Sumatra', latitude: 3.5952, longitude: 98.6722 },
  { city: 'Pekanbaru', state: 'Riau', latitude: 0.5071, longitude: 101.4478 },
  { city: 'Palembang', state: 'South Sumatra', latitude: -2.9761, longitude: 104.7754 },
  { city: 'Pontianak', state: 'West Kalimantan', latitude: -0.0263, longitude: 109.3425 },
  { city: 'Banjarmasin', state: 'South Kalimantan', latitude: -3.3194, longitude: 114.5908 },
  { city: 'Makassar', state: 'South Sulawesi', latitude: -5.1477, longitude: 119.4327 },
  { city: 'Denpasar', state: 'Bali', latitude: -8.6705, longitude: 115.2126 },
  { city: 'Balikpapan', state: 'East Kalimantan', latitude: -1.2379, longitude: 116.8529 },
];

export function nearestSupportedLocation(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined;
  return SUPPORTED_LOCATIONS
    .map((location, index) => ({ location, index, distanceKm: haversineKm(latitude, longitude, location.latitude, location.longitude) }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0];
}

export function haversineKm(latitude1: number, longitude1: number, latitude2: number, longitude2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusKm = 6_371;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const first = radians(latitude1);
  const second = radians(latitude2);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(first) * Math.cos(second) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
