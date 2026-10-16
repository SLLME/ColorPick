/**
 * utils/color.js — 纯色彩计算工具，无小程序 API 依赖
 */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

/** 0-255 → 两位十六进制 */
function hex2(n) {
  const s = clamp(Math.round(n), 0, 255).toString(16)
  return s.length === 1 ? '0' + s : s
}

/** {r,g,b} → '#RRGGBB'（大写） */
function rgbToHex(r, g, b) {
  return ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase()
}

/** '#RRGGBB' / '#RGB' → {r,g,b} */
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    return { r: 0, g: 0, b: 0 }
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

/** {r,g,b}(0-255) → {h:0-360, s:0-100, l:0-100} */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  }
}

/** {r,g,b}(0-255) → {h:0-360, s:0-100, v:0-100} */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0

  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : d / max
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    v: Math.round(max * 100)
  }
}

/** {r,g,b}(0-255) → {c,m,y,k}(0-100) */
function rgbToCmyk(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const k = 1 - Math.max(rr, gg, bb)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  const c = (1 - rr - k) / (1 - k)
  const m = (1 - gg - k) / (1 - k)
  const y = (1 - bb - k) / (1 - k)
  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100)
  }
}

/** 相对亮度（WCAG 定义），返回 0-1 */
function luminance(r, g, b) {
  const a = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
}

/* 两种候选文字色。浅色背景配近黑字，深色背景配白字。
   深色用 #1A1A1E 而非纯黑，与全局 --c-text 保持一致，观感更柔和。 */
const TEXT_LIGHT = { hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } }
const TEXT_DARK = { hex: '#1A1A1E', rgb: { r: 26, g: 26, b: 30 } }

/**
 * WCAG 2.x 对比度比值，范围 1-21。
 * 公式 (L_亮 + 0.05) / (L_暗 + 0.05)，与两个参数的先后顺序无关。
 * @param {{r:number,g:number,b:number}} c1
 * @param {{r:number,g:number,b:number}} c2
 */
function contrastRatio(c1, c2) {
  const l1 = luminance(c1.r, c1.g, c1.b)
  const l2 = luminance(c2.r, c2.g, c2.b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * WCAG 2.1 对比度分级。
 * 普通文字 AA ≥ 4.5、AAA ≥ 7；大号文字（≥18pt，或 ≥14pt 粗体）AA ≥ 3、AAA ≥ 4.5。
 * @param {number} ratio
 */
function contrastGrade(ratio) {
  if (ratio >= 7) return { key: 'aaa', label: 'AAA', normal: true, large: true }
  if (ratio >= 4.5) return { key: 'aa', label: 'AA', normal: true, large: true }
  if (ratio >= 3) return { key: 'large', label: '大字 AA', normal: false, large: true }
  return { key: 'fail', label: '不达标', normal: false, large: false }
}

/**
 * 某个颜色作为背景时，配白色文字 / 深色文字各自的对比度与达标等级。
 * 用于回答「这个色能不能当底色、上面放什么字才看得清」。
 * @returns {{list:Array, bestText:string, bestName:string, bestRatio:number, bestRatioText:string, bestGrade:object}}
 */
function contrastInfo(r, g, b) {
  const self = { r, g, b }

  const list = [
    { name: '白色文字', text: TEXT_LIGHT.hex, ref: TEXT_LIGHT.rgb },
    { name: '深色文字', text: TEXT_DARK.hex, ref: TEXT_DARK.rgb }
  ].map((c) => {
    const ratio = contrastRatio(self, c.ref)
    return {
      name: c.name,
      text: c.text,
      ratio,
      ratioText: ratio.toFixed(2) + ':1',
      grade: contrastGrade(ratio)
    }
  })

  const best = list[0].ratio >= list[1].ratio ? list[0] : list[1]

  return {
    list,
    bestText: best.text,
    bestName: best.name,
    bestRatio: best.ratio,
    bestRatioText: best.ratioText,
    bestGrade: best.grade
  }
}

/**
 * 根据背景色返回可读的文字色。
 *
 * 注意：不能只用一个亮度阈值来判断。白色文字的对比度是 1.05/(L+0.05)，
 * 深色文字是 (L+0.05)/0.05，两者在 L≈0.179 处相等。若阈值取 0.55，
 * 中间调背景（如 #A9A9A9，L≈0.40）会被判为「深色」而配白字，
 * 实际对比度仅 2.33:1，而深色文字可达 7.5:1。
 * 因此这里直接比较两种候选色的对比度，取较大的一方。
 */
function readableTextColor(r, g, b) {
  const self = { r, g, b }
  return contrastRatio(self, TEXT_LIGHT.rgb) >= contrastRatio(self, TEXT_DARK.rgb)
    ? TEXT_LIGHT.hex
    : TEXT_DARK.hex
}

/** hsl(0-360,0-100,0-100) → {r,g,b}(0-255) */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360
  s = clamp(s, 0, 100) / 100
  l = clamp(l, 0, 100) / 100

  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  }
}

/** 取一个颜色的全部表示形式 */
function describe(r, g, b) {
  const hsl = rgbToHsl(r, g, b)
  const hsv = rgbToHsv(r, g, b)
  const cmyk = rgbToCmyk(r, g, b)
  const hex = rgbToHex(r, g, b)
  return {
    r, g, b,
    hex,
    hexLower: hex.toLowerCase(),
    rgbStr: `rgb(${r}, ${g}, ${b})`,
    hsl,
    hslStr: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    hsv,
    hsvStr: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
    cmyk,
    cmykStr: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
    textColor: readableTextColor(r, g, b),
    contrast: contrastInfo(r, g, b)
  }
}

