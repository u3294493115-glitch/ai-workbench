#!/usr/bin/env node
/**
 * bid-check-cn v2.1.1 最小 PDF 嵌入图像提取脚本
 *
 * 用途：从扫描件 PDF 中提取嵌入的图像资源（资质证书、营业执照、建造师证、
 *       B 证、社保、信用截图、业绩合同、竣工验收、管理体系认证等关键证据），
 *       导出为 PNG 文件，供 Claude 多模态视觉工具识别。
 *
 * 调用方式：
 *   node scripts/extract_pdf_images.mjs <pdf路径> <输出目录>
 *
 * 依赖（首次运行需安装）：
 *   npm install pdfjs-dist canvas --prefix /tmp/pdfjs_workdir
 *
 * 典型使用流程：
 *   1. 在 /tmp 目录安装依赖
 *   2. 运行本脚本提取图像到目标目录
 *   3. 将 PNG 复制到 <OS_TEMP_DIR>\（Claude 多模态工具默认可访问路径）
 *   4. 通过 mcp__<VISION_TOOL>__understand_image 等多模态工具识别图片内容
 *
 * 设计原则：
 *   - 最小化：仅解决"PDF 关键图片页稳定提取/视觉读取"问题，不增加架构代码
 *   - 容错：单页渲染失败不中断整体流程
 *   - 元信息：每张 PNG 生成同名 .meta.json 记录页码、尺寸、字节数
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const outDir = process.argv[3];

if (!pdfPath || !outDir) {
  console.error('用法: node scripts/extract_pdf_images.mjs <pdf路径> <输出目录>');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const loadingTask = pdfjsLib.getDocument({
  data,
  disableFontFace: true,
  useSystemFonts: false,
  isEvalSupported: false,
  verbosity: 0,
});
const pdf = await loadingTask.promise;
console.log(`[extract_pdf_images] Total pages: ${pdf.numPages}`);

let totalExtracted = 0;
let failedPages = [];

for (let i = 1; i <= pdf.numPages; i++) {
  try {
    const page = await pdf.getPage(i);
    const ops = await page.getOperatorList();
    const seen = new Set();
    let imgCounter = 0;

    for (let j = 0; j < ops.fnArray.length; j++) {
      const fn = ops.fnArray[j];
      // OPS.paintImageXObject = 85, OPS.paintJpegXObject = 86
      if (fn === 85 || fn === 86) {
        const imgIdx = ops.argsArray[j][0];
        if (seen.has(imgIdx)) continue;
        seen.add(imgIdx);
        imgCounter++;

        try {
          await new Promise((r) => setTimeout(r, 10));
          const img = await page.objs.get(imgIdx);
          if (!img || !img.data || !img.width || !img.height) continue;

          const canvas = createCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          const imageData = ctx.createImageData(img.width, img.height);
          const channels = img.data.length / (img.width * img.height);

          if (channels === 3) {
            for (let k = 0; k < img.width * img.height; k++) {
              imageData.data[k * 4] = img.data[k * 3];
              imageData.data[k * 4 + 1] = img.data[k * 3 + 1];
              imageData.data[k * 4 + 2] = img.data[k * 3 + 2];
              imageData.data[k * 4 + 3] = 255;
            }
          } else if (channels === 1) {
            for (let k = 0; k < img.width * img.height; k++) {
              imageData.data[k * 4] = img.data[k];
              imageData.data[k * 4 + 1] = img.data[k];
              imageData.data[k * 4 + 2] = img.data[k];
              imageData.data[k * 4 + 3] = 255;
            }
          } else {
            imageData.data.set(img.data);
          }

          ctx.putImageData(imageData, 0, 0);
          const buffer = canvas.toBuffer('image/png');
          const baseName = path.join(outDir, `pdf_p${i}_img${imgCounter}`);
          fs.writeFileSync(`${baseName}.png`, buffer);
          fs.writeFileSync(
            `${baseName}.meta.json`,
            JSON.stringify(
              {
                pdf: path.basename(pdfPath),
                page: i,
                imageIndex: imgCounter,
                width: img.width,
                height: img.height,
                channels,
                bytes: buffer.length,
              },
              null,
              2,
            ),
          );
          totalExtracted++;
          console.log(
            `[extract_pdf_images] Page ${i} img ${imgCounter}: ${img.width}x${img.height}, ${buffer.length} bytes`,
          );
        } catch (e) {
          console.log(`[extract_pdf_images] Page ${i} img ${imgCounter} skip: ${e.message}`);
        }
      }
    }
  } catch (e) {
    failedPages.push(i);
    console.log(`[extract_pdf_images] Page ${i} error: ${e.message}`);
  }
}

console.log(`[extract_pdf_images] Done. Extracted ${totalExtracted} images.`);
if (failedPages.length > 0) {
  console.log(`[extract_pdf_images] Failed pages: ${failedPages.join(', ')}`);
}
