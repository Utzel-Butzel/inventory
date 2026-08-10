"use client";

import Link from "next/link";
import { Box, ExternalLink, LoaderCircle, MapPin, MapPinned, Navigation, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchJson, type ClientResource } from "@/lib/client-types";

export function InventoryMap() {
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<{ resources: ClientResource[] }>("/api/v1/resources?pageSize=100")
      .then((response) => {
        setResources(response.resources);
        setSelectedId(
          response.resources.find(
            (resource) =>
              resource.gpsLatitude !== null && resource.gpsLongitude !== null,
          )?.id ?? null,
        );
      })
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "Unable to load locations."),
      )
      .finally(() => setLoading(false));
  }, []);

  const located = useMemo(
    () =>
      resources.filter(
        (resource) =>
          resource.gpsLatitude !== null &&
          resource.gpsLongitude !== null &&
          (!query ||
            `${resource.name} ${resource.location ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [query, resources],
  );
  const unlocated = resources.filter(
    (resource) => resource.gpsLatitude === null || resource.gpsLongitude === null,
  ).length;
  const selected = located.find((resource) => resource.id === selectedId) ?? located[0];

  const bounds = useMemo(() => {
    if (!located.length) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }
    const latitudes = located.map((resource) => resource.gpsLatitude!);
    const longitudes = located.map((resource) => resource.gpsLongitude!);
    return {
      minLat: Math.min(...latitudes),
      maxLat: Math.max(...latitudes),
      minLng: Math.min(...longitudes),
      maxLng: Math.max(...longitudes),
    };
  }, [located]);

  const pinPosition = (resource: ClientResource) => {
    const latRange = Math.max(0.01, bounds.maxLat - bounds.minLat);
    const lngRange = Math.max(0.01, bounds.maxLng - bounds.minLng);
    const left = 10 + ((resource.gpsLongitude! - bounds.minLng) / lngRange) * 80;
    const top = 90 - ((resource.gpsLatitude! - bounds.minLat) / latRange) * 80;
    return { left: `${Math.min(90, Math.max(10, left))}%`, top: `${Math.min(90, Math.max(10, top))}%` };
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-70px)] w-full max-w-[1600px] flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700"><MapPinned size={14} /> Location view</div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950">Where everything lives.</h1>
          <p className="mt-2 text-sm text-slate-500">{located.length} positioned items · {unlocated} still need coordinates</p>
        </div>
        <label className="relative block w-full sm:w-80"><Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter locations…" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10" /></label>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="grid flex-1 place-items-center"><LoaderCircle className="animate-spin text-slate-400" /></div> : (
        <div className="grid min-h-[660px] flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_14px_50px_rgba(15,23,42,0.07)] lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500">Located items</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {located.length ? located.map((resource) => (
                <button key={resource.id} type="button" onClick={() => setSelectedId(resource.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${selected?.id === resource.id ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-slate-50"}`}>
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {resource.cover?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resource.cover.url} alt="" className="h-full w-full object-cover" />
                    ) : <div className="grid h-full place-items-center text-slate-400"><Box size={18} /></div>}
                  </div>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{resource.name}</p><p className="mt-0.5 truncate text-xs text-slate-400">{resource.location || `${resource.gpsLatitude?.toFixed(4)}, ${resource.gpsLongitude?.toFixed(4)}`}</p></div>
                </button>
              )) : <div className="px-3 py-10 text-center text-sm text-slate-400">No positioned items match.</div>}
            </div>
          </aside>

          <div className="relative min-h-[520px] overflow-hidden bg-[#e7eee8]">
            <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(34deg,transparent_46%,rgba(255,255,255,.9)_47%,rgba(255,255,255,.9)_53%,transparent_54%),linear-gradient(126deg,transparent_46%,rgba(255,255,255,.75)_47%,rgba(255,255,255,.75)_52%,transparent_53%),radial-gradient(circle_at_20%_25%,rgba(112,164,129,.2),transparent_25%),radial-gradient(circle_at_80%_75%,rgba(112,164,129,.25),transparent_30%)] [background-size:190px_140px,260px_180px,100%_100%,100%_100%]" />
            <div className="absolute inset-0 [background-image:linear-gradient(rgba(63,91,72,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(63,91,72,.08)_1px,transparent_1px)] [background-size:32px_32px]" />
            {located.map((resource) => (
              <button key={resource.id} type="button" onClick={() => setSelectedId(resource.id)} style={pinPosition(resource)} className={`absolute -translate-x-1/2 -translate-y-full transition hover:z-20 hover:scale-110 ${selected?.id === resource.id ? "z-10 scale-110" : "z-0"}`} aria-label={`Select ${resource.name}`}>
                <span className={`grid h-10 w-10 place-items-center rounded-full rounded-bl-md border-2 border-white shadow-lg transition ${selected?.id === resource.id ? "rotate-[-45deg] bg-slate-950 text-white" : "rotate-[-45deg] bg-emerald-600 text-white"}`}><MapPin size={17} className="rotate-45" fill="currentColor" /></span>
              </button>
            ))}

            {selected ? (
              <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/70 bg-white/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:w-[390px]">
                <div className="flex gap-3"><div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">{selected.cover?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.cover.url} alt="" className="h-full w-full object-cover" />
                ) : <div className="grid h-full place-items-center text-slate-400"><Box size={24} /></div>}</div><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-950">{selected.name}</h2><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Navigation size={12} /> {selected.gpsLatitude?.toFixed(6)}, {selected.gpsLongitude?.toFixed(6)}</p><p className="mt-1 truncate text-xs text-slate-400">{selected.location || "No location label"}</p></div></div>
                <div className="mt-3 flex gap-2"><Link href={`/inventory/${selected.id}`} className="flex-1 rounded-xl bg-slate-950 px-3 py-2 text-center text-xs font-semibold text-white">Open item</Link><a href={`https://www.openstreetmap.org/?mlat=${selected.gpsLatitude}&mlon=${selected.gpsLongitude}#map=18/${selected.gpsLatitude}/${selected.gpsLongitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Real map <ExternalLink size={12} /></a></div>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Add GPS coordinates to inventory items to see them here.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
