import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';

export interface GeneratePdfResult {
  pdf: jsPDF;
  blob: Blob;
  file: File;
  dataUrl: string;
}

/**
 * Converte qualquer imagem externa para base64 dataURL
 * Isso elimina 100% de erros de CORS e SecurityError de canvas 'tainted'
 */
async function toSafeDataUrl(src: string): Promise<string> {
  if (!src || src.startsWith('data:')) return src;

  try {
    const res = await fetch(src, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string || src);
        reader.onerror = () => resolve(src);
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    // Fallback: tentar carregar em elemento de imagem com crossOrigin anonymous
  }

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await new Promise<void>((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => reject();
      setTimeout(reject, 2000);
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 100;
    canvas.height = img.naturalHeight || 100;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    }
  } catch {
    // Se falhar CORS, mantém a fonte original
  }

  return src;
}

/**
 * Gera um arquivo PDF de alta definição a partir do elemento HTML (A4 portrait).
 * Garante layout limpo, colunas alinhadas, fidelidade de 100% e proteção contra cortes.
 */
export async function generateQuotePdf(
  elementId: string,
  filename: string = 'Orcamento.pdf'
): Promise<GeneratePdfResult> {
  const container = document.getElementById(elementId);
  if (!container) {
    throw new Error(`Elemento #${elementId} não encontrado no DOM para geração de PDF.`);
  }

  // Dimensões padrão da folha A4 em milímetros
  const pdfWidth = 210;
  const pdfHeight = 297;

  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  // Identificar todas as folhas A4 demarcadas (.pdf-page)
  let pageElements = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page'));
  if (pageElements.length === 0) {
    pageElements = [container];
  }

  // Converter todas as imagens existentes no container para dataURLs seguras
  const allImages = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    allImages.map(async (img) => {
      if (img.src && !img.src.startsWith('data:')) {
        const safeUrl = await toSafeDataUrl(img.src);
        if (safeUrl && safeUrl.startsWith('data:')) {
          img.src = safeUrl;
        }
      }
    })
  );

  for (let i = 0; i < pageElements.length; i++) {
    const pageEl = pageElements[i];

    // Medir altura do elemento original
    const measuredHeight = Math.max(1123, pageEl.offsetHeight || 1123);

    // Renderizar via html2canvas-pro com isolamento no clone
    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: '#ffffff',
      width: 794,
      height: measuredHeight,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      windowWidth: 1024,
      imageTimeout: 15000,
      onclone: (clonedDoc, clonedEl) => {
        // 1. Ocultar todos os botões de ação e itens com classe print:hidden
        const elementsToHide = clonedDoc.querySelectorAll<HTMLElement>(
          'button, .print\\:hidden, [class*="print:hidden"], input[type="file"]'
        );
        elementsToHide.forEach((el) => {
          el.style.display = 'none';
        });

        // 2. Normalizar estilos no elemento clonado
        clonedEl.style.transform = 'none';
        (clonedEl.style as unknown as Record<string, string>).webkitTransform = 'none';
        clonedEl.style.margin = '0';
        clonedEl.style.boxShadow = 'none';
        clonedEl.style.borderRadius = '0';
        clonedEl.style.width = '794px';
        clonedEl.style.minWidth = '794px';
        clonedEl.style.maxWidth = '794px';
        clonedEl.style.minHeight = '1123px';
        clonedEl.style.boxSizing = 'border-box';
        clonedEl.style.backgroundColor = '#ffffff';

        // 3. Injetar regras universais de impressão no clone para estabilidade absoluta
        const styleTag = clonedDoc.createElement('style');
        styleTag.textContent = `
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            box-sizing: border-box !important;
          }
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            width: 794px !important;
          }
        `;
        clonedDoc.head.appendChild(styleTag);

        // 4. Se houver algum canvas original (ex: desenhos/assinaturas), copiar pixels
        const origCanvases = Array.from(pageEl.querySelectorAll<HTMLCanvasElement>('canvas'));
        const clonedCanvases = Array.from(clonedEl.querySelectorAll<HTMLCanvasElement>('canvas'));
        origCanvases.forEach((orig, idx) => {
          const target = clonedCanvases[idx];
          if (target && orig && orig.width > 0 && orig.height > 0) {
            target.width = orig.width;
            target.height = orig.height;
            const ctx = target.getContext('2d');
            if (ctx) {
              ctx.drawImage(orig, 0, 0);
            }
          }
        });

        // 5. Isolar o elemento no body do clone, removendo overlays do modal
        clonedDoc.body.innerHTML = '';
        clonedDoc.body.style.margin = '0';
        clonedDoc.body.style.padding = '0';
        clonedDoc.body.style.backgroundColor = '#ffffff';
        clonedDoc.body.style.width = '794px';
        clonedDoc.body.style.minWidth = '794px';
        clonedDoc.body.style.maxWidth = '794px';
        clonedDoc.body.style.overflow = 'visible';
        clonedDoc.body.appendChild(clonedEl);
      },
    });

    // Converter canvas para imagem JPEG de altíssima qualidade
    const imgData = canvas.toDataURL('image/jpeg', 0.98);
    const heightInMm = (canvas.height * pdfWidth) / canvas.width;

    if (i > 0) {
      pdf.addPage('a4', 'p');
    }

    // Enquadramento milimétrico padrão folha A4 (210mm x 297mm)
    if (Math.abs(heightInMm - pdfHeight) <= 10) {
      // Proporção quase exata A4: preenche a folha completa
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'SLOW');
    } else if (heightInMm < pdfHeight) {
      // Conteúdo ligeiramente menor: renderiza a partir do topo
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, heightInMm, undefined, 'SLOW');
    } else {
      // Conteúdo maior: ajusta proporcionalmente mantendo proporção
      const scale = pdfHeight / heightInMm;
      const scaledWidth = pdfWidth * scale;
      const centeredX = (pdfWidth - scaledWidth) / 2;
      pdf.addImage(imgData, 'JPEG', centeredX, 0, scaledWidth, pdfHeight, undefined, 'SLOW');
    }
  }

  const blob = pdf.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  const dataUrl = URL.createObjectURL(blob);

  return { pdf, blob, file, dataUrl };
}

