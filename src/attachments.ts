export interface PreparedAttachment {
  file: File;
  extractedText: string;
  detail: string;
  previewUrl: string;
}

const MAX_IMAGE_DIMENSION = 2400;
const MAX_EXTRACTED_TEXT = 80_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    image.src = url;
  });
}

async function compressImage(file: File): Promise<File> {
  if (file.size < 1_500_000 || file.type === "image/gif") return file;
  const image = await loadImage(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (!blob || blob.size >= file.size) return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.webp`, {
    type: "image/webp",
    lastModified: file.lastModified,
  });
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerPort)
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url),
      { type: "module" },
    );
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pages: string[] = [];
  const limit = Math.min(document.numPages, 100);
  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" "),
    );
    if (pages.join("\n").length >= MAX_EXTRACTED_TEXT) break;
  }
  return pages.join("\n").slice(0, MAX_EXTRACTED_TEXT);
}

async function extractImageText(file: File): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, "eng", { logger: () => undefined });
  return result.data.text.trim().slice(0, MAX_EXTRACTED_TEXT);
}

export async function prepareAttachment(
  original: File,
): Promise<PreparedAttachment> {
  let file = original;
  let extractedText = "";
  const details: string[] = [];
  if (original.type.startsWith("image/")) {
    file = await compressImage(original);
    if (file.size < original.size)
      details.push(
        `compressed ${Math.round(original.size / 1024)} KB to ${Math.round(file.size / 1024)} KB`,
      );
    try {
      extractedText = await extractImageText(file);
      if (extractedText) details.push("image text indexed");
    } catch {
      details.push("image saved without OCR");
    }
  } else if (original.type === "application/pdf") {
    try {
      extractedText = await extractPdfText(original);
      if (extractedText) details.push("PDF text indexed");
      else details.push("PDF saved without readable text");
    } catch {
      details.push("PDF saved without text extraction");
    }
  }
  return {
    file,
    extractedText,
    detail: details.join(" · ") || "ready",
    previewUrl: URL.createObjectURL(file),
  };
}

export function attachmentPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}
