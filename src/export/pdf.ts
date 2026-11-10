import html2canvas from 'html2canvas-pro'
import jsPDF from 'jspdf'

/**
 * Renders a DOM node to a PDF by rasterizing it (html2canvas) and slicing the
 * result across A4 pages. Rasterizing — instead of drawing text directly with
 * jsPDF — sidesteps Arabic shaping/RTL bugs in PDF text layers entirely: the
 * browser's own renderer draws the Arabic text correctly, we just capture it
 * as pixels. The tradeoff is the PDF text isn't selectable, which is fine for
 * a printed financial statement.
 */
export async function exportNodeToPdf(node: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    // On-screen action buttons (e.g. "إلغاء الحركة") have no place in a
    // printed/shared PDF — they'd look clickable in a static document.
    ignoreElements: (el) => el.classList.contains('no-print'),
  })

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  const imgWidthMm = pageWidth
  const pxPerMm = canvas.width / imgWidthMm
  const pageHeightPx = pageHeight * pxPerMm

  let renderedPx = 0
  let pageIndex = 0

  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx)

    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    pageCanvas.height = sliceHeightPx
    const ctx = pageCanvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx)

    const imgData = pageCanvas.toDataURL('image/png')
    if (pageIndex > 0) pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidthMm, (sliceHeightPx * imgWidthMm) / canvas.width)

    renderedPx += sliceHeightPx
    pageIndex += 1
  }

  pdf.save(filename)
}
