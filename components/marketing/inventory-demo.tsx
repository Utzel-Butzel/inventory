import {
  Box,
  Camera,
  Check,
  CircleDot,
  Drill,
  MoreHorizontal,
  Printer,
  Search,
  Sofa,
  Video,
} from "lucide-react";

const items = [
  {
    icon: Drill,
    name: "Festool Tauchsäge TS 55",
    meta: "TOOL-0042 · Werkstatt / Regal A3",
    stock: "2 Stück",
    status: "Verfügbar",
    tone: "bg-success-soft text-success",
  },
  {
    icon: Printer,
    name: "Prusa MK4S",
    meta: "3DP-0011 · Print Lab / Werkbank 2",
    stock: "3 Stück",
    status: "In Benutzung",
    tone: "bg-brand-soft text-brand",
  },
  {
    icon: Video,
    name: "Sony FX30 Kamera-Kit",
    meta: "MEDIA-0008 · Studio / Schrank C1",
    stock: "1 Set",
    status: "Wartung",
    tone: "bg-warning-soft text-warning",
  },
  {
    icon: Sofa,
    name: "USM Haller Sideboard",
    meta: "FURN-0027 · Büro / Westwand",
    stock: "1 Stück",
    status: "Verfügbar",
    tone: "bg-success-soft text-success",
  },
];

export function InventoryDemo() {
  return (
    <div className="relative mx-auto w-full max-w-[720px]" aria-label="Produktvorschau mit Beispieldaten">
      <div className="pointer-events-none absolute -left-10 top-16 size-44 rounded-full bg-[#8ff0cc]/28 blur-[74px]" />
      <div className="pointer-events-none absolute -right-8 bottom-4 size-56 rounded-full bg-[#665cff]/24 blur-[90px]" />

      <div className="relative overflow-hidden rounded-[26px] border border-white/70 bg-[#17181d] p-2 shadow-[0_34px_90px_rgba(24,20,38,0.26)] ring-1 ring-black/10">
        <div className="flex h-9 items-center gap-1.5 px-3 text-white/45">
          <span className="size-2 rounded-full bg-white/20" />
          <span className="size-2 rounded-full bg-white/20" />
          <span className="size-2 rounded-full bg-white/20" />
          <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.14em]">
            Open Inventory · Demo
          </span>
        </div>

        <div className="overflow-hidden rounded-[19px] bg-[#f5f6f8] text-[#17191c]">
          <div className="flex items-center gap-3 border-b border-[#e3e6ea] bg-white px-4 py-3 sm:px-5">
            <span className="grid size-8 place-items-center rounded-xl bg-[#5147d9] text-white">
              <Box className="size-4" />
            </span>
            <div>
              <p className="text-[10px] font-semibold">Makerspace Dresden</p>
              <p className="text-[8px] text-[#7d8490]">Inventarübersicht</p>
            </div>
            <div className="ml-auto hidden items-center gap-1.5 rounded-lg border border-[#e3e6ea] px-2.5 py-2 text-[8px] text-[#8b919b] sm:flex">
              <Search className="size-3" />
              Inventar durchsuchen …
            </div>
            <span className="rounded-full bg-[#eeedff] px-2.5 py-1.5 text-[7px] font-semibold uppercase tracking-[0.12em] text-[#5147d9]">
              Beispieldaten
            </span>
          </div>

          <div className="grid gap-3 p-3 sm:grid-cols-[1fr_190px] sm:p-4">
            <div className="min-w-0">
              <div className="grid grid-cols-4 gap-2">
                {[
                  ["4", "Einträge"],
                  ["7", "Einheiten"],
                  ["7.924 €", "Wert"],
                  ["1", "Wartung"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-[#e3e6ea] bg-white px-2.5 py-2.5">
                    <p className="text-[12px] font-semibold tracking-[-0.03em] sm:text-[15px]">{value}</p>
                    <p className="mt-0.5 text-[7px] text-[#858c97] sm:text-[8px]">{label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-2 overflow-hidden rounded-xl border border-[#e3e6ea] bg-white">
                <div className="flex items-center border-b border-[#edf0f2] px-3 py-2.5">
                  <p className="text-[9px] font-semibold">Zuletzt erfasst</p>
                  <span className="ml-auto text-[7px] text-[#777f8a]">Alle anzeigen</span>
                </div>
                <div className="divide-y divide-[#edf0f2]">
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.name} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
                        <span className="grid size-7 place-items-center rounded-lg bg-[#f1f2f4] text-[#646b76]">
                          <Icon className="size-3.5" strokeWidth={1.8} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[8px] font-semibold sm:text-[9px]">{item.name}</p>
                          <p className="mt-0.5 truncate text-[6.5px] text-[#8b929d] sm:text-[7px]">{item.meta}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[7px] font-semibold">{item.stock}</p>
                          <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[6px] font-semibold ${item.tone}`}>
                            {item.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-rows-[auto_1fr]">
              <div className="rounded-xl bg-[#17181d] p-3 text-white">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-[#8ff0cc] text-[#17382d]">
                    <Camera className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-[8px] font-semibold">Serienerfassung</p>
                    <p className="text-[6.5px] text-white/50">Bereit fürs nächste Objekt</p>
                  </div>
                  <CircleDot className="ml-auto size-3 text-[#8ff0cc]" />
                </div>
                <div className="mt-3 grid gap-1.5">
                  {[
                    ["Foto hochgeladen", "fertig"],
                    ["Details vorgeschlagen", "fertig"],
                    ["Titelbild erstellt", "fertig"],
                  ].map(([label, state]) => (
                    <div key={label} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-2 py-2">
                      <Check className="size-3 text-[#8ff0cc]" />
                      <span className="text-[6.5px] text-white/70">{label}</span>
                      <span className="sr-only">{state}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#e3e6ea] bg-white p-3">
                <p className="text-[7px] font-semibold uppercase tracking-[0.13em] text-[#777f8a]">Gerade ergänzt</p>
                <div className="mt-3 rounded-lg bg-[#f5f6f8] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-[#26282f] text-[#8ff0cc]">
                      <Drill className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[8px] font-semibold">Akku-Schlagschrauber</p>
                      <p className="mt-0.5 text-[6.5px] text-[#838a95]">18 V · Werkzeug · A1-03</p>
                    </div>
                    <MoreHorizontal className="ml-auto size-3 text-[#9ba1aa]" />
                  </div>
                  <div className="mt-2 flex gap-1">
                    {['18 V', 'Werkstatt', 'verfügbar'].map((tag) => (
                      <span key={tag} className="rounded-full bg-[#eeedff] px-1.5 py-1 text-[5.5px] font-medium text-[#5147d9]">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
