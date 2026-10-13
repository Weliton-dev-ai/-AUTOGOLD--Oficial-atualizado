import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';

export interface GeneratePdfResult {
  pdf: jsPDF;
  blob: Blob;
  file: File;
  dataUrl: string;
}

/**
 * Gera um arquivo PDF de alta definição a partir do elemento HTML (A4 portrait).
 * Utiliza palco isolado de renderização off-screen para garantir fidelidade
 * matemática absoluta de 100% com o layout gerado na tela do app, imune a
 * escalas móveis, barras de rolagem ou artefatos de corte.
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

  // Preaquecimento: assegurar que imagens no container original estejam carregadas
  const sourceImages = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    sourceImages.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 1500);
      });
    })
  );

  // Identificar todas as folhas A4 demarcadas (.pdf-page)
  let pageElements = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page'));
  if (pageElements.length === 0) {
    pageElements = [container];
  }

  // Criar palco de renderização neutro e isolado anexado ao body
  // Isso herda todos os estilos globais, Tailwind e fontes, sem distorção de scroll ou escala
  const renderStage = document.createElement('div');
  renderStage.id = '__pdf_render_stage__';
  renderStage.style.position = 'fixed';
  renderStage.style.left = '0';
  renderStage.style.top = '0';
  renderStage.style.width = '794px';
  renderStage.style.minWidth = '794px';
  renderStage.style.maxWidth = '794px';
  renderStage.style.zIndex = '-99999';
  renderStage.style.opacity = '1';
  renderStage.style.visibility = 'visible';
  renderStage.style.pointerEvents = 'none';
  renderStage.style.backgroundColor = '#ffffff';
  renderStage.style.margin = '0';
  renderStage.style.padding = '0';
  renderStage.style.overflow = 'visible';
  document.body.appendChild(renderStage);

  try {
    for (let i = 0; i < pageElements.length; i++) {
      const pageEl = pageElements[i];

      // Clonar profundamente a folha A4 original
      const pageClone = pageEl.cloneNode(true) as HTMLElement;

      // Normalizar propriedades visuais da folha para impressão física sem artefatos de tela
      pageClone.style.transform = 'none';
      pageClone.style.webkitTransform = 'none';
      pageClone.style.margin = '0';
      pageClone.style.boxShadow = 'none';
      pageClone.style.borderRadius = '0';
      pageClone.style.width = '794px';
      pageClone.style.minWidth = '794px';
      pageClone.style.maxWidth = '794px';
      pageClone.style.minHeight = '1123px';
      pageClone.style.boxSizing = 'border-box';
      pageClone.style.backgroundColor = '#ffffff';

      // Ocultar botões de ação e elementos com classes print:hidden no clone
      const elementsToHide = pageClone.querySelectorAll<HTMLElement>(
        'button, .print\\:hidden, [class*="print:hidden"], input[type="file"]'
      );
      elementsToHide.forEach((el) => {
        el.style.display = 'none';
      });

      // Se houver algum canvas original (ex: marcas/assinaturas), copiar os pixels para o clone
      const originalCanvases = Array.from(pageEl.querySelectorAll<HTMLCanvasElement>('canvas'));
      const clonedCanvases = Array.from(pageClone.querySelectorAll<HTMLCanvasElement>('canvas'));
      originalCanvases.forEach((orig, idx) => {
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

      // Inserir clone no palco isolado
      renderStage.innerHTML = '';
      renderStage.appendChild(pageClone);

      // Aguardar o ciclo de reflow do navegador
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Assegurar carregamento de todas as imagens do clone
      const clonedImgs = Array.from(pageClone.querySelectorAll<HTMLImageElement>('img'));
      await Promise.all(
        clonedImgs.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
          return new Promise((resolve) => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            setTimeout(() => resolve(false), 800);
          });
        })
      );

      // Altura calculada da folha (pelo menos 1123px = proporção exata A4)
      const measuredHeight = Math.max(1123, pageClone.offsetHeight || 1123);

      // Captura via html2canvas com densidade de 2x (nitidez retina)
      const canvas = await html2canvas(pageClone, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#FFFFFF',
        width: 794,
        height: measuredHeight,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        windowWidth: 1024,
        imageTimeout: 15000,
      });

      // Exportar imagem da folha em JPEG 98%
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const heightInMm = (canvas.height * pdfWidth) / canvas.width;

      if (i > 0) {
        pdf.addPage('a4', 'p');
      }

      // Se a altura corresponder aproximadamente a folha A4 (297mm ± 8mm):
      if (Math.abs(heightInMm - pdfHeight) <= 8) {
        // Enquadramento perfeito na folha inteira
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'SLOW');
      } else if (heightInMm < pdfHeight) {
        // Menor que a folha: renderiza a partir do topo sem esticar verticalmente
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, heightInMm, undefined, 'SLOW');
      } else {
        // Se exceder a folha A4 (muitos itens), escala proporcionalmente mantendo a razão de aspecto
        const scale = pdfHeight / heightInMm;
        const scaledWidth = pdfWidth * scale;
        const centeredX = (pdfWidth - scaledWidth) / 2;
        pdf.addImage(imgData, 'JPEG', centeredX, 0, scaledWidth, pdfHeight, undefined, 'SLOW');
      }
    }
  } finally {
    // Remover o palco isolado do DOM
    if (renderStage.parentElement) {
      renderStage.parentElement.removeChild(renderStage);
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
        // Se o usuário cancelou o compartilhamento nativo, não faz nada
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
