// pages/index/index.js
const color = require('../../utils/color.js')

const ZOOM = 8          // 放大镜放大倍数
const MAG_SIZE = 220    // 放大镜尺寸（px，与 wxss 中 220rpx 需换算后一致）

// 图片区高度上限，占视口高度的比例。
// 竖拍照片按原比例铺满宽度会远超一屏，导致下方内容没地方滚，
// 因此限制在半个视口内，保证整图可见且下方始终有充足滚动空间。
const MAX_H_RATIO = 0.5

// 取样范围预设，单位是「显示像素」，都取奇数以保证中心点唯一。
//
// 单像素取色在照片上很脆弱：噪点和 JPEG 压缩伪影会让相邻两次点同一处
// 得到不同色值。取一小块区域求平均能明显稳定结果，代价是遇到边缘时
// 得到的是过渡色而非某一侧的颜色，所以保留「精确」档并默认用中间档。
const SAMPLE_PRESETS = [
  { size: 1, label: '精确', desc: '单像素' },
  { size: 5, label: '标准', desc: '5×5 平均' },
  { size: 11, label: '平滑', desc: '11×11 平均' }
]
const DEFAULT_SAMPLE = 5
const SAMPLE_STORAGE_KEY = 'picker_sample_size'

Page({
  data: {
    imageSrc: '',
    drawing: false,        // 图片解码完成后切到 canvas
    hasPoint: false,
    stageWrapH: 0,         // 图片区包裹层高度(px)
    stageStyle: '',        // 舞台尺寸，恰好等于图片显示尺寸
    canvasStyle: '',       // canvas 尺寸，与舞台一致

    point: { x: 0, y: 0 }, // 选点在显示坐标系下的位置（px）
    current: {
      hex: '#000000', r: 0, g: 0, b: 0,
      hslStr: '', hsvStr: '', cmykStr: '',
      textColor: '#FFFFFF', coordText: '0, 0',
      contrast: null
    },

    // 取样范围
    sampleSize: DEFAULT_SAMPLE,
    sampleList: SAMPLE_PRESETS,
    sampleBoxStyle: '',   // 取样方框的内联样式（跟随 sampleSize）
    sampleHint: '',       // 区域均匀度的定性提示

    formatList: [],
    harmonyList: [],
    dominantList: [],

    magnifier: {
      show: false,
      x: 0, y: 0,
      bg: '',
      zoomW: 0, zoomH: 0,
      offsetX: 0, offsetY: 0
    }
  },

  // ---- 非响应式内部状态 ----
  _imgSize: null,    // 图片信息 {width,height,orientation,path}，来自 wx.getImageInfo
  _canvas: null,     // canvas 节点
  _ctx: null,
  _dpr: 1,
  _dispW: 0,         // 显示宽度(px)
  _dispH: 0,         // 显示高度(px)
  _stageRect: null,  // 舞台在视口中的位置
  _raf: null,        // 取色节流定时器
  _pendingPos: null,
  _magSize: 110,     // 放大镜尺寸(px)，onLoad 中按屏幕宽度换算
  _longPressTimer: undefined,
  _longPressActive: false,
  _touchMoved: false,
  _loading: false,   // loading 遮罩是否处于显示状态（用于幂等关闭）
  _initing: false,   // canvas 是否正在初始化，防止重复触发
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this._dpr = info.pixelRatio || 2
    this._winW = info.windowWidth
    this._winH = info.windowHeight
    this._maxH = Math.round(info.windowHeight * MAX_H_RATIO)
    // 220rpx → px
    this._magSize = (info.windowWidth / 750) * MAG_SIZE

    // 恢复上次选的取样范围；值不合法（首次进入或存储被改坏）时用默认档
    let size = DEFAULT_SAMPLE
    try {
      const saved = Number(wx.getStorageSync(SAMPLE_STORAGE_KEY))
      if (SAMPLE_PRESETS.some((p) => p.size === saved)) size = saved
    } catch (err) {
      // 存储读取失败不影响主流程，用默认值即可
    }

    // 先给包裹层一个高度，避免首帧布局跳动
    this.setData({
      stageWrapH: this._maxH,
      sampleSize: size,
      sampleBoxStyle: this.buildSampleBoxStyle(size)
    })
  },

  onUnload() {
    if (this._raf) clearTimeout(this._raf)
    clearTimeout(this._longPressTimer)
  },

  // 从其他页面切回来时布局可能变化，重新测量一次舞台位置
  onShow() {
    if (this._canvas) setTimeout(() => this.updateStageRect(), 60)
  },

  /* ==================== 图片来源 ==================== */

  onTakePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      sizeType: ['original'],
      success: (res) => {
        const f = res.tempFiles[0]
        if (f.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '图片超过 10MB', icon: 'none' })
          return
        }
        this.loadImage(f.tempFilePath)
      },
      fail: (err) => this.handleChooseFail(err)
    })
  },

  onChooseAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (res) => {
        const f = res.tempFiles[0]
        if (f.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '图片超过 10MB', icon: 'none' })
          return
        }
        this.loadImage(f.tempFilePath)
      },
      fail: (err) => this.handleChooseFail(err)
    })
  },

  handleChooseFail(err) {
    const msg = (err && err.errMsg) || ''
    if (msg.indexOf('cancel') > -1) return
    if (msg.indexOf('auth') > -1 || msg.indexOf('permission') > -1) {
      wx.showModal({
        title: '需要授权',
        content: '请在设置中允许使用相机/相册',
        confirmText: '去设置',
        success: (r) => { if (r.confirm) wx.openSetting() }
      })
      return
    }
    wx.showToast({ title: '获取图片失败', icon: 'none' })
  },

  /**
   * 获取图片信息并进入取色流程。
   * 用 wx.getImageInfo 获取原始宽高与拍摄方向（小程序 API，
   * 注意 wx.createImage 是「小游戏」专属，小程序中不可用）。
   */
  loadImage(src) {
    // 先清掉可能残留的 loading，避免多个遮罩叠加
    this.endLoading()
    this._loading = true
    wx.showLoading({ title: '加载中', mask: true })

    this._canvas = null
    this._ctx = null
    this._imgSize = null
    this._dispW = 0
    this._dispH = 0
    this.setData({
      imageSrc: src,
      drawing: false,
      hasPoint: false,
      stageWrapH: this._maxH,   // 新图尺寸未知，先占满上限高度
      stageStyle: '',
      canvasStyle: ''
    })

    if (!wx.getImageInfo) {
      this.endLoading()
      wx.showToast({ title: '当前基础库不支持，请升级微信', icon: 'none' })
      return
    }

    wx.getImageInfo({
      src,
      success: (res) => {
        if (!res.width || !res.height) {
          this.endLoading()
          wx.showToast({ title: '无法读取图片尺寸', icon: 'none' })
          return
        }

        // 竖拍照片通常带 Exif 旋转标记，res.width/height 是旋转前的尺寸，
        // 需按 orientation 交换宽高，才能得到正确的显示宽高比。
        const rotated =
          res.orientation === 'left' ||
          res.orientation === 'right' ||
          res.orientation === 'left-mirrored' ||
          res.orientation === 'right-mirrored'

        this._imgSize = {
          width: rotated ? res.height : res.width,
          height: rotated ? res.width : res.height,
          orientation: res.orientation || 'up',
          rawWidth: res.width,
          rawHeight: res.height,
          path: res.path || src
        }

        this.setData({ drawing: true })
        wx.nextTick(() => {
          setTimeout(() => this.initCanvas(), 60)
        })
      },
      fail: (err) => {
        console.error('[colorPicker] getImageInfo failed', err)
        this._imgSize = null
        this.endLoading()
        const msg = (err && err.errMsg) || ''
        wx.showToast({
          title: msg.indexOf('domain') > -1
            ? '网络图片需配置下载域名'
            : '图片加载失败，请重试',
          icon: 'none'
        })
        this.setData({ imageSrc: '' })
      }
    })
  },

  /* ==================== 初始化 canvas ==================== */

  initCanvas(retry) {
    const n = retry || 0
    if (n > 10) {
      this.endLoading()
      wx.showToast({ title: '画布初始化失败，请重试', icon: 'none' })
      return
    }

    // 图片尺寸未知则等待后重试
    if (!this._imgSize || !this._imgSize.width) {
      setTimeout(() => this.initCanvas(n + 1), 100)
      return
    }

    // 用包裹层 #stageWrap 的宽度作为可用宽度。
    // 它的宽度由 CSS 决定、与图片无关，因此不会出现
    // 「canvas 宽度取决于 canvasStyle，而 canvasStyle 又要等宽度算完」的循环依赖。
    wx.createSelectorQuery()
      .select('#stageWrap')
      .boundingClientRect((rect) => {
        const availW = Math.round(rect && rect.width ? rect.width : 0)

        if (!availW) {
          setTimeout(() => this.initCanvas(n + 1), 100)
          return
        }

        // 等比缩放：宽度不超可用宽度，高度不超视口的 MAX_H_RATIO。
        // 竖拍照片按原比例铺满宽度会远超一屏，必须限高。
        const imgW = this._imgSize.width
        const imgH = this._imgSize.height
        const scale = Math.min(availW / imgW, this._maxH / imgH)
        const dispW = Math.max(1, Math.round(imgW * scale))
        const dispH = Math.max(1, Math.round(imgH * scale))

        this._dispW = dispW
        this._dispH = dispH

        const sizeStyle = `width:${dispW}px;height:${dispH}px;`
        this.setData({
          stageWrapH: dispH,
          stageStyle: sizeStyle,
          canvasStyle: sizeStyle
        })

        // 等新尺寸生效、canvas 节点渲染出来后再取节点
        wx.nextTick(() => {
          setTimeout(() => this.bindCanvasNode(dispW, dispH, n), 40)
        })
      })
      .exec()
  },

  /** 取到 canvas 节点并把图片绘制上去 */
  bindCanvasNode(dispW, dispH, n) {
    wx.createSelectorQuery()
      .select('#pickerCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          setTimeout(() => this.initCanvas(n + 1), 100)
          return
        }

        const node = res[0].node

        // 用 canvas 节点自带的 createImage 加载绘制源。
        // 这是 type="2d" 的 canvas 绘制图片的标准做法。
        if (typeof node.createImage !== 'function') {
          this.endLoading()
          wx.showToast({ title: 'canvas 不支持绘制图片', icon: 'none' })
          console.error('[colorPicker] node.createImage 不可用')
          return
        }

        const img = node.createImage()
        img.onload = () => {
          try {
            this.setupCanvas(node, img, dispW, dispH)
          } catch (err) {
            this.endLoading()
            wx.showToast({ title: '画布初始化失败', icon: 'none' })
            console.error('[colorPicker] setupCanvas failed', err)
          }
        }
        img.onerror = (err) => {
          this.endLoading()
          wx.showToast({ title: '图片绘制失败，请重试', icon: 'none' })
          console.error('[colorPicker] image load failed', err)
        }
        img.src = this._imgSize.path
      })
  },

  /** 用确定的显示尺寸配置 canvas 并完成首次绘制 */
  setupCanvas(node, img, dispW, dispH) {
    const ctx = node.getContext('2d')
    const dpr = this._dpr

    // 后备缓冲用物理像素，保证取色清晰度与准确度
    node.width = Math.round(dispW * dpr)
    node.height = Math.round(dispH * dpr)

    this._canvas = node
    this._ctx = ctx

    ctx.scale(dpr, dpr)

    // 按 Exif 方向绘制，保证竖拍照片方向正确
    this.drawOriented(ctx, img, dispW, dispH)

    // 等布局稳定后测量舞台位置。
    // 页面此时固定不滚动，测一次即可长期有效。
    setTimeout(() => {
      this.updateStageRect()

      const cx = Math.round(dispW / 2)
      const cy = Math.round(dispH / 2)
      this.sampleAt(cx, cy, false)

      let dominant = []
      try {
        dominant = this.extractDominant()
      } catch (err) {
        console.error('[colorPicker] extractDominant failed', err)
      }

      this.setData({ dominantList: dominant })
      this.endLoading()
    }, 120)
  },

  /**
   * 按 Exif 方向把图片绘制到 targetW × targetH 的区域。
   * 手机竖拍的照片常带旋转标记，直接绘制会导致方向错误。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Image} img canvas.createImage() 得到的图像源
   * @param {number} targetW 目标显示宽(px)
   * @param {number} targetH 目标显示高(px)
   */
  drawOriented(ctx, img, targetW, targetH) {
    const o = (this._imgSize && this._imgSize.orientation) || 'up'
    const w = targetW
    const h = targetH

    ctx.save()

    switch (o) {
      case 'right':
        // 顺时针 90°：先平移再旋转
        ctx.translate(w, 0)
        ctx.rotate(Math.PI / 2)
        ctx.drawImage(img, 0, 0, h, w)
        break
      case 'left':
        // 逆时针 90°
        ctx.translate(0, h)
        ctx.rotate(-Math.PI / 2)
        ctx.drawImage(img, 0, 0, h, w)
        break
      case 'down':
        // 旋转 180°
        ctx.translate(w, h)
        ctx.rotate(Math.PI)
        ctx.drawImage(img, 0, 0, w, h)
        break
      case 'up-mirrored':
        ctx.translate(w, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0, w, h)
        break
      case 'down-mirrored':
        ctx.translate(w, h)
        ctx.scale(-1, -1)
        ctx.drawImage(img, 0, 0, w, h)
        break
      case 'left-mirrored':
        ctx.translate(0, h)
        ctx.rotate(-Math.PI / 2)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0, h, w)
        break
      case 'right-mirrored':
        ctx.translate(w, 0)
        ctx.rotate(Math.PI / 2)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0, h, w)
        break
      default:
        // 'up' 或未知：不旋转
        ctx.drawImage(img, 0, 0, w, h)
    }

    ctx.restore()
  },

  /**
   * 统一关闭加载提示。
   * showLoading 可能被重复调用，hideLoading 需同样数量才生效，
   * 因此这里做幂等处理，避免残留 loading 遮罩。
   */
  endLoading() {
    if (this._loading) {
      wx.hideLoading()
      this._loading = false
    }
  },

  updateStageRect() {
    wx.createSelectorQuery()
      .select('#stage')
      .boundingClientRect((rect) => {
        if (rect) this._stageRect = rect
      })
      .exec()
  },

  onImageLoad() {
    // 兜底：<image> 渲染完成但 canvas 尚未初始化时补一次。
    // 用 _initing 防止与 getImageInfo 成功后的路径重复初始化。
    if (!this._canvas && this._imgSize && !this._initing) {
      this._initing = true
      setTimeout(() => {
        this._initing = false
        if (!this._canvas) this.initCanvas()
      }, 60)
    }
  },

  /* ==================== 触摸交互 ==================== */

  /**
   * 触摸点 → 舞台内局部坐标。
   *
   * Touch 对象只有 clientX/clientY（相对视口）和 pageX/pageY（相对页面），
   * **没有**相对元素的坐标，所以必须减去舞台在视口中的位置。
   * 页面在有图状态下固定不滚动，因此 _stageRect 测一次即可长期有效。
   */
  getLocalPoint(t) {
    const rect = this._stageRect
    if (!rect) return null
    const vx = t.clientX != null ? t.clientX : t.pageX
    const vy = t.clientY != null ? t.clientY : t.pageY
    return {
      x: Math.max(0, Math.min(this._dispW - 1, vx - rect.left)),
      y: Math.max(0, Math.min(this._dispH - 1, vy - rect.top))
    }
  },

  onTouchStart(e) {
    const t = e.touches[0]
    const p = this.getLocalPoint(t)
    if (!p) return

    this._longPressActive = false
    this._touchMoved = false

    // 长按 180ms 进入放大镜精调模式
    this._longPressTimer = setTimeout(() => {
      this._longPressActive = true
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
      this.showMagnifier(p.x, p.y)
    }, 180)

    this.sampleAt(p.x, p.y)
  },

  onTouchMove(e) {
    const t = e.touches[0]
    const p = this.getLocalPoint(t)
    if (!p) return
    this._touchMoved = true

    if (this._longPressActive) {
      // 放大镜模式：拖动精调
      this.scheduleSample(p.x, p.y, true)
    } else if (this._touchMoved) {
      // 快速滑动：取消长按计时，纯跟随取色（不弹放大镜）
      clearTimeout(this._longPressTimer)
      this._longPressTimer = undefined
      this.scheduleSample(p.x, p.y, false)
    }
  },

  onTouchEnd() {
    clearTimeout(this._longPressTimer)
    this._longPressTimer = undefined
    this._longPressActive = false
    this._touchMoved = false
    if (this.data.magnifier.show) {
      this.setData({ 'magnifier.show': false })
    }
  },

  /* ==================== 放大镜 ==================== */

  showMagnifier(x, y) {
    if (this.data.magnifier.bg !== this.data.imageSrc) {
      this.setData({
        'magnifier.bg': this.data.imageSrc,
        'magnifier.zoomW': this._dispW * ZOOM,
        'magnifier.zoomH': this._dispH * ZOOM
      })
    }
    this.updateMagnifierPos(x, y)
    this.setData({ 'magnifier.show': true })
  },

  /**
   * 更新放大镜位置与取景偏移。
   * magnifier 为 fixed 定位，需使用视口坐标；
   * x/y 是相对舞台的局部坐标，此处加上舞台偏移换算。
   */
  updateMagnifierPos(x, y) {
    const rect = this._stageRect
    if (!rect) return

    const size = this._magSize
    const half = size / 2

    // 局部坐标 → 视口坐标
    const vpX = rect.left + x
    const vpY = rect.top + y

    // 默认浮在触点左上方，避免手指遮挡；靠近边缘时自动翻转/收敛
    let mx = vpX - half
    let my = vpY - size - 28

    if (my < 8) my = vpY + 44          // 顶部空间不足 → 移到触点下方

    const minX = 8
    const maxX = (this._winW || rect.width) - size - 8
    if (mx < minX) mx = minX
    if (mx > maxX) mx = Math.max(minX, maxX)

    const maxY = (this._winH || rect.height) - size - 8
    if (my > maxY) my = Math.max(8, maxY)

    // 取景偏移：让放大镜圆心对准触点
    this.setData({
      'magnifier.x': mx,
      'magnifier.y': my,
      'magnifier.offsetX': x * ZOOM - half,
      'magnifier.offsetY': y * ZOOM - half
    })
  },

  /* ==================== 取色 ==================== */

  /**
   * 节流采样，避免 move 高频 setData
   * @param {number} x
   * @param {number} y
   * @param {boolean} withHarmony 是否同步重算配色方案
   */
  scheduleSample(x, y, withHarmony) {
    this._pendingPos = { x, y }
    this._pendingHarmony = !!withHarmony
    if (this._raf) return
    this._raf = setTimeout(() => {
      this._raf = null
      const p = this._pendingPos
      if (p) {
        this.sampleAt(p.x, p.y, !this._pendingHarmony)
        if (this.data.magnifier.show) this.updateMagnifierPos(p.x, p.y)
      }
    }, 40)
  },

  /**
   * 读取以 (x,y) 为中心、边长 sampleSize 的方形区域，返回平均色。
   *
   * 坐标约定：选点落在显示像素 floor(x), floor(y) 上，以这一个显示像素
   * 为中心取 sampleSize×sampleSize 个显示像素。
   * 之所以不用「把选点当几何中心」，是因为那样在 dpr>1 时会产生半像素
   * 偏移 —— dpr=3 时「精确」档会横跨两个显示像素，取到两个像素的混色。
   * 按显示像素对齐后，size=1 恰好是那一个显示像素（dpr×dpr 个物理像素），
   * 任何 dpr 下都无歧义。
   *
   * getImageData 工作在画布后备缓冲（物理像素）坐标系，不受
   * ctx.scale(dpr, dpr) 影响，所以这里乘 dpr 换算到物理像素。
   *
   * @param {number} x 显示坐标(px)
   * @param {number} y 显示坐标(px)
   * @returns {{r:number,g:number,b:number,pixels:number,spread:number}|null}
   */
  sampleRegion(x, y) {
    const ctx = this._ctx
    const canvas = this._canvas
    if (!ctx || !canvas) return null

    const dpr = this._dpr
    const size = this.data.sampleSize

    // size 只会是 SAMPLE_PRESETS 里的奇数，这里兜一下底，
    // 保证 half 是整数，区域不会出现半像素偏移。
    const half = Math.floor((size - 1) / 2)
    const x0 = Math.floor(x) - half
    const y0 = Math.floor(y) - half

    const side = size * dpr
    // 贴边时把区域整体拉回画布内，保证取样块始终完整
    const px = Math.max(0, Math.min(canvas.width - side, x0 * dpr))
    const py = Math.max(0, Math.min(canvas.height - side, y0 * dpr))

    let data
    try {
      data = ctx.getImageData(px, py, side, side).data
    } catch (err) {
      return null
    }

    // 第一遍：求各通道均值，顺带累加近似亮度
    let sr = 0, sg = 0, sb = 0, lumaSum = 0, n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue   // 全透明像素不参与
      const r0 = data[i], g0 = data[i + 1], b0 = data[i + 2]
      sr += r0
      sg += g0
      sb += b0
      lumaSum += (r0 * 299 + g0 * 587 + b0 * 114) / 1000
      n++
    }
    if (!n) return null

    const r = Math.round(sr / n)
    const g = Math.round(sg / n)
    const b = Math.round(sb / n)
    const lumaMean = lumaSum / n

    // 第二遍：亮度标准差，用来判断这块区域是不是「平」的。
    // 离散度大说明区域里有花纹或边缘，此时拿到的是平均色而非某处的颜色，
    // 这个信号比单纯给个色值更能帮用户判断该不该信任结果。
    let varSum = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue
      const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      const d = luma - lumaMean
      varSum += d * d
    }

    return { r, g, b, pixels: n, spread: Math.sqrt(varSum / n) }
  },

  /** 取样方框的内联样式：以选点为几何中心，边长等于取样范围 */
  buildSampleBoxStyle(size) {
    const half = size / 2
    return `left:${-half}px;top:${-half}px;width:${size}px;height:${size}px;`
  },

  /** 按区域离散度给出一句定性说明 */
  describeSample(size, spread) {
    if (size <= 1) return '单像素取样，适合取细小色块'
    if (spread < 4) return '区域颜色很均匀，平均色可靠'
    if (spread < 15) return '区域基本均匀，平均色可用'
    return '区域内有花纹或边缘，取到的是平均色'
  },

  /** 色值格式列表 */
  buildFormatList(info) {
    return [
      { key: 'hex', label: 'HEX', value: info.hex },
      { key: 'rgb', label: 'RGB', value: info.rgbStr },
      { key: 'hsl', label: 'HSL', value: info.hslStr },
      { key: 'hsv', label: 'HSV', value: info.hsvStr },
      { key: 'cmyk', label: 'CMYK', value: info.cmykStr }
    ]
  },

  /** 取样并更新当前颜色 */
  sampleAt(x, y, silent) {
    const s = this.sampleRegion(x, y)
    if (!s) return

    const info = color.describe(s.r, s.g, s.b)
    info.coordText = `${Math.round(x)}, ${Math.round(y)}`

    const patch = {
      hasPoint: true,
      point: { x, y },
      current: Object.assign({}, this.data.current, info),
      sampleHint: this.describeSample(this.data.sampleSize, s.spread),
      formatList: this.buildFormatList(info)
    }

    // 拖动放大镜时 silent=true，跳过配色重算以降低开销
    if (!silent) {
      Object.assign(patch, this.buildHarmonyList(s.r, s.g, s.b))
    }

    this.setData(patch)
  },

  /** 切换取样范围，并立即用当前选点重新采样 */
  onPickSample(e) {
    const size = Number(e.currentTarget.dataset.size)
    if (!size || size === this.data.sampleSize) return

    this.setData({
      sampleSize: size,
      sampleBoxStyle: this.buildSampleBoxStyle(size)
    })

    try {
      wx.setStorageSync(SAMPLE_STORAGE_KEY, size)
    } catch (err) {
      // 存储失败只影响下次进入时的记忆，不影响本次取色
    }

    if (this.data.hasPoint) {
      this.sampleAt(this.data.point.x, this.data.point.y, false)
    }
  },

  /** 统计图片主色 */
  extractDominant() {
    if (!this._ctx) return []
    let imgData
    try {
      imgData = this._ctx.getImageData(
        0, 0,
        this._canvas.width,
        this._canvas.height
      )
    } catch (err) {
      return []
    }

    const list = color.dominantColors(
      imgData.data,
      5,
      this._canvas.width
    )
    const total = list.reduce((s, c) => s + (c.weight || 0), 0) || 1
    return list.map((c) => ({
      hex: c.hex,
      r: c.r, g: c.g, b: c.b,
      textColor: c.textColor,
      percent: Math.max(1, Math.round(((c.weight || 0) / total) * 100))
    }))
  },

  /* ==================== 复制 / 保存 ==================== */

  /**
   * 复制文本到剪贴板。
   *
   * wx.setClipboardData 自带一个「内容已复制」提示，这里统一换成带内容的
   * 提示，让用户明确知道复制到的是什么；失败时也要给反馈，否则用户会以为
   * 已经复制成功了。
   *
   * @param {string} text 要复制的内容
   * @param {string} [tip] 自定义提示文案，默认「已复制 <内容>」
   */
  copyText(text, tip) {
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: tip || ('已复制 ' + text), icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    })
  },

  onCopy(e) {
    const key = e.currentTarget.dataset.key
    const cur = this.data.current
    const map = {
      hex: cur.hex,
      rgb: cur.rgbStr,
      hsl: cur.hslStr,
      hsv: cur.hsvStr,
      cmyk: cur.cmykStr
    }
    this.copyText(map[key] || cur.hex)
  },

  onSaveColor() {
    const cur = this.data.current
    const list = wx.getStorageSync('picker_palette') || []
    const dup = list.some((c) => c.hex === cur.hex)
    if (dup) {
      wx.showToast({ title: '该颜色已存在', icon: 'none' })
      return
    }

    list.unshift({
      hex: cur.hex,
      r: cur.r, g: cur.g, b: cur.b,
      name: '',
      note: '来自图片取色',
      time: Date.now()
    })
    wx.setStorageSync('picker_palette', list)
    wx.showToast({ title: '已存入色卡', icon: 'success' })
  },

  /** 构建配色方案列表（计算量较大，拖动时跳过） */
  buildHarmonyList(r, g, b) {
    return {
      harmonyList: color.harmonies(r, g, b).map((h) => ({
        name: h.name,
        desc: h.desc,
        colors: h.colors.map((hex) => {
          const c = color.hexToRgb(hex)
          return { hex, textColor: color.readableTextColor(c.r, c.g, c.b) }
        })
      }))
    }
  },

  /** 由 HEX 构建完整颜色显示数据 */
  buildColorPatch(r, g, b, coordText) {
    const info = color.describe(r, g, b)
    info.coordText = coordText
    return Object.assign(
      {
        current: Object.assign({}, this.data.current, info),
        formatList: this.buildFormatList(info)
      },
      this.buildHarmonyList(r, g, b)
    )
  },

  /**
   * 点击配色 / 主色中的色块 → 设为当前颜色，并把色值复制到剪贴板。
   *
   * 这两处都是「看一眼就想拿去用」的场景，选色和复制基本同时发生，
   * 所以合成一步。要单独复制其它格式仍走上面的「色值格式」列表。
   */
  applyHex(hex, coordText) {
    const rgb = color.hexToRgb(hex)
    this.setData(this.buildColorPatch(rgb.r, rgb.g, rgb.b, coordText || '配色'))
    this.copyText(hex)
  },

  onPickHarmony(e) {
    this.applyHex(e.currentTarget.dataset.hex, '配色')
  },

  onPickDominant(e) {
    const item = this.data.dominantList[e.currentTarget.dataset.index]
    if (!item) return
    this.applyHex(item.hex, '主色')
  }
})
