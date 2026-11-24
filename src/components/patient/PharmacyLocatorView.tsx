import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Cross, LoaderCircle, LocateFixed, MapPin, Navigation, Search } from 'lucide-react';
import { loadGoogleMaps } from '../../lib/googleMaps';

interface Coordinates { latitude: number; longitude: number }
interface PharmacyResult extends Coordinates {
  id: string;
  name: string;
  address: string;
  googleMapsUri?: string;
  distanceKm: number;
}
interface RouteInfo { distanceKm: number; durationMinutes: number }
interface Props { userId: string; patientId?: string; isCaregiver?: boolean; onNavigate?: (tab: string) => void }

function distanceKm(a: Coordinates, b: Coordinates): number {
  const radius = 6371;
  const lat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const lon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function readLocation(userId: string): Coordinates | null {
  try {
    const raw = localStorage.getItem(`veromed_location_${userId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Coordinates;
    return Number.isFinite(value.latitude) && Number.isFinite(value.longitude) ? value : null;
  } catch { return null; }
}

export const PharmacyLocatorView: React.FC<Props> = ({ userId, isCaregiver = false, onNavigate }) => {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routePolylinesRef = useRef<any[]>([]);
  const placesRef = useRef<Map<string, any>>(new Map());
  const [location, setLocation] = useState<Coordinates | null>(() => readLocation(userId));
  const [pharmacies, setPharmacies] = useState<PharmacyResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setError('Location services are not supported by this browser.'); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      localStorage.setItem(`veromed_location_${userId}`, JSON.stringify({ ...next, accuracy: position.coords.accuracy, capturedAt: new Date().toISOString() }));
      localStorage.setItem(`veromed_location_requested_${userId}`, 'true');
      setLocation(next); setLocating(false);
    }, (reason) => {
      setError(reason.code === reason.PERMISSION_DENIED ? 'Location permission was denied. Allow it in browser settings and try again.' : 'Your location could not be detected. Please try again.');
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 });
  }, [userId]);

  useEffect(() => { if (!location && !isCaregiver) requestLocation(); }, [isCaregiver, location, requestLocation]);

  useEffect(() => {
    if (!location || !mapElementRef.current) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(null); setPharmacies([]); setSelectedId(null); setRoute(null);
      try {
        const google = await loadGoogleMaps();
        const [{ Map }, { Place, SearchNearbyRankPreference }, { AdvancedMarkerElement }] = await Promise.all([
          google.maps.importLibrary('maps'), google.maps.importLibrary('places'), google.maps.importLibrary('marker'),
        ]);
        if (cancelled || !mapElementRef.current) return;
        const center = { lat: location.latitude, lng: location.longitude };
        markersRef.current.forEach(marker => { marker.map = null; });
        markersRef.current = [];
        placesRef.current.clear();
        const map = new Map(mapElementRef.current, { center, zoom: 14, mapId: 'DEMO_MAP_ID', mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
        mapRef.current = map;
        const userMarker = new AdvancedMarkerElement({ map, position: center, title: 'Your location' });
        markersRef.current.push(userMarker);
        const { places } = await Place.searchNearby({
          fields: ['id', 'displayName', 'location', 'formattedAddress', 'googleMapsURI'],
          locationRestriction: { center, radius: 5000 },
          includedPrimaryTypes: ['pharmacy'], maxResultCount: 20,
          rankPreference: SearchNearbyRankPreference.DISTANCE,
        });
        if (cancelled) return;
        const results: PharmacyResult[] = [];
        for (const place of places) {
          if (!place.id || !place.location) continue;
          const point = { latitude: place.location.lat(), longitude: place.location.lng() };
          placesRef.current.set(place.id, place);
          results.push({ id: place.id, name: place.displayName || 'Pharmacy', address: place.formattedAddress || 'Address available on Google Maps', googleMapsUri: place.googleMapsURI, ...point, distanceKm: distanceKm(location, point) });
          const marker = new AdvancedMarkerElement({ map, position: place.location, title: place.displayName || 'Pharmacy' });
          marker.addListener('click', () => setSelectedId(place.id));
          markersRef.current.push(marker);
        }
        results.sort((a, b) => a.distanceKm - b.distanceKm);
        setPharmacies(results); setSelectedId(results[0]?.id ?? null);
        if (!results.length) setError('Google Maps found no pharmacies within 5 km of your location.');
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Google Maps pharmacy search failed.');
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [location]);

  const selected = useMemo(() => pharmacies.find(p => p.id === selectedId) ?? null, [pharmacies, selectedId]);

  useEffect(() => {
    if (!location || !selected || !mapRef.current) { setRoute(null); return; }
    let cancelled = false;
    const loadRoute = async () => {
      setRouteLoading(true); setRoute(null);
      routePolylinesRef.current.forEach(polyline => polyline.setMap(null));
      routePolylinesRef.current = [];
      try {
        const google = await loadGoogleMaps();
        const [{ Route }, { LatLngBounds }] = await Promise.all([google.maps.importLibrary('routes'), google.maps.importLibrary('core')]);
        const destination = placesRef.current.get(selected.id) || { lat: selected.latitude, lng: selected.longitude };
        const response = await Route.computeRoutes({
          origin: { lat: location.latitude, lng: location.longitude }, destination,
          travelMode: 'DRIVING', fields: ['path', 'distanceMeters', 'durationMillis'],
        });
        const best = response.routes?.[0];
        if (cancelled || !best) throw new Error('Google Maps could not calculate a driving route.');
        const polylines = best.createPolylines();
        polylines.forEach((polyline: any) => polyline.setMap(mapRef.current));
        routePolylinesRef.current = polylines;
        const bounds = new LatLngBounds();
        best.path?.forEach((point: any) => bounds.extend(point));
        mapRef.current.fitBounds(bounds, 60);
        setRoute({ distanceKm: (best.distanceMeters || 0) / 1000, durationMinutes: Math.max(1, Math.round((best.durationMillis || 0) / 60000)) });
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Route calculation failed.');
      } finally { if (!cancelled) setRouteLoading(false); }
    };
    void loadRoute(); return () => { cancelled = true; };
  }, [location, selected]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? pharmacies.filter(p => `${p.name} ${p.address}`.toLowerCase().includes(value)) : pharmacies;
  }, [pharmacies, query]);

  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div><h1 className="font-display text-2xl font-bold text-slate-900">Nearby Pharmacy Locator</h1><p className="text-sm text-slate-600 mt-1">Live Google Maps pharmacies around your location, sorted by distance.</p></div>
      <div className="flex gap-2"><button type="button" onClick={requestLocation} disabled={locating} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 rounded-lg disabled:opacity-60">{locating ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />} Update Location</button>{onNavigate && <button type="button" onClick={() => onNavigate('dashboard')} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"><ArrowLeft className="w-4 h-4" /> Back</button>}</div>
    </div>
    {error && <div role="alert" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">{error}</div>}
    {!location ? <section className="bg-white border border-slate-200 rounded-xl p-10 text-center"><LocateFixed className="w-10 h-10 text-teal-700 mx-auto" /><h2 className="font-display font-bold text-lg mt-3">Allow location access</h2><p className="text-sm text-slate-600 mt-1">Location is needed to find Google Maps pharmacies and calculate the shortest route.</p><button type="button" onClick={requestLocation} className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg">Allow Location</button></section> :
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"><div className="px-4 py-3 border-b flex items-center justify-between"><div><h2 className="font-display font-bold">Google Maps Route</h2><p className="text-xs text-slate-500">{selected ? `${selected.name} · ${route ? `${route.distanceKm.toFixed(1)} km · about ${route.durationMinutes} min` : 'calculating...'}` : 'Select a pharmacy'}</p></div>{routeLoading && <LoaderCircle className="w-4 h-4 animate-spin" />}</div><div ref={mapElementRef} className="w-full h-[460px] bg-slate-100" />{selected && <div className="p-4 border-t flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold">{selected.name}</p><p className="text-xs text-slate-600">{selected.address}</p></div><a href={selected.googleMapsUri || `https://www.google.com/maps/dir/?api=1&origin=${location.latitude},${location.longitude}&destination=${selected.latitude},${selected.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg"><Navigation className="w-4 h-4" /> Open in Google Maps</a></div>}</section>
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden"><div className="p-4 border-b"><h2 className="font-display font-bold">Google Pharmacies Near You</h2><p className="text-xs text-slate-500">{loading ? 'Searching Google Maps...' : `${pharmacies.length} locations within 5 km`}</p><div className="relative mt-3"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pharmacy or address" className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"/></div></div><div className="divide-y max-h-[560px] overflow-y-auto">{loading ? <div className="p-8 flex justify-center gap-2 text-sm"><LoaderCircle className="w-5 h-5 animate-spin" /> Loading Google Places...</div> : filtered.map(pharmacy => <button key={pharmacy.id} type="button" onClick={() => setSelectedId(pharmacy.id)} className={`w-full p-4 text-left ${selectedId === pharmacy.id ? 'bg-teal-50' : 'hover:bg-slate-50'}`}><div className="flex gap-3"><span className={`p-2 h-fit rounded-lg ${selectedId === pharmacy.id ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}><Cross className="w-4 h-4"/></span><div><p className="text-sm font-bold">{pharmacy.name}</p><p className="text-xs text-slate-600">{pharmacy.address}</p><p className="text-xs font-semibold text-teal-800 mt-1"><MapPin className="w-3 h-3 inline mr-1"/>{pharmacy.distanceKm.toFixed(1)} km away</p></div></div></button>)}</div></section>
      </div>}
  </div>;
};
