"use client";

import { ChangeEvent, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Status = "PASS" | "FAIL" | "REVIEW";
type OcrLine = { text: string; confidence: number; box: number[][] };
type Product = Record<string, string | null>;
type Rule = {
  rule_id: string;
  requirement: string;
  status: Status;
  field: string | null;
  value: string | null;
  explanation: string;
  legal_reference: string;
};
type InspectionResult = {
  success: boolean;
  ocr: { success: boolean; text: OcrLine[] };
  product: Product;
  compliance: { overall_status: Status; rules: Rule[] };
};

const API_URL = `${process.env.NEXT_PUBLIC_API_URL}/inspect`;
const productFields = [
  ["product_name", "Product name"],
  ["manufacturer", "Manufacturer"],
  ["packer", "Packer"],
  ["importer", "Importer"],
  ["net_quantity", "Net quantity"],
  ["mrp", "Maximum retail price"],
  ["batch_number", "Batch number"],
  ["manufacturing_date", "Manufacturing date"],
  ["expiry_date", "Expiry / best before"],
  ["category", "Category"],
] as const;

function statusClasses(status: Status) {
  if (status === "PASS") return { badge: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", panel: "border-emerald-200 bg-emerald-50/70" };
  if (status === "FAIL") return { badge: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-500", panel: "border-red-200 bg-red-50/70" };
  return { badge: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500", panel: "border-amber-200 bg-amber-50/70" };
}

function displayEvidence(value: string | null) {
  return !value || value.trim().toLowerCase() === "not detected" ? "Not detected on submitted label" : value;
}

function reportValue(value: string | null | undefined) {
  return !value || value.trim().toLowerCase() === "not detected" ? "Not detected" : value;
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to add the uploaded image to the report."));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const imageLabels = ["Front", "Back", "Side (optional)"];
  const [imageFiles, setImageFiles] = useState<(File | null)[]>([null, null, null]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([null, null, null]);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleImageChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setResult(null);
    setError(null);
    if (previewUrls[index]) URL.revokeObjectURL(previewUrls[index]!);
    setImageFiles((c) => c.map((f, i) => i === index ? selectedFile : f));
    setPreviewUrls((c) => c.map((u, i) => i !== index ? u : selectedFile ? URL.createObjectURL(selectedFile) : null));
    event.target.value = "";
  }

  function removeImage(index: number) {
    setResult(null);
    setError(null);
    if (previewUrls[index]) URL.revokeObjectURL(previewUrls[index]!);
    setImageFiles((c) => c.map((f, i) => i === index ? null : f));
    setPreviewUrls((c) => c.map((u, i) => i === index ? null : u));
  }

  async function inspectProduct() {
    const selected = imageFiles.filter((f): f is File => f !== null);
    if (selected.length === 0) { setError("Choose a product image before starting an inspection."); return; }
    setIsLoading(true); setError(null); setResult(null);
    try {
      const formData = new FormData();
      selected.forEach((img) => formData.append("image", img, img.name));
      const response = await fetch(API_URL, { method: "POST", body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : "The inspection request failed.");
      setResult(payload as InspectionResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reach the inspection service.");
    } finally {
      setIsLoading(false);
    }
  }

  async function downloadInspectionReport() {
    if (!result) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const inspectionDate = new Date().toLocaleString();
    const pdfStatus = result.compliance.overall_status === "FAIL" ? "NON-COMPLIANT" : result.compliance.overall_status === "PASS" ? "COMPLIANT" : "REVIEW REQUIRED";

    doc.setTextColor(29, 41, 40); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Legal Metrology / Field Desk", margin, 16);
    doc.setFontSize(20); doc.text("Product Compliance Inspection Report", margin, 26);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 112, 106);
    doc.text(`Generated ${inspectionDate}`, margin, 33);

    const reportImage = imageFiles.find((f): f is File => f !== null);
    if (reportImage) {
      try {
        const imageData = await fileAsDataUrl(reportImage);
        const fmt = reportImage.type === "image/png" ? "PNG" : "JPEG";
        doc.addImage(imageData, fmt, pageWidth - margin - 42, 10, 42, 25, undefined, "FAST");
      } catch { /* optional */ }
    }

    doc.setTextColor(29, 41, 40); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("INSPECTION SUMMARY", margin, 47);
    autoTable(doc, {
      startY: 51, margin: { left: margin, right: margin }, theme: "grid",
      head: [["Inspection date/time", "Overall result", "Violations", "Review items"]],
      body: [[inspectionDate, pdfStatus, String(failedRuleCount), String(reviewRuleCount)]],
      headStyles: { fillColor: [29, 41, 40], textColor: [255, 255, 255], fontStyle: "bold" },
      bodyStyles: { textColor: [38, 56, 51], cellPadding: 3 },
      styles: { font: "helvetica", fontSize: 9, overflow: "linebreak" },
    });

    const summaryEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 61;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("PRODUCT INFORMATION", margin, summaryEnd + 13);
    autoTable(doc, {
      startY: summaryEnd + 17, margin: { left: margin, right: margin }, theme: "grid",
      head: [["Field", "Value", "Field", "Value"]],
      body: productFields.reduce<string[][]>((rows, [key, label], index) => {
        if (index % 2 === 0) rows.push([label, reportValue(result.product[key]), "", ""]);
        else rows[rows.length - 1].splice(2, 2, label, reportValue(result.product[key]));
        return rows;
      }, []),
      headStyles: { fillColor: [72, 98, 88], textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 82 }, 2: { cellWidth: 42 }, 3: { cellWidth: "auto" } },
      styles: { font: "helvetica", fontSize: 8.5, overflow: "linebreak", cellPadding: 2.5 },
      alternateRowStyles: { fillColor: [246, 243, 237] },
    });

    const productEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? summaryEnd + 60;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("COMPLIANCE FINDINGS", margin, productEnd + 13);
    autoTable(doc, {
      startY: productEnd + 17, margin: { left: margin, right: margin }, theme: "grid",
      head: [["Rule ID", "Requirement", "Status", "Evidence / value", "Explanation", "Legal reference"]],
      body: result.compliance.rules.map((r) => [r.rule_id, r.requirement, r.status, reportValue(r.value), r.explanation, r.legal_reference]),
      headStyles: { fillColor: [29, 41, 40], textColor: [255, 255, 255], fontStyle: "bold" },
      bodyStyles: { textColor: [38, 56, 51], valign: "top", cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 46 }, 2: { cellWidth: 24 }, 3: { cellWidth: 48 }, 4: { cellWidth: 78 }, 5: { cellWidth: "auto" } },
      styles: { font: "helvetica", fontSize: 8, overflow: "linebreak", cellWidth: "wrap" },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const s = data.cell.raw as Status;
          data.cell.styles.fillColor = s === "FAIL" ? [254, 226, 226] : s === "REVIEW" ? [254, 243, 199] : [209, 250, 229];
          data.cell.styles.textColor = s === "FAIL" ? [153, 27, 27] : s === "REVIEW" ? [146, 64, 14] : [6, 95, 70];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    doc.save("legal-metrology-report.pdf");
  }

  const overallStatus    = result?.compliance.overall_status;
  const overallStyle     = overallStatus ? statusClasses(overallStatus) : null;
  const failedRuleCount  = result?.compliance.rules.filter((r) => r.status === "FAIL").length ?? 0;
  const reviewRuleCount  = result?.compliance.rules.filter((r) => r.status === "REVIEW").length ?? 0;
  const failedRules      = result?.compliance.rules.filter((r) => r.status === "FAIL") ?? [];
  const reviewRules      = result?.compliance.rules.filter((r) => r.status === "REVIEW") ?? [];
  const outcomeLabel     = overallStatus === "FAIL" ? "NON-COMPLIANT" : overallStatus === "PASS" ? "COMPLIANT" : "REVIEW REQUIRED";
  const findingSummary   = [
    failedRuleCount > 0 ? `${failedRuleCount} violation${failedRuleCount === 1 ? "" : "s"} found` : null,
    reviewRuleCount > 0 ? `${reviewRuleCount} item${reviewRuleCount === 1 ? "" : "s"} require review` : null,
  ].filter(Boolean).join(" · ") || "No violations detected";

  return (
    <main className="min-h-screen bg-[#f6f3ed] text-[#1d2928]">
      {/* ── max-width wrapper ── */}
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-8">

        {/* ── HEADER ── */}
        <header className="flex flex-col gap-4 border-b border-[#d8d8ce] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#65716c]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1d2928] text-xs text-[#f6f3ed]">LM</span>
              <span className="truncate">Legal Metrology / Field Desk</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[#172321] sm:text-4xl lg:text-5xl">
              Product inspection,<br className="sm:hidden" /> made legible.
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#68736e]">
              Upload a packaged-food label to extract declarations and review its deterministic compliance checks.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#68736e]">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Inspection service ready
          </div>
        </header>

        {/* ── UPLOAD PANEL ── */}
        <section className="mt-6 rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] p-4 shadow-[0_8px_24px_rgba(39,52,47,0.06)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7d8881]">01 / Source images</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Upload product views</h2>
              <p className="mt-1 text-sm text-[#68736e]">Add the label views available to you.</p>
            </div>
            <span className="rounded-full bg-[#e7eee9] px-3 py-1 text-xs font-bold text-[#486258]">Up to 3 · PNG · JPG</span>
          </div>

          {/* image slots */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {imageLabels.map((label, index) => (
              <div key={label} className="overflow-hidden rounded-xl border border-[#d8d8ce] bg-[#f1f4ef]">
                {/* slot header */}
                <div className="flex items-center justify-between gap-2 border-b border-[#d8d8ce] bg-[#f8faf6] px-3 py-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#65716c]">{label}</span>
                  {imageFiles[index]
                    ? <button type="button" onClick={() => removeImage(index)} className="text-xs font-semibold text-[#a05a43] transition hover:text-[#7f3f2d]">Remove</button>
                    : <span className="text-[11px] text-[#8a958e]">Not selected</span>}
                </div>
                {/* drop zone */}
                <label className="flex h-36 cursor-pointer flex-col items-center justify-center overflow-hidden text-center transition hover:bg-[#e9f0eb] sm:h-44">
                  {previewUrls[index]
                    ? <img src={previewUrls[index]!} alt={`${label} label`} className="h-full w-full object-contain" />
                    : <>
                        <span className="mb-1.5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-[#55756a] shadow-sm">＋</span>
                        <span className="text-xs font-semibold text-[#31423d]">Add {label.toLowerCase()} image</span>
                      </>}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleImageChange(index, e)} className="sr-only" />
                </label>
                {/* filename */}
                {imageFiles[index] && (
                  <p className="truncate border-t border-[#d8d8ce] bg-[#f8faf6] px-3 py-1.5 text-[11px] text-[#7a857f]">
                    {imageFiles[index]!.name}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={inspectProduct}
            disabled={isLoading || imageFiles.every((f) => f === null)}
            className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#d96b42] px-5 py-3.5 text-sm font-bold text-white shadow-[0_6px_16px_rgba(217,107,66,0.25)] transition hover:bg-[#bf5934] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading
              ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Reading label…</>
              : <>Inspect product <span aria-hidden="true">→</span></>}
          </button>
          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-800">
              {error}
            </div>
          )}
        </section>

        {/* ── RESULTS ── */}
        {result && overallStyle ? (
          <div className="mt-6 space-y-5">

            {/* Outcome banner */}
            <div className={`flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${overallStyle.panel}`}>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e7973]">Inspection outcome</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className={`h-3 w-3 shrink-0 rounded-full ${overallStyle.dot}`} />
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{outcomeLabel}</h2>
                </div>
                <p className="mt-2 text-sm font-semibold text-[#52615a]">{findingSummary}</p>
              </div>
              <button
                type="button"
                onClick={downloadInspectionReport}
                className="w-full rounded-xl bg-[#1d2928] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#31423d] sm:w-auto"
              >
                Download report <span aria-hidden="true">↓</span>
              </button>
            </div>

            {/* Declarations */}
            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7d8881]">02 / Declarations</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Product information</h2>
                </div>
                <span className="text-xs text-[#7d8881]">Gemini extraction</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7]">
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {productFields.map(([key, label], index) => (
                    <div
                      key={key}
                      className={[
                        "p-4 border-[#e1e1d9]",
                        index % 2 === 0 ? "sm:border-r" : "",
                        index < productFields.length - (productFields.length % 2 === 0 ? 2 : 1) ? "border-b" : "",
                      ].join(" ")}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a958e]">{label}</p>
                      <p className={`mt-1.5 break-words text-sm font-semibold ${result.product[key] ? "text-[#243530]" : "text-[#9aa39e]"}`}>
                        {result.product[key] || "Not detected"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Inspection Findings */}
            {(failedRules.length > 0 || reviewRules.length > 0) && (
              <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7d8881]">Inspection findings</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Compliance findings</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {failedRules.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        {failedRules.length} violation{failedRules.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {reviewRules.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        {reviewRules.length} require{reviewRules.length === 1 ? "s" : ""} review
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {/* FAIL */}
                  {failedRules.map((rule) => (
                    <article key={`f-${rule.rule_id}`} className="rounded-2xl border border-red-200 bg-red-50/60 p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 text-base" aria-hidden="true">❌</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h3 className="text-sm font-bold text-red-950">{rule.requirement}</h3>
                            <span className="shrink-0 rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 font-mono text-[11px] font-bold text-red-700">{rule.rule_id}</span>
                          </div>
                          <dl className="mt-3 space-y-2 border-t border-red-200 pt-3 text-sm">
                            <div>
                              <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-red-700">Evidence</dt>
                              <dd className="mt-0.5 font-semibold text-red-950">{displayEvidence(rule.value)}</dd>
                            </div>
                            <div>
                              <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-red-700">Explanation</dt>
                              <dd className="mt-0.5 leading-5 text-red-900/80">{rule.explanation}</dd>
                            </div>
                            <div>
                              <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-red-700">Legal reference</dt>
                              <dd className="mt-0.5 text-red-800">{rule.legal_reference}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </article>
                  ))}

                  {/* REVIEW */}
                  {reviewRules.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pt-1">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">Requires Review</p>
                      </div>
                      {reviewRules.map((rule) => (
                        <article key={`r-${rule.rule_id}`} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 shrink-0 text-base" aria-hidden="true">⚠️</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <h3 className="text-sm font-bold text-amber-950">{rule.requirement}</h3>
                                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-700">{rule.rule_id} · REVIEW</span>
                              </div>
                              <dl className="mt-3 space-y-2 border-t border-amber-200 pt-3 text-sm">
                                <div>
                                  <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-700">Evidence</dt>
                                  <dd className="mt-0.5 font-semibold text-amber-950">{displayEvidence(rule.value)}</dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-700">Explanation</dt>
                                  <dd className="mt-0.5 leading-5 text-amber-900/80">
                                    The system could not conclusively determine applicability or presence. {rule.explanation}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-700">Legal reference</dt>
                                  <dd className="mt-0.5 text-amber-800">{rule.legal_reference}</dd>
                                </div>
                              </dl>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* All rules */}
            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7d8881]">03 / Deterministic review</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Compliance rules</h2>
                </div>
                <span className="text-xs text-[#7d8881]">Rule engine output</span>
              </div>
              <div className="space-y-3">
                {result.compliance.rules.map((rule) => {
                  const style = statusClasses(rule.status);
                  return (
                    <article key={rule.rule_id} className="rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-[#a0aaa4]">{rule.rule_id}</span>
                          <div className="min-w-0">
                            <h3 className="text-sm font-bold text-[#263833]">{rule.requirement}</h3>
                            <p className="mt-1 text-sm leading-5 text-[#69756f]">{rule.explanation}</p>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${style.badge}`}>{rule.status}</span>
                      </div>
                      <div className="mt-3 flex flex-col gap-1 border-t border-[#e7e6df] pt-3 text-xs text-[#8a958e] sm:flex-row sm:justify-between sm:gap-4">
                        <span>Value: <strong className="font-semibold text-[#59665f]">{rule.value || "Not detected"}</strong></span>
                        <span className="sm:text-right">{rule.legal_reference}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* OCR evidence */}
            <section className="rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7d8881]">OCR evidence</p>
                  <h2 className="mt-1 text-lg font-semibold">Detected label text</h2>
                </div>
                <span className="text-xs text-[#7d8881]">{result.ocr.text.length} lines</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {result.ocr.text.filter((l) => l.text.trim()).map((line, index) => (
                  <span key={`${line.text}-${index}`} className="rounded-lg border border-[#e1e1d9] bg-[#f6f3ed] px-2.5 py-1.5 text-xs text-[#59665f]">
                    {line.text.trim()}
                    <strong className="ml-1 text-[#9a6b52]">{Math.round(line.confidence * 100)}%</strong>
                  </span>
                ))}
              </div>
            </section>
          </div>

        ) : (
          /* Empty state */
          <div className="mt-6 flex min-h-[280px] flex-col justify-between rounded-2xl border border-[#d8d8ce] bg-[#e9eee9] p-6 sm:min-h-[340px] sm:p-10">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#718078]">Inspection workspace</p>
              <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.04em] text-[#263833] sm:text-4xl lg:text-5xl">
                Every declaration,<br />
                <span className="text-[#668074]">accounted for.</span>
              </h2>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[#cbd7cf] pt-5 text-sm text-[#63736b]">
              <div><strong className="block text-xl font-semibold text-[#31463e] sm:text-2xl">01</strong>Upload label</div>
              <div><strong className="block text-xl font-semibold text-[#31463e] sm:text-2xl">02</strong>Extract fields</div>
              <div><strong className="block text-xl font-semibold text-[#31463e] sm:text-2xl">03</strong>Review rules</div>
            </div>
          </div>
        )}

        <footer className="mt-8 border-t border-[#d8d8ce] pt-4 text-xs leading-5 text-[#87918b]">
          Prototype review surface · Legal Metrology (Packaged Commodities) Rules, 2011 · Results require human verification.
        </footer>
      </div>
    </main>
  );
}