import { PDFDocument } from 'pdf-lib'
import { downloadBlob } from './imageProcessing'

export type PrintSheet = 'four-2x2' | 'eight-1x1'

/** 4 x 6 inch photographic paper, exact dimensions in PDF points (72 points/inch). */
export async function downloadPrintSheet(photo: Blob, kind: PrintSheet) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([4 * 72, 6 * 72])
  const png = await pdf.embedPng(await photo.arrayBuffer())
  const inches = kind === 'four-2x2' ? 2 : 1
  const cols = kind === 'four-2x2' ? 2 : 4
  const rows = 2
  const edge = inches * 72
  const left = (4 * 72 - cols * edge) / 2
  const bottom = (6 * 72 - rows * edge) / 2
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = left + col * edge
      const y = bottom + (rows - 1 - row) * edge
      page.drawImage(png, {x, y, width: edge, height: edge})
    }
  }
  pdf.setTitle(kind === 'four-2x2' ? 'IDFrame - 4 photos, 2 x 2 inches' : 'IDFrame - 8 photos, 1 x 1 inches')
  pdf.setSubject('4 x 6 inch print sheet. Print at actual size / 100%, no fit-to-page scaling.')
  const bytes = await pdf.save()
  downloadBlob(new Blob([new Uint8Array(bytes)], {type:'application/pdf'}), `idframe-${kind}-4x6-print-sheet.pdf`)
}
