import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { downloadBlob } from './imageProcessing'

const HEADER_HEIGHT = 64
const FOOTER_HEIGHT = 42

function safeBaseName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '')
  return (base || 'photo').replace(/[^a-zA-Z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()
}

function drawSlot(page: any, png: any, x: number, y: number, size: number) {
  page.drawImage(png, { x, y, width: size, height: size })
  page.drawRectangle({ x, y, width: size, height: size, borderWidth: 0.75, borderColor: rgb(0, 0, 0) })
}

export async function downloadPrintSheet(photo: Blob, originalFileName: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([8.5 * 72, 11 * 72])
  const { width, height } = page.getSize()
  const png = await pdf.embedPng(await photo.arrayBuffer())
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const brand = rgb(0.10, 0.47, 0.49)
  const brandSoft = rgb(0.90, 0.96, 0.96)
  const textDark = rgb(0.14, 0.19, 0.20)
  const line = rgb(0.70, 0.79, 0.80)

  page.drawRectangle({ x: 0, y: height - HEADER_HEIGHT, width, height: HEADER_HEIGHT, color: brand })
  page.drawRectangle({ x: 0, y: 0, width, height: FOOTER_HEIGHT, color: brandSoft })
  page.drawText('IDFrame Studio', { x: 36, y: height - 38, size: 24, font: fontBold, color: rgb(1, 1, 1) })
  page.drawText('Professional Photo Package', { x: 36, y: height - 54, size: 10, font: fontRegular, color: rgb(0.87, 0.97, 0.97) })
  page.drawText('4 copies of 2x2 inches + 6 copies of 1x1 inch on one page', { x: width - 250, y: height - 37, size: 10, font: fontRegular, color: rgb(0.90, 0.98, 0.98) })
  page.drawText('IDFrame Studio - Print at actual size / 100% - Borders included for safe cutting', { x: 36, y: 17, size: 9, font: fontRegular, color: textDark })

  const contentTop = height - HEADER_HEIGHT - 22
  const contentBottom = FOOTER_HEIGHT + 22

  // Upper section: 4 copies of 2x2 inches.
  const largeSize = 2 * 72
  const largeCols = 2
  const largeRows = 2
  const largeGridWidth = largeCols * largeSize
  const largeGridHeight = largeRows * largeSize
  const largeX = (width - largeGridWidth) / 2
  const largeTitleY = contentTop - 8
  page.drawText('4 copies - 2 x 2 inches', { x: width / 2 - 58, y: largeTitleY, size: 12, font: fontBold, color: brand })
  const largeTopY = largeTitleY - 18
  const largeBottomY = largeTopY - largeGridHeight
  for (let row = 0; row < largeRows; row++) {
    for (let col = 0; col < largeCols; col++) {
      const x = largeX + col * largeSize
      const y = largeBottomY + (largeRows - 1 - row) * largeSize
      drawSlot(page, png, x, y, largeSize)
    }
  }

  // Lower section: 6 copies of 1x1 inches.
  const smallSize = 72
  const smallCols = 3
  const smallRows = 2
  const smallGridWidth = smallCols * smallSize
  const smallGridHeight = smallRows * smallSize
  const smallX = (width - smallGridWidth) / 2
  const smallTitleY = contentBottom + 190
  page.drawText('6 copies - 1 x 1 inch', { x: width / 2 - 49, y: smallTitleY, size: 12, font: fontBold, color: brand })
  const smallTopY = smallTitleY - 18
  const smallBottomY = smallTopY - smallGridHeight
  for (let row = 0; row < smallRows; row++) {
    for (let col = 0; col < smallCols; col++) {
      const x = smallX + col * smallSize
      const y = smallBottomY + (smallRows - 1 - row) * smallSize
      drawSlot(page, png, x, y, smallSize)
    }
  }

  page.drawLine({ start: { x: 36, y: smallTitleY + 34 }, end: { x: width - 36, y: smallTitleY + 34 }, thickness: 1, color: line })

  pdf.setTitle('IDFrame Studio package image sheet')
  pdf.setSubject('Single-page package with 4 copies of 2x2 inches and 6 copies of 1x1 inch.')
  const bytes = await pdf.save()
  const fileName = `idframe-studio-package-images-${safeBaseName(originalFileName)}.pdf`
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName)
}