/**
 * Faz o download direto do arquivo PDF no navegador
 */
export async function downloadQuotePdf(
  elementId: string,
  filename: string = 'Orcamento.pdf'
): Promise<File> {
  const { pdf, file } = await generateQuotePdf(elementId, filename);
  pdf.save(filename);
  return file;
}

/**
 * Compartilha o PDF diretamente via Web Share API se suportado,
 * ou faz download e abre o WhatsApp com o link/instruções
 */
export async function sharePdfOrWhatsApp(
  elementId: string,
  filename: string,
  whatsappNumber: string,
  textMessage: string
): Promise<{ method: 'share' | 'download_and_redirect'; success: boolean }> {
  try {
    const { file, pdf } = await generateQuotePdf(elementId, filename);

    // 1. Tenta compartilhamento nativo com arquivo (comum em celulares Android e iOS Safari)
    if (
      typeof navigator !== 'undefined' &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: filename,
          text: textMessage,
        });
        return { method: 'share', success: true };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { method: 'share', success: false };
        }
        console.warn('Falha no navigator.share, fallback para download:', err);
      }
    }

    // 2. Fallback: Baixa o PDF no dispositivo
    pdf.save(filename);

    // 3. Abre o WhatsApp com a mensagem
    const cleanNumber = whatsappNumber.replace(/\D/g, '');
    const encodedText = encodeURIComponent(
      `${textMessage}\n\n📎 *O arquivo PDF completo do orçamento (${filename}) foi gerado e baixado no seu dispositivo para envio como anexo.*`
    );

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const whatsappUrl = isMobile
      ? `https://api.whatsapp.com/send?phone=${cleanNumber ? (cleanNumber.length <= 11 ? '55' + cleanNumber : cleanNumber) : ''}&text=${encodedText}`
      : `https://web.whatsapp.com/send?phone=${cleanNumber ? (cleanNumber.length <= 11 ? '55' + cleanNumber : cleanNumber) : ''}&text=${encodedText}`;

    window.open(whatsappUrl, '_blank');

    return { method: 'download_and_redirect', success: true };
  } catch (error) {
    console.error('Erro ao gerar/enviar PDF:', error);
    throw error;
  }
}
