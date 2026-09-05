"use client";

import { ChangeEvent, useEffect, useState } from "react";
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
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setResult(null);
    setError(null);
    setFile(selectedFile);
    setPreviewUrl(selectedFile ? URL.createObjectURL(selectedFile) : null);
  }

  async function inspectProduct() {
    if (!file) {
      setError("Choose a product image before starting an inspection.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch(API_URL, { method: "POST", body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : "The inspection request failed.");
      setResult(payload as InspectionResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reach the inspection service.");
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
    const pdfStatus = result.compliance.overall_status === "FAIL"
      ? "NON-COMPLIANT"
      : result.compliance.overall_status === "PASS"
        ? "COMPLIANT"
        : "REVIEW REQUIRED";

    doc.setTextColor(29, 41, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Legal Metrology / Field Desk", margin, 16);
    doc.setFontSize(20);
    doc.text("Product Compliance Inspection Report", margin, 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 112, 106);
    doc.text(`Generated ${inspectionDate}`, margin, 33);

    if (file) {
      try {
        const imageData = await fileAsDataUrl(file);
        const imageFormat = file.type === "image/png" ? "PNG" : "JPEG";
        doc.addImage(imageData, imageFormat, pageWidth - margin - 42, 10, 42, 25, undefined, "FAST");
      } catch {
        // The report remains usable if the browser cannot read the optional image.
      }
    }

    doc.setTextColor(29, 41, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("INSPECTION SUMMARY", margin, 47);
    autoTable(doc, {
      startY: 51,
      margin: { left: margin, right: margin },
      theme: "grid",
      head: [["Inspection date/time", "Overall result", "Violations", "Review items"]],
      body: [[inspectionDate, pdfStatus, String(failedRuleCount), String(reviewRuleCount)]],
      headStyles: { fillColor: [29, 41, 40], textColor: [255, 255, 255], fontStyle: "bold" },
      bodyStyles: { textColor: [38, 56, 51], cellPadding: 3 },
      styles: { font: "helvetica", fontSize: 9, overflow: "linebreak" },
    });

    const summaryEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 61;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("PRODUCT INFORMATION", margin, summaryEnd + 13);
    autoTable(doc, {
      startY: summaryEnd + 17,
      margin: { left: margin, right: margin },
      theme: "grid",
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
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("COMPLIANCE FINDINGS", margin, productEnd + 13);
    autoTable(doc, {
      startY: productEnd + 17,
      margin: { left: margin, right: margin },
      theme: "grid",
      head: [["Rule ID", "Requirement", "Status", "Evidence / value", "Explanation", "Legal reference"]],
      body: result.compliance.rules.map((rule) => [
        rule.rule_id,
        rule.requirement,
        rule.status,
        reportValue(rule.value),
        rule.explanation,
        rule.legal_reference,
      ]),
      headStyles: { fillColor: [29, 41, 40], textColor: [255, 255, 255], fontStyle: "bold" },
      bodyStyles: { textColor: [38, 56, 51], valign: "top", cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 46 }, 2: { cellWidth: 24 }, 3: { cellWidth: 48 }, 4: { cellWidth: 78 }, 5: { cellWidth: "auto" } },
      styles: { font: "helvetica", fontSize: 8, overflow: "linebreak", cellWidth: "wrap" },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const status = data.cell.raw as Status;
          data.cell.styles.fillColor = status === "FAIL" ? [254, 226, 226] : status === "REVIEW" ? [254, 243, 199] : [209, 250, 229];
          data.cell.styles.textColor = status === "FAIL" ? [153, 27, 27] : status === "REVIEW" ? [146, 64, 14] : [6, 95, 70];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    doc.save("legal-metrology-report.pdf");
  }

  const overallStatus = result?.compliance.overall_status;
  const overallStyle = overallStatus ? statusClasses(overallStatus) : null;
  const failedRuleCount = result?.compliance.rules.filter((rule) => rule.status === "FAIL").length ?? 0;
  const reviewRuleCount = result?.compliance.rules.filter((rule) => rule.status === "REVIEW").length ?? 0;
  const outcomeLabel = overallStatus === "FAIL"
    ? "NON-COMPLIANT"
    : overallStatus === "PASS"
      ? "COMPLIANT"
      : "REVIEW REQUIRED";
  const violationSummary = failedRuleCount === 0
    ? "No compliance violations detected."
    : `${failedRuleCount} compliance violation${failedRuleCount === 1 ? "" : "s"} found.`;

  return (
    <main className="min-h-screen bg-[#f6f3ed] text-[#1d2928]">
      <div className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
        <header className="flex flex-col gap-6 border-b border-[#d8d8ce] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-5 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-[#65716c]"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1d2928] text-sm text-[#f6f3ed]">LM</span>Legal Metrology / Field Desk</div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[#172321] sm:text-5xl">Product inspection, made legible.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68736e] sm:text-base">Upload a packaged-food label to extract declarations and review its deterministic compliance checks.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#68736e]"><span className="h-2 w-2 rounded-full bg-emerald-500" />Inspection service ready</div>
        </header>

        <section className="grid gap-7 py-8 lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.6fr)]">
          <div className="rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] p-5 shadow-[0_16px_40px_rgba(39,52,47,0.06)] sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7d8881]">01 / Source image</p><h2 className="mt-2 text-xl font-semibold tracking-tight">Choose a label</h2></div><span className="rounded-full bg-[#e7eee9] px-3 py-1 text-xs font-bold text-[#486258]">PNG · JPG</span></div>
            <label className="mt-6 flex min-h-64 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#aebcb4] bg-[#f1f4ef] text-center transition hover:border-[#55756a] hover:bg-[#e9f0eb]">
              {previewUrl ? <img src={previewUrl} alt="Selected product label" className="h-64 w-full object-contain" /> : <><span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl text-[#55756a] shadow-sm">＋</span><span className="text-sm font-semibold text-[#31423d]">Drop an image here</span><span className="mt-1 text-xs text-[#84908a]">or browse from your device</span></>}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} className="sr-only" />
            </label>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[#7a857f]"><span className="truncate">{file ? file.name : "No image selected"}</span>{file && <span>{Math.ceil(file.size / 1024)} KB</span>}</div>
            <button type="button" onClick={inspectProduct} disabled={isLoading} className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-[#d96b42] px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(217,107,66,0.2)] transition hover:bg-[#bf5934] disabled:cursor-wait disabled:opacity-60">
              {isLoading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Reading label...</> : <>Inspect product <span aria-hidden="true">→</span></>}
            </button>
            {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-800">{error}</div>}
          </div>

          <div className="min-w-0">
            {result && overallStyle ? <div className="space-y-7">
              <div className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${overallStyle.panel}`}><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6e7973]">Inspection outcome</p><div className="mt-2 flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${overallStyle.dot}`} /><h2 className="text-3xl font-semibold tracking-[-0.03em]">{outcomeLabel}</h2></div><p className="mt-3 text-sm font-semibold text-[#52615a]">{violationSummary}</p></div><div className="flex flex-col items-start gap-3 sm:items-end"><p className="max-w-sm text-sm leading-5 text-[#64706a]">Review the failed requirements below before taking action.</p><button type="button" onClick={downloadInspectionReport} className="rounded-xl bg-[#1d2928] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#31423d]">Download Inspection Report <span aria-hidden="true">↓</span></button></div></div>
              <section><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7d8881]">02 / Declarations</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Product information</h2></div><span className="text-xs text-[#7d8881]">Gemini extraction</span></div><div className="grid overflow-hidden rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] sm:grid-cols-2">{productFields.map(([key, label], index) => <div key={key} className={`border-[#e1e1d9] p-4 ${index % 2 === 0 ? "sm:border-r" : ""} ${index < productFields.length - 2 ? "border-b" : ""}`}><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8a958e]">{label}</p><p className={`mt-2 break-words text-sm font-semibold ${result.product[key] ? "text-[#243530]" : "text-[#9aa39e]"}`}>{result.product[key] || "Not detected"}</p></div>)}</div></section>
              <section className="space-y-5"><div className="flex flex-col gap-2 border-b border-[#d8d8ce] pb-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7d8881]">Inspection findings</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Inspection Findings</h2></div><p className="text-sm font-semibold text-[#69756f]">{failedRuleCount} violation{failedRuleCount === 1 ? "" : "s"} found · {reviewRuleCount} item{reviewRuleCount === 1 ? "" : "s"} require review</p></div><div className="space-y-3">{result.compliance.rules.filter((rule) => rule.status === "FAIL").map((rule) => <article key={`finding-${rule.rule_id}`} className="rounded-2xl border border-red-200 bg-red-50/70 p-4 shadow-[0_8px_20px_rgba(185,56,42,0.07)] sm:p-5"><div className="flex gap-3"><span className="mt-0.5 text-lg leading-none" aria-hidden="true">❌</span><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><h3 className="text-sm font-bold text-red-950">{rule.requirement}</h3><span className="w-fit rounded-full border border-red-200 bg-red-100 px-2.5 py-1 font-mono text-[11px] font-bold text-red-800">{rule.rule_id}</span></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase tracking-[0.1em] text-red-800/70">Evidence</dt><dd className="mt-1 font-semibold text-red-950">{displayEvidence(rule.value)}</dd></div><div><dt className="text-xs font-bold uppercase tracking-[0.1em] text-red-800/70">Legal reference</dt><dd className="mt-1 text-red-950">{rule.legal_reference}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-bold uppercase tracking-[0.1em] text-red-800/70">Explanation</dt><dd className="mt-1 leading-5 text-red-950/80">{rule.explanation}</dd></div></dl></div></div></article>)}</div>{reviewRuleCount > 0 && <div className="space-y-3"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500" /><h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#765d2d]">Requires Review</h3></div>{result.compliance.rules.filter((rule) => rule.status === "REVIEW").map((rule) => <article key={`review-${rule.rule_id}`} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5"><div className="flex gap-3"><span className="mt-0.5 text-lg leading-none" aria-hidden="true">⚠</span><div className="min-w-0 flex-1"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><h3 className="text-sm font-bold text-[#493b1e]">{rule.requirement}</h3><span className="w-fit rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 font-mono text-[11px] font-bold text-amber-800">{rule.rule_id} · REVIEW</span></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase tracking-[0.1em] text-amber-800/70">Evidence</dt><dd className="mt-1 font-semibold text-[#493b1e]">{displayEvidence(rule.value)}</dd></div><div><dt className="text-xs font-bold uppercase tracking-[0.1em] text-amber-800/70">Explanation</dt><dd className="mt-1 leading-5 text-[#493b1e]/80">The system could not conclusively determine applicability or presence. {rule.explanation}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-bold uppercase tracking-[0.1em] text-amber-800/70">Legal reference</dt><dd className="mt-1 text-[#493b1e]">{rule.legal_reference}</dd></div></dl></div></div></article>)}</div>}</section>
              <section><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7d8881]">03 / Deterministic review</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Compliance rules</h2></div><span className="text-xs text-[#7d8881]">Rule engine output</span></div><div className="space-y-3">{result.compliance.rules.map((rule) => { const style = statusClasses(rule.status); return <article key={rule.rule_id} className="rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className="mt-0.5 font-mono text-xs font-bold text-[#a0aaa4]">{rule.rule_id}</span><div><h3 className="text-sm font-bold text-[#263833]">{rule.requirement}</h3><p className="mt-1 text-sm leading-5 text-[#69756f]">{rule.explanation}</p></div></div><span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${style.badge}`}>{rule.status}</span></div><div className="mt-4 flex flex-col gap-1 border-t border-[#e7e6df] pt-3 text-xs text-[#8a958e] sm:flex-row sm:justify-between sm:gap-4"><span>Value: <strong className="font-semibold text-[#59665f]">{rule.value || "Not detected"}</strong></span><span>{rule.legal_reference}</span></div></article>; })}</div></section>
              <section className="rounded-2xl border border-[#d8d8ce] bg-[#fbfaf7] p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7d8881]">OCR evidence</p><h2 className="mt-2 text-lg font-semibold">Detected label text</h2></div><span className="text-xs text-[#7d8881]">{result.ocr.text.length} lines</span></div><div className="mt-4 flex flex-wrap gap-2">{result.ocr.text.filter((line) => line.text.trim()).map((line, index) => <span key={`${line.text}-${index}`} className="rounded-lg border border-[#e1e1d9] bg-[#f6f3ed] px-3 py-2 text-xs text-[#59665f]">{line.text.trim()} <strong className="ml-1 text-[#9a6b52]">{Math.round(line.confidence * 100)}%</strong></span>)}</div></section>
            </div> : <div className="flex min-h-[620px] flex-col justify-between rounded-2xl border border-[#d8d8ce] bg-[#e9eee9] p-7 sm:p-10"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#718078]">Inspection workspace</p><h2 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-[-0.04em] text-[#263833] sm:text-5xl">Every declaration,<br /><span className="text-[#668074]">accounted for.</span></h2></div><div className="grid gap-3 border-t border-[#cbd7cf] pt-6 text-sm text-[#63736b] sm:grid-cols-3"><div><strong className="block text-2xl font-semibold text-[#31463e]">01</strong>Upload label</div><div><strong className="block text-2xl font-semibold text-[#31463e]">02</strong>Extract fields</div><div><strong className="block text-2xl font-semibold text-[#31463e]">03</strong>Review rules</div></div></div>}
          </div>
        </section>
        <footer className="border-t border-[#d8d8ce] pt-5 text-xs leading-5 text-[#87918b]">Prototype review surface · Legal Metrology (Packaged Commodities) Rules, 2011 · Results require human verification.</footer>
      </div>
    </main>
  );
}
