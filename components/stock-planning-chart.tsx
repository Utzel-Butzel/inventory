"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { DAY_MS, type StockPlan } from "@/lib/stock-planning";
import { planningChartSeries, stockChartPath, stockChartValue, type ChartScale } from "@/lib/stock-planning-chart";

const colors = ["#3b82f6", "#f59e0b", "#a855f7", "#10b981"];

type Props = { items: StockPlan[]; generatedAt: string; horizon: number; scale?: ChartScale; compact?: boolean };

export function StockPlanningChart({ items, generatedAt, horizon, scale = "quantity", compact = false }: Props) {
  const { t, i18n } = useT("stock");
  const [cursor, setCursor] = useState(0);
  const [chartWidth, setChartWidth] = useState(900);
  const figure = useRef<HTMLElement>(null);
  useEffect(() => {
    if (compact || !figure.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setChartWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, [compact]);
  const day = Math.min(horizon, cursor);
  const locale = i18n.resolvedLanguage ?? "en";
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const date = (offset: number) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(new Date(generatedAt).getTime() + offset * DAY_MS));
  const series = items.flatMap((item, index) => {
    const data = planningChartSeries(item, horizon, scale);
    return data ? [{ item, data, color: colors[index % colors.length] }] : [];
  });
  const values = series.flatMap(({ data }) => [...data.history, ...data.projection].map((point) => point.quantity));
  if (series.length === 1) values.push(series[0].data.safety);
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const width = compact ? 220 : chartWidth, height = compact ? 64 : 280;
  const left = compact ? 3 : 54, right = width - (compact ? 3 : 24);
  const top = compact ? 5 : 22, bottom = height - (compact ? 5 : 32);
  const x = (value: number) => left + (value + 90) / (90 + horizon) * (right - left);
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
  const unit = scale === "relative" ? "%" : items[0]?.unitName ?? "";
  const label = compact ? t("planning.charts.miniLabel", { name: items[0]?.name }) : t("planning.charts.title");
  return <figure ref={figure} className={compact ? "w-full" : "min-w-0 space-y-3"}>
    {!compact && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><span>{unit}</span><span>━ {t("planning.charts.history")}</span><span>┄ {t("planning.charts.forecast")}</span><span>● {t("planning.charts.delivery")}</span>{series.length === 1 && <span className="text-warning">┄ {t("planning.charts.safety")}</span>}</div>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="w-full overflow-visible" onPointerMove={compact ? undefined : (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setCursor(Math.round(Math.max(-90, Math.min(horizon, (((event.clientX - rect.left) / rect.width * width - left) / (right - left)) * (90 + horizon) - 90))));
    }}>
      <title>{label}</title>
      <rect x={x(0)} y={top} width={right - x(0)} height={bottom - top} fill="currentColor" className="text-brand" opacity="0.045" />
      {!compact && [low, (high + low) / 2, high].map((value) => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="currentColor" className="text-border" /><text x={left - 8} y={y(value) + 4} textAnchor="end" fill="currentColor" className="text-muted" fontSize="11">{number.format(value)}</text></g>)}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-muted" opacity="0.5" />
      <line x1={x(0)} x2={x(0)} y1={top} y2={bottom} stroke="currentColor" className="text-muted" strokeDasharray="2 4" />
      {series.length === 1 && <line x1={x(0)} x2={right} y1={y(series[0].data.safety)} y2={y(series[0].data.safety)} stroke="currentColor" className="text-warning" strokeDasharray="6 5" opacity="0.65" />}
      {series.map(({ item, data, color }) => <g key={item.resourceId}>
        <path d={stockChartPath(data.history, x, y, true)} fill="none" stroke={color} strokeWidth={compact ? 1.8 : 2.5} />
        <path d={stockChartPath(data.projection, x, y)} fill="none" stroke={color} strokeWidth={compact ? 1.8 : 2.5} strokeDasharray={compact ? "4 3" : "7 5"} />
        <circle cx={x(0)} cy={y(data.current)} r={compact ? 2.5 : 4} fill={color} />
        {data.deliveries.map((point, index) => <circle key={index} cx={x(point.day)} cy={y(point.quantity)} r={compact ? 2 : 4} fill={color}><title>{t("planning.charts.delivery")} · {date(point.day)}</title></circle>)}
      </g>)}
      {!compact && <>
        <line x1={x(day)} x2={x(day)} y1={top} y2={bottom} stroke="currentColor" className="text-muted" opacity="0.4" />
        {(width < 500 ? [-90, 0, horizon] : [-90, -45, 0, horizon / 2, horizon]).map((offset) => <text key={offset} x={x(offset)} y={height - 9} textAnchor="middle" fill="currentColor" className="text-muted" fontSize="11">{offset === 0 ? t("planning.today") : date(offset)}</text>)}
      </>}
    </svg>
    {!compact && <>
      <label className="flex items-center gap-3 text-xs text-muted"><span className="shrink-0">{t("planning.charts.date")}</span><input type="range" min={-90} max={horizon} step="1" value={day} onChange={(event) => setCursor(Number(event.target.value))} className="min-w-0 flex-1 accent-blue-600" /><span className="w-24 text-right tabular-nums">{date(day)}</span></label>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-live="polite">
        {series.map(({ item, data, color }) => {
          const value = day === 0 ? data.current : stockChartValue(day < 0 ? data.history : data.projection, day, day > 0);
          return <span key={item.resourceId}><span style={{ color }}>●</span> {item.name}: <strong className="tabular-nums">{value === null ? "—" : `${number.format(value)} ${unit}`}</strong></span>;
        })}
      </div>
      {series.length < items.length && <p className="text-xs text-warning">{t("planning.charts.zeroHint")}</p>}
      {items.some((item) => item.dailyUsage <= 0) && <p className="text-xs text-muted">{t("planning.charts.noForecast")}</p>}
      <figcaption className="text-xs leading-relaxed text-muted">{t("planning.charts.hint")}</figcaption>
    </>}
  </figure>;
}
