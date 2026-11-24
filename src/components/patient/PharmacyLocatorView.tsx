import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cross, LoaderCircle, LocateFixed, MapPin, Navigation, Search } from 'lucide-react';

interface Coordinates { latitude: number; longitude: number }
interface PharmacyResult extends Coordinates { id: string; name: string; address: string; phone?: string; distanceKm: number }
interface RouteInfo { distanceKm: number; durationMinutes: number; coordinates: Array<[number, number]> }
interface Props { userId: string; patientId?: string; isCaregiver?: boolean; onNavigate?: (tab: string) => void }

function distanceKm(a: Coordinates, b: Coordinates): number {
  const r = 6371;
  const lat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const lon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
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
    if (!location) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const q = `[out:json][timeout:25];(nwr["amenity"="pharmacy"](around:5000,${location.latitude},${location.longitude}););out center tags;`;
        const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }), signal: controller.signal });
        if (!response.ok) throw new Error('Nearby pharmacy service is temporarily unavailable.');
        const data = await response.json() as { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
        const results = (data.elements ?? []).map((item): PharmacyResult | null => {
          const latitude = item.lat ?? item.center?.lat; const longitude = item.lon ?? item.center?.lon;
          if (latitude === undefined || longitude === undefined) return null;
          const tags = item.tags ?? {};
          const address = tags['addr:full'] || [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb']].filter(Boolean).join(', ') || 'Address available on map';
          const point = { latitude, longitude };
          return { id: `${item.type}-${item.id}`, name: tags.name || tags.brand || 'Local Pharmacy', address, phone: tags.phone || tags['contact:phone'], ...point, distanceKm: distanceKm(location, point) };
        }).filter((item): item is PharmacyResult => item !== null).sort((a, b) => a.distanceKm - b.distanceKm);
        setPharmacies(results); setSelectedId(results[0]?.id ?? null);
        if (!results.length) setError('No mapped pharmacies were found within 5 km.');
      } catch (reason) {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to find nearby pharmacies.');
      } finally { setLoading(false); }
    };
    void load(); return () => controller.abort();
  }, [location]);

  const selected = useMemo(() => pharmacies.find((p) => p.id === selectedId) ?? null, [pharmacies, selectedId]);

  useEffect(() => {
    if (!location || !selected) { setRoute(null); return; }
    const controller = new AbortController();
    const load = async () => {
      setRouteLoading(true); setRoute(null);
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${location.longitude},${location.latitude};${selected.longitude},${selected.latitude}?overview=full&geometries=geojson`;
        const response = await fetch(url, { signal: controller.signal });
        const data = await response.json() as { routes?: Array<{ distance: number; duration: number; geometry: { coordinates: Array<[number, number]> } }> };
        const best = data.routes?.[0];
        if (best) setRoute({ distanceKm: best.distance / 1000, durationMinutes: Math.max(1, Math.round(best.duration / 60)), coordinates: best.geometry.coordinates });
      } catch (reason) { if ((reason as Error).name !== 'AbortError') setRoute(null); }
      finally { setRouteLoading(false); }
    };
    void load(); return () => controller.abort();
  }, [location, selected]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? pharmacies.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(value)) : pharmacies;
  }, [pharmacies, query]);

  const mapDrawing = useMemo(() => {
    if (!location || !selected) return null;
    const points = route?.coordinates ?? [[location.longitude, location.latitude], [selected.longitude, selected.latitude]];
    const lons = points.map(([lon]) => lon); const lats = points.map(([, lat]) => lat);
    const minLon = Math.min(...lons); const minLat = Math.min(...lats);
    const lonSpan = Math.max(Math.max(...lons) - minLon, .002); const latSpan = Math.max(Math.max(...lats) - minLat, .002);
    const project = ([lon, lat]: [number, number]) => [50 + ((lon - minLon) / lonSpan) * 700, 450 - ((lat - minLat) / latSpan) * 400];
    return {
      points: points.map(point => project(point).join(',')).join(' '),
      user: project([location.longitude, location.latitude]),
      pharmacy: project([selected.longitude, selected.latitude]),
    };
  }, [location, route, selected]);

  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div><h1 className="font-display text-2xl font-bold text-slate-900">Nearby Pharmacy Locator</h1><p className="text-sm text-slate-600 mt-1">Live pharmacies around your location, sorted by distance.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={requestLocation} disabled={locating} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 rounded-lg disabled:opacity-60">{locating ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />} Update Location</button>
        {onNavigate && <button type="button" onClick={() => onNavigate('dashboard')} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"><ArrowLeft className="w-4 h-4" /> Back</button>}
      </div>
    </div>
    {error && <div role="alert" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">{error}</div>}
    {!location ? <section className="bg-white border border-slate-200 rounded-xl p-10 text-center"><LocateFixed className="w-10 h-10 text-teal-700 mx-auto" /><h2 className="font-display font-bold text-lg mt-3">Allow location access</h2><p className="text-sm text-slate-600 mt-1">Location is needed to find pharmacies and calculate the shortest route.</p><button type="button" onClick={requestLocation} className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg">Allow Location</button></section> :
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between"><div><h2 className="font-display font-bold">Shortest Route</h2><p className="text-xs text-slate-500">{selected ? `${selected.name} · ${route ? `${route.distanceKm.toFixed(1)} km · about ${route.durationMinutes} min` : 'calculating...'}` : 'Select a pharmacy'}</p></div>{routeLoading && <LoaderCircle className="w-4 h-4 animate-spin" />}</div>
          <svg viewBox="0 0 800 500" className="w-full h-[420px] bg-slate-100" role="img" aria-label="Shortest route to selected pharmacy"><defs><pattern id="roads" width="90" height="70" patternUnits="userSpaceOnUse"><path d="M0 35H90M45 0V70" stroke="#fff" strokeWidth="9"/><path d="M0 35H90M45 0V70" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="5 5"/></pattern></defs><rect width="800" height="500" fill="#e8eef2"/><rect width="800" height="500" fill="url(#roads)"/>{mapDrawing && <><polyline points={mapDrawing.points} fill="none" stroke="#0f766e" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/><circle cx={mapDrawing.user[0]} cy={mapDrawing.user[1]} r="13" fill="#2563eb" stroke="white" strokeWidth="5"/><circle cx={mapDrawing.pharmacy[0]} cy={mapDrawing.pharmacy[1]} r="13" fill="#0f766e" stroke="white" strokeWidth="5"/></>}<text x="50" y="485" fontSize="13" fontWeight="700">Your location</text><text x="750" y="25" textAnchor="end" fontSize="13" fontWeight="700">{selected?.name}</text></svg>
          {selected && <div className="p-4 border-t flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold">{selected.name}</p><p className="text-xs text-slate-600">{selected.address}</p></div><a href={`https://www.google.com/maps/dir/?api=1&origin=${location.latitude},${location.longitude}&destination=${selected.latitude},${selected.longitude}&travelmode=driving`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg"><Navigation className="w-4 h-4" /> Open Navigation</a></div>}
        </section>
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b"><h2 className="font-display font-bold">Pharmacies Near You</h2><p className="text-xs text-slate-500">{loading ? 'Searching live map data...' : `${pharmacies.length} locations within 5 km`}</p><div className="relative mt-3"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search pharmacy or address" className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"/></div></div>
          <div className="divide-y max-h-[520px] overflow-y-auto">{loading ? <div className="p-8 flex justify-center gap-2 text-sm"><LoaderCircle className="w-5 h-5 animate-spin" /> Finding nearby pharmacies...</div> : filtered.map(p => <button key={p.id} type="button" onClick={() => setSelectedId(p.id)} className={`w-full p-4 text-left ${selectedId === p.id ? 'bg-teal-50' : 'hover:bg-slate-50'}`}><div className="flex gap-3"><span className={`p-2 h-fit rounded-lg ${selectedId === p.id ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}><Cross className="w-4 h-4"/></span><div><p className="text-sm font-bold">{p.name}</p><p className="text-xs text-slate-600">{p.address}</p><p className="text-xs font-semibold text-teal-800 mt-1"><MapPin className="w-3 h-3 inline mr-1"/>{p.distanceKm.toFixed(1)} km away</p></div></div></button>)}</div>
        </section>
      </div>}
  </div>;
};