/**
 * 生成配色方案。以 HSL 色轮旋转 + 明度/饱和度微调生成。
 * 返回 [{name, colors:[hex,...]}, ...]
 */
function harmonies(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b)
  const mk = (hue, sat, lig) =>
    rgbToHex(...Object.values(hslToRgb(hue, sat, lig)))

  const sat = clamp(s, 12, 96)
  const lig = clamp(l, 22, 82)

  const rotate = (deg) =>
    mk(h + deg, sat, lig)

  return [
    {
      name: '互补色',
      desc: '色轮对侧，对比强烈',
      colors: [mk(h, sat, lig), rotate(180)]
    },
    {
      name: '分裂互补',
      desc: '互补色两侧，柔和对比',
      colors: [mk(h, sat, lig), rotate(150), rotate(210)]
    },
    {
      name: '邻近色',
      desc: '色轮相邻，和谐统一',
      colors: [rotate(-30), mk(h, sat, lig), rotate(30)]
    },
    {
      name: '三角配色',
      desc: '色轮三等分，均衡活泼',
      colors: [mk(h, sat, lig), rotate(120), rotate(240)]
    },
    {
      name: '四方配色',
      desc: '两组互补，层次丰富',
      colors: [mk(h, sat, lig), rotate(90), rotate(180), rotate(270)]
    },
    {
      name: '同色明暗',
      desc: '同色相不同明度，专业耐看',
      colors: [
        mk(h, sat, clamp(lig - 26, 10, 90)),
        mk(h, sat, clamp(lig - 12, 14, 92)),
        mk(h, sat, lig),
        mk(h, sat, clamp(lig + 14, 20, 95)),
        mk(h, sat, clamp(lig + 27, 24, 97))
      ]
    }
  ]
}

/**
 * 求图片主色（颜色量化 + 聚类合并）。
 * @param {Uint8ClampedArray} pixels RGBA 像素数据
 * @param {number} [count=5] 期望返回的颜色数
 * @param {number} [width] 图片宽度(px)，传入后按行列均匀采样，避免一维步进漏采
 * @returns {Array} 颜色描述数组，含 weight（估算的像素占比基数）
 */
function dominantColors(pixels, count, width) {
  const n = count || 5
  const totalPx = Math.floor(pixels.length / 4)

  // 采样步进：像素数多时按行列跳采，超过 20000 个采样点则加大步长
  const MAX_SAMPLES = 20000
  let stride = 1
  if (totalPx > MAX_SAMPLES) {
    stride = Math.ceil(Math.sqrt(totalPx / MAX_SAMPLES))
  }

  // 有宽度信息 → 二维采样（行、列都跳 stride），避免一维步进与行宽共振
  const use2D = typeof width === 'number' && width > 0 && totalPx % width === 0
  const height = use2D ? totalPx / width : 0

  const buckets = {}
  let sampled = 0

  const feed = (i) => {
    const a = pixels[i + 3]
    if (a < 125) return
    const key = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4)
    let bkt = buckets[key]
    if (!bkt) {
      buckets[key] = bkt = { r: 0, g: 0, b: 0, n: 0 }
    }
    bkt.r += pixels[i]
    bkt.g += pixels[i + 1]
    bkt.b += pixels[i + 2]
    bkt.n++
    sampled++
  }

  if (use2D) {
    for (let y = 0; y < height; y += stride) {
      const rowOff = y * width * 4
      for (let x = 0; x < width; x += stride) {
        feed(rowOff + x * 4)
      }
    }
  } else {
    for (let i = 0; i < pixels.length; i += stride * 4) {
      feed(i)
    }
  }

  if (!sampled) return []

  // 每个采样点代表的真实像素数，用于还原占比
  const perSample = totalPx / sampled

  const list = Object.keys(buckets)
    .map((k) => {
      const bkt = buckets[k]
      return {
        r: Math.round(bkt.r / bkt.n),
        g: Math.round(bkt.g / bkt.n),
        b: Math.round(bkt.b / bkt.n),
        n: Math.round(bkt.n * perSample)
      }
    })
    .filter((c) => {
      // 过滤接近纯黑/纯白的噪声
      const mx = Math.max(c.r, c.g, c.b)
      const mn = Math.min(c.r, c.g, c.b)
      return mx > 18 && !(mx > 245 && mx - mn < 8)
    })
    .sort((a, b) => b.n - a.n)

  // 合并视觉上过于接近的颜色
  const picked = []
  for (const c of list) {
    const tooClose = picked.some((p) => {
      const d =
        Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b)
      return d < 60
    })
    if (!tooClose) picked.push(c)
    if (picked.length >= n) break
  }

  return picked.map((c) => Object.assign(describe(c.r, c.g, c.b), { weight: c.n }))
}

module.exports = {
  rgbToHex,
  hexToRgb,
  rgbToHsl,
  rgbToHsv,
  rgbToCmyk,
  hslToRgb,
  luminance,
  contrastRatio,
  contrastGrade,
  contrastInfo,
  readableTextColor,
  describe,
  harmonies,
  dominantColors
}
