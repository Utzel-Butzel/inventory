import PDFDocument from "pdfkit";
import type { LoanHandoverDocument } from "@/lib/loan-handover-contract";
import { handoverLabels } from "@/lib/loan-handover-labels";

export async function renderLoanHandoverPdf(documents: LoanHandoverDocument[], locale = "de") {
  const labels = handoverLabels(locale);
  const pdf = new PDFDocument({ size: "A4", margin: 48, autoFirstPage: false, info: { Title: labels.reports, Author: "Open Inventory" } });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  const date = (value: string) => new Intl.DateTimeFormat(locale.startsWith("de") ? "de-DE" : "en-GB", {
    dateStyle: "medium", timeStyle: "long", timeZone: "UTC",
  }).format(new Date(value));
  function heading(value: string) {
    if (pdf.y > 700) pdf.addPage();
    pdf.moveDown(0.7).font("Helvetica-Bold").fontSize(12).fillColor("#252940").text(value);
    pdf.moveDown(0.35).font("Helvetica").fontSize(10).fillColor("#30384a");
  }
  for (const document of documents) {
    pdf.addPage();
    pdf.font("Helvetica-Bold").fontSize(10).fillColor("#665cff").text("OPEN INVENTORY");
    pdf.moveDown().fontSize(23).fillColor("#252940").text(labels[document.phase]);
    pdf.moveDown(0.6).font("Helvetica").fontSize(10).fillColor("#30384a");
    for (const [label, value] of [
      [labels.item, document.resourceName], [labels.unit, document.unitCode ?? "-"],
      [labels.quantity, String(document.quantity)], [labels.borrower, document.borrower],
      [labels.due, document.dueAt ? date(document.dueAt) : "-"],
      [labels.occurred, date(document.occurredAt)], [labels.reportId, (document.orderId ?? document.assignmentId ?? "-")],
    ]) pdf.text(`${label}: ${value}`, { paragraphGap: 5 });
    heading(labels.condition);
    pdf.text(labels[document.condition]);
    pdf.moveDown(0.5).text(document.notes || labels.noNotes);
    heading(labels.accessories);
    if (!document.accessories.length) pdf.text(labels.noAccessories);
    for (const accessory of document.accessories) {
      pdf.text(`${accessory.present ? labels.present : labels.missing}: ${accessory.name}`, { paragraphGap: 5 });
    }
    heading(labels.confirmationTitle);
    pdf.text(`${labels.givenBy}: ${document.givenBy}`, { paragraphGap: 5 });
    pdf.text(`${labels.receivedBy}: ${document.receivedBy}`, { paragraphGap: 8 });
    pdf.text(labels.confirmation, { paragraphGap: 8 });
    pdf.fontSize(9).fillColor("#586174").text(labels.confirmationHelp, { paragraphGap: 8 });
    pdf.text(`${labels.recorded}: ${date(document.recordedAt)}`);
    pdf.text(`${labels.actor}: ${document.recordedBy}`);
    for (const [index, photo] of document.photos.entries()) {
      pdf.addPage();
      pdf.font("Helvetica-Bold").fontSize(16).fillColor("#252940").text(`${labels[document.phase]} - ${labels.photos} ${index + 1}`);
      pdf.moveDown().font("Helvetica").fontSize(10).text(document.resourceName);
      const bytes = Buffer.from(photo.slice(photo.indexOf(",") + 1), "base64");
      pdf.image(bytes, 48, 130, { fit: [499, 620], align: "center", valign: "center" });
      pdf.fontSize(8).fillColor("#586174").text((document.orderId ?? document.assignmentId ?? "-"), 48, 770);
    }
  }
  pdf.end();
  return output;
}
