import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

prepareZXingModule({
  overrides: {
    locateFile: (path) => new URL(path, self.location.href).href,
  },
});

const options = { formats: ['QRCode'], tryHarder: true, tryInvert: true, textMode: 'Plain', maxNumberOfSymbols: 16 };

self.addEventListener('message', async ({ data: { id, image } }) => {
  let bitmap;
  try {
    if (image instanceof ImageData) {
      const codes = await readBarcodes(image, options);
      self.postMessage({ id, texts: [...new Set(codes.map((code) => code.text))] });
      return;
    }
    bitmap = await createImageBitmap(image);
    const factor = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * factor)),
      Math.max(1, Math.round(bitmap.height * factor)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let codes = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
    // A full-resolution retry helps when the code occupies a small part of the image.
    if (!codes.some((code) => code.text.includes('"signature"')) && factor < 1
        && bitmap.width * bitmap.height <= 18_000_000) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      codes = [...codes, ...await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), options)];
    }
    self.postMessage({ id, texts: [...new Set(codes.map((code) => code.text))] });
  } catch {
    self.postMessage({ id, error: '图片解码失败。请使用浏览器可打开的 PNG、JPEG 或 WebP 截图。' });
  } finally {
    bitmap?.close();
  }
});
