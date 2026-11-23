import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
  Compass,
  MapPin,
  Minus,
  Navigation,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import { apiFetch } from '../../types/api';
import {
  filterAndSortNearbyPharmacies,
  type NearbyPharmacy,
} from '../../lib/pharmacyLocator';

interface NearbyPharmaciesResponse {
  pharmacies: NearbyPharmacy[];
  preferredPharmacyId: string | null;
  patientLocation: {
    label: string;
    mapX: number;
    mapY: number;
  };
}

interface PharmacyLocatorViewProps {
  patientId?: string;
  isCaregiver?: boolean;
  onNavigate?: (tab: string) => void;
}

export const PharmacyLocatorView: React.FC<PharmacyLocatorViewProps> = ({
  patientId = 'me',
  isCaregiver = false,
  onNavigate,
}) => {
  const [pharmacies, setPharmacies] = useState<NearbyPharmacy[]>([]);
  const [preferredPharmacyId, setPreferredPharmacyId] = useState<string | null>(null);
  const [patientLocation, setPatientLocation] = useState({
    label: 'Bandra West, Mumbai',
    mapX: 400,
    mapY: 250,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open24hOnly, setOpen24hOnly] = useState(false);
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function loadNearbyPharmacies() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<NearbyPharmaciesResponse>(
        `/pharmacies/nearby?patientId=${encodeURIComponent(patientId)}`
      );
      setPharmacies(res.pharmacies);
      setPreferredPharmacyId(res.preferredPharmacyId);
      if (res.patientLocation) {
        setPatientLocation(res.patientLocation);
      }
      setSelectedId((prev) => {
        if (prev && res.pharmacies.some((p) => p.id === prev)) return prev;
        return res.preferredPharmacyId || res.pharmacies[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load nearby pharmacies.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNearbyPharmacies();
  }, [patientId]);

  const filteredPharmacies = useMemo(
    () =>
      filterAndSortNearbyPharmacies(pharmacies, {
        query,
        open24hOnly,
        deliveryOnly,
        preferredPharmacyId,
      }),
    [pharmacies, query, open24hOnly, deliveryOnly, preferredPharmacyId]
  );

  const selectedPharmacy = useMemo(() => {
    return (
      filteredPharmacies.find((p) => p.id === selectedId) ||
      pharmacies.find((p) => p.id === selectedId) ||
      filteredPharmacies[0] ||
      null
    );
  }, [filteredPharmacies, pharmacies, selectedId]);

  const preferredPharmacy = useMemo(
    () => pharmacies.find((p) => p.id === preferredPharmacyId) || null,
    [pharmacies, preferredPharmacyId]
  );

  async function handleSelectPreferred(pharmacy: NearbyPharmacy) {
    if (isCaregiver) return;
    setSavingId(pharmacy.id);
    setFeedback(null);
    try {
      const res = await apiFetch<{
        preferredPharmacyId: string;
        pharmacy: NearbyPharmacy;
      }>('/patients/me/preferred-pharmacy', {
        method: 'PATCH',
        body: JSON.stringify({ pharmacyId: pharmacy.id }),
      });
      setPreferredPharmacyId(res.preferredPharmacyId);
      setSelectedId(res.preferredPharmacyId);
      setFeedback({
        type: 'success',
        message: `${pharmacy.tenant_name} is now your preferred pharmacy for medication refills.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update preferred pharmacy.',
      });
    } finally {
      setSavingId(null);
    }
  }

  function handleZoomIn() {
    setZoom((prev) => Math.min(1.6, Number((prev + 0.2).toFixed(1))));
  }

  function handleZoomOut() {
    setZoom((prev) => Math.max(0.8, Number((prev - 0.2).toFixed(1))));
  }

  function handleZoomReset() {
    setZoom(1);
    if (preferredPharmacyId) {
      setSelectedId(preferredPharmacyId);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-24 bg-white border border-slate-200 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-[460px] bg-white border border-slate-200 rounded-xl" />
          <div className="lg:col-span-5 h-[460px] bg-white border border-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Nearby Pharmacy Locator
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Explore licensed partner pharmacies around {patientLocation.label} and set your default refill destination.
          </p>
        </div>

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Refills</span>
          </button>
        )}
      </div>

      {/* Current Preferred Refill Pharmacy Banner */}
      <section
        aria-label="Preferred Refill Pharmacy"
        className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-teal-700" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
              Preferred Refill Pharmacy
            </p>
            {preferredPharmacy ? (
              <>
                <p className="font-display text-base font-bold text-slate-900 mt-0.5 truncate">
                  {preferredPharmacy.tenant_name}
                </p>
                <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                  {preferredPharmacy.address} · {preferredPharmacy.distanceKm.toFixed(1)} km (~{preferredPharmacy.etaMinutes} min) · {preferredPharmacy.hoursLabel}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-600 mt-0.5">
                No default refill pharmacy selected yet. Pick one from the map or directory below.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0 tabular-nums">
          <span>{pharmacies.length} licensed partner pharmacies within 5 km</span>
        </div>
      </section>

      {/* Update Feedback Banner */}
      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-teal-50 border-teal-200 text-teal-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Check className="w-4 h-4 shrink-0" />
            <span>{feedback.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {feedback.type === 'success' && onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="px-2.5 py-1 text-xs font-semibold text-teal-900 bg-white border border-teal-300 hover:bg-teal-100 rounded-md cursor-pointer whitespace-nowrap"
              >
                Go to Refills
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss status notice"
              onClick={() => setFeedback(null)}
              className="p-1 rounded hover:bg-black/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Search nearby pharmacies"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by pharmacy name, street, license, or service..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            aria-pressed={!open24hOnly && !deliveryOnly}
            onClick={() => {
              setOpen24hOnly(false);
              setDeliveryOnly(false);
            }}
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
              !open24hOnly && !deliveryOnly
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            All ({pharmacies.length})
          </button>

          <button
            type="button"
            aria-pressed={open24hOnly}
            onClick={() => setOpen24hOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
              open24hOnly
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Open 24/7</span>
          </button>

          <button
            type="button"
            aria-pressed={deliveryOnly}
            onClick={() => setDeliveryOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
              deliveryOnly
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Same-Day Delivery</span>
          </button>
        </div>
      </div>

      {/* Main Split: Mock Interactive Map (Left 7 cols) + Pharmacy Directory (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Mock Interactive Map Canvas */}
        <section
          aria-label="Interactive Pharmacy Map"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 ring-2 ring-blue-200" />
                <span>Your Location</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-600" />
                <span>Preferred</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span>Partner Pharmacy</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Zoom out map"
                onClick={handleZoomOut}
                className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs text-slate-600 px-1.5 tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="Zoom in map"
                onClick={handleZoomIn}
                className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset map view"
                onClick={handleZoomReset}
                className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="relative bg-slate-100 overflow-hidden select-none">
            <svg
              viewBox="0 0 800 500"
              role="img"
              aria-label="Mock neighborhood street map displaying nearby pharmacies"
              className="w-full h-[360px] sm:h-[440px] block"
            >
              <g
                transform={`translate(400 250) scale(${zoom}) translate(-400 -250)`}
                style={{ transition: 'transform 180ms ease-out' }}
              >
                {/* Land & Coastal Strip */}
                <rect x="0" y="0" width="800" height="500" fill="#eef2f6" />
                <path
                  d="M 0 0 L 125 0 C 108 145, 92 315, 76 500 L 0 500 Z"
                  fill="#dbeafe"
                />
                <path
                  d="M 125 0 C 108 145, 92 315, 76 500"
                  fill="none"
                  stroke="#93c5fd"
                  strokeWidth="3"
                />
                <text
                  x="48"
                  y="255"
                  transform="rotate(-84 48 255)"
                  fill="#2563eb"
                  fontSize="11"
                  fontWeight="600"
                  letterSpacing="2"
                  opacity="0.7"
                >
                  ARABIAN SEAFRONT
                </text>

                {/* Parks / Civic Blocks */}
                <rect x="175" y="65" width="110" height="65" rx="8" fill="#dcfce7" stroke="#bbf7d0" />
                <text x="230" y="102" textAnchor="middle" fill="#166534" fontSize="10" fontWeight="600">
                  Joggers Park
                </text>
                <rect x="520" y="265" width="130" height="75" rx="8" fill="#dcfce7" stroke="#bbf7d0" />
                <text x="585" y="306" textAnchor="middle" fill="#166534" fontSize="10" fontWeight="600">
                  Bandra Civic Oval
                </text>

                {/* Urban Block Grid */}
                <g fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1">
                  <rect x="160" y="150" width="135" height="90" rx="4" />
                  <rect x="320" y="70" width="150" height="80" rx="4" />
                  <rect x="495" y="65" width="180" height="90" rx="4" />
                  <rect x="320" y="175" width="160" height="95" rx="4" />
                  <rect x="505" y="175" width="170" height="70" rx="4" />
                  <rect x="155" y="270" width="145" height="105" rx="4" />
                  <rect x="325" y="290" width="165" height="90" rx="4" />
                  <rect x="155" y="395" width="210" height="70" rx="4" />
                  <rect x="395" y="395" width="245" height="70" rx="4" />
                </g>

                {/* Secondary Streets */}
                <g stroke="#cbd5e1" strokeWidth="4" fill="none">
                  <line x1="120" y1="60" x2="770" y2="60" />
                  <line x1="100" y1="382" x2="770" y2="382" />
                  <line x1="150" y1="15" x2="150" y2="485" />
                  <line x1="685" y1="15" x2="685" y2="485" />
                </g>

                {/* Main Arterial Roads */}
                <g stroke="#ffffff" strokeWidth="10" strokeLinecap="round" fill="none">
                  <line x1="95" y1="162" x2="780" y2="162" />
                  <line x1="88" y1="255" x2="780" y2="255" />
                  <line x1="305" y1="10" x2="305" y2="490" />
                  <line x1="490" y1="10" x2="490" y2="490" />
                </g>
                <g stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="5 5" fill="none" opacity="0.7">
                  <line x1="95" y1="162" x2="780" y2="162" />
                  <line x1="88" y1="255" x2="780" y2="255" />
                  <line x1="305" y1="10" x2="305" y2="490" />
                  <line x1="490" y1="10" x2="490" y2="490" />
                </g>

                {/* Road Labels */}
                <g fill="#475569" fontSize="10" fontWeight="600" fontFamily="ui-sans-serif, system-ui">
                  <text x="395" y="156">Pali Hill Avenue</text>
                  <text x="565" y="249">Hill Road Corridor</text>
                  <text x="312" y="42">Turner Road</text>
                  <text x="498" y="42">Linking Road</text>
                </g>

                {/* Distance Rings Around Patient */}
                <circle
                  cx={patientLocation.mapX}
                  cy={patientLocation.mapY}
                  r={105}
                  fill="#0f766e"
                  fillOpacity="0.04"
                  stroke="#0f766e"
                  strokeOpacity="0.25"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={patientLocation.mapX}
                  cy={patientLocation.mapY}
                  r={225}
                  fill="none"
                  stroke="#64748b"
                  strokeOpacity="0.22"
                  strokeDasharray="4 4"
                />
                <text x={patientLocation.mapX + 76} y={patientLocation.mapY - 68} fill="#0f766e" fontSize="9" fontWeight="600">
                  1.0 km radius
                </text>

                {/* Route Line to Selected Pharmacy */}
                {selectedPharmacy && (
                  <line
                    x1={patientLocation.mapX}
                    y1={patientLocation.mapY}
                    x2={selectedPharmacy.mapX}
                    y2={selectedPharmacy.mapY}
                    stroke="#0f766e"
                    strokeWidth="2.5"
                    strokeDasharray="6 4"
                    opacity="0.75"
                  />
                )}

                {/* Patient Location Pin */}
                <g transform={`translate(${patientLocation.mapX}, ${patientLocation.mapY})`}>
                  <circle r="14" fill="#2563eb" fillOpacity="0.18" />
                  <circle r="7" fill="#2563eb" stroke="#ffffff" strokeWidth="2.5" />
                  <rect
                    x="-44"
                    y="12"
                    width="88"
                    height="18"
                    rx="4"
                    fill="#1e3a8a"
                  />
                  <text
                    x="0"
                    y="24"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9.5"
                    fontWeight="600"
                  >
                    Your Location
                  </text>
                </g>

                {/* Interactive Pharmacy Markers */}
                {filteredPharmacies.map((pharmacy) => {
                  const isPreferred = pharmacy.id === preferredPharmacyId;
                  const isSelected = selectedPharmacy?.id === pharmacy.id;
                  const pinFill = isPreferred
                    ? '#0f766e'
                    : isSelected
                    ? '#1d4ed8'
                    : '#334155';

                  return (
                    <g
                      key={pharmacy.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Inspect ${pharmacy.tenant_name} (${pharmacy.distanceKm.toFixed(1)} km)`}
                      transform={`translate(${pharmacy.mapX}, ${pharmacy.mapY})`}
                      onClick={() => setSelectedId(pharmacy.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(pharmacy.id);
                        }
                      }}
                      className="cursor-pointer focus:outline-none"
                    >
                      {isSelected && (
                        <circle
                          r="22"
                          fill={pinFill}
                          fillOpacity="0.18"
                          stroke={pinFill}
                          strokeWidth="1.5"
                        />
                      )}
                      {/* Map Pin Teardrop */}
                      <path
                        d="M 0 -28 C -10 -28, -16 -20, -16 -11 C -16 -1, 0 11, 0 11 C 0 11, 16 -1, 16 -11 C 16 -20, 10 -28, 0 -28 Z"
                        fill={pinFill}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      {isPreferred ? (
                        <path
                          d="M -4 -12 L -1 -9 L 5 -16"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : (
                        <circle cx="0" cy="-12" r="4" fill="#ffffff" />
                      )}

                      {/* Compact Pin Label */}
                      <g transform="translate(0, 16)">
                        <rect
                          x="-66"
                          y="0"
                          width="132"
                          height="20"
                          rx="4"
                          fill={isSelected ? '#0f172a' : '#ffffff'}
                          stroke={isSelected ? '#0f172a' : '#cbd5e1'}
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="13"
                          textAnchor="middle"
                          fill={isSelected ? '#ffffff' : '#0f172a'}
                          fontSize="9.5"
                          fontWeight="600"
                        >
                          {pharmacy.tenant_name.length > 21
                            ? `${pharmacy.tenant_name.slice(0, 20)}…`
                            : pharmacy.tenant_name}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Compass & Scale Overlay */}
            <div className="pointer-events-none absolute top-3 inset-x-3 flex items-center justify-between gap-2">
              <div className="bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-700 flex items-center gap-1.5 min-w-0 truncate">
                <Compass className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span className="truncate">
                  Mock Map<span className="hidden sm:inline"> · {patientLocation.label}</span>
                </span>
              </div>
              <div className="bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-600 shrink-0 whitespace-nowrap">
                Scale 1 km
              </div>
            </div>
          </div>

          {/* Selected Pin Inspection Card */}
          {selectedPharmacy ? (
            <div
              aria-label="Selected Pharmacy Details"
              className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    {selectedPharmacy.tenant_name}
                  </h2>
                  {selectedPharmacy.id === preferredPharmacyId && (
                    <span className="text-xs font-semibold text-teal-800">
                      · Preferred for Refills
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  {selectedPharmacy.address} · License {selectedPharmacy.license_number}
                </p>
                <p className="text-xs text-slate-700 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                    <Navigation className="w-3.5 h-3.5 text-teal-700" />
                    <span>
                      {selectedPharmacy.distanceKm.toFixed(1)} km (~{selectedPharmacy.etaMinutes} min)
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span>{selectedPharmacy.hoursLabel}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-500" />
                    <span>{selectedPharmacy.phone}</span>
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Services: {selectedPharmacy.services.join(' · ')}
                </p>
              </div>

              {!isCaregiver && (
                <div className="shrink-0">
                  {selectedPharmacy.id === preferredPharmacyId ? (
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg whitespace-nowrap"
                    >
                      <Check className="w-4 h-4" />
                      <span>Selected for Refills</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={savingId === selectedPharmacy.id}
                      onClick={() => void handleSelectPreferred(selectedPharmacy)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      <MapPin className="w-4 h-4" />
                      <span>
                        {savingId === selectedPharmacy.id
                          ? 'Saving...'
                          : 'Set as Preferred Pharmacy'}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 border-t border-slate-200 text-xs text-slate-500">
              No pharmacies match your active filter criteria. Reset filters to inspect locations on the map.
            </div>
          )}
        </section>

        {/* Pharmacy Directory List (Right 5 cols) */}
        <section
          aria-label="Nearby Pharmacy Directory"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Nearby Pharmacies
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                Showing {filteredPharmacies.length} of {pharmacies.length} locations sorted by distance
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
            {filteredPharmacies.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 text-center">
                No nearby pharmacies match your search or filters.
              </div>
            ) : (
              filteredPharmacies.map((pharmacy) => {
                const isPreferred = pharmacy.id === preferredPharmacyId;
                const isSelected = selectedPharmacy?.id === pharmacy.id;

                return (
                  <div
                    key={pharmacy.id}
                    className={`p-4 transition-colors ${
                      isSelected ? 'bg-teal-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedId(pharmacy.id)}
                        className="text-left min-w-0 flex-1 cursor-pointer focus:outline-none"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-display text-sm font-bold text-slate-900">
                            {pharmacy.tenant_name}
                          </span>
                          {isPreferred && (
                            <span className="text-xs font-semibold text-teal-700">
                              · Preferred
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5 truncate">
                          {pharmacy.address}
                        </p>
                        <p className="text-xs text-slate-700 mt-1 tabular-nums">
                          <span className="font-semibold text-slate-900">
                            {pharmacy.distanceKm.toFixed(1)} km
                          </span>{' '}
                          (~{pharmacy.etaMinutes} min) · {pharmacy.hoursLabel}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          {pharmacy.services.join(' · ')}
                        </p>
                      </button>

                      {!isCaregiver && (
                        <div className="shrink-0">
                          {isPreferred ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg whitespace-nowrap">
                              <Check className="w-3.5 h-3.5" />
                              <span>Preferred</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={savingId === pharmacy.id}
                              aria-label={`Select ${pharmacy.tenant_name} for refills`}
                              onClick={() => void handleSelectPreferred(pharmacy)}
                              className="px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 hover:bg-teal-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                            >
                              {savingId === pharmacy.id ? 'Saving...' : 'Select for Refills'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
