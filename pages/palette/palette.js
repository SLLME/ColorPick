// pages/palette/palette.js
const color = require('../../utils/color.js')

/** 构建详情弹层需要的数据 */
function buildDetail(item) {
  const rgb = { r: item.r, g: item.g, b: item.b }
  const info = color.describe(rgb.r, rgb.g, rgb.b)

  const formats = [
    { key: 'hex', label: 'HEX', value: info.hex },
    { key: 'rgb', label: 'RGB', value: info.rgbStr },
    { key: 'hsl', label: 'HSL', value: info.hslStr },
    { key: 'hsv', label: 'HSV', value: info.hsvStr },
    { key: 'cmyk', label: 'CMYK', value: info.cmykStr }
  ]

  const harmonies = color.harmonies(rgb.r, rgb.g, rgb.b).map((h) => ({
    name: h.name,
    desc: h.desc,
    colors: h.colors.map((hex) => {
      const c = color.hexToRgb(hex)
      return { hex, textColor: color.readableTextColor(c.r, c.g, c.b) }
    })
  }))

  return Object.assign({}, item, info, {
    harmonies,
    _formats: formats
  })
}

Page({
  data: {
    list: [],
    detail: null,
    detailFormats: []
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const raw = wx.getStorageSync('picker_palette') || []
    const list = raw.map((item) => {
      const info = color.describe(item.r, item.g, item.b)
      return Object.assign({}, item, {
        textColor: info.textColor,
        rgbStr: info.rgbStr
      })
    })
    this.setData({ list })

    // 详情打开中则同步刷新
    if (this.data.detail) {
      const found = list.find((c) => c.hex === this.data.detail.hex)
      if (found) this.openDetail(found, true)
      else this.setData({ detail: null })
    }
  },

  save(list) {
    wx.setStorageSync('picker_palette', list)
  },

  /* ---------- 详情 ---------- */

  onShowDetail(e) {
    const item = this.data.list[e.currentTarget.dataset.index]
    if (!item) return
    this.openDetail(item)
  },

  openDetail(item, silent) {
    const d = buildDetail(item)
    this.setData({
      detail: d,
      detailFormats: d._formats
    })
    if (!silent) wx.vibrateShort && wx.vibrateShort({ type: 'light' })
  },

  closeDetail() {
    this.setData({ detail: null })
  },

  noop() {},

  onNameInput(e) {
    const value = e.detail.value
    const d = this.data.detail
    if (!d) return

    // 实时写回内存中的 detail
    d.name = value
    this.setData({ detail: d })

    // 同步持久化
    const list = this.data.list.map((c) =>
      c.hex === d.hex ? Object.assign({}, c, { name: value }) : c
    )
    this.setData({ list })
    this.save(
      list.map((c) => ({
        hex: c.hex, r: c.r, g: c.g, b: c.b,
        name: c.name, note: c.note, time: c.time
      }))
    )
  },

  onSaveName() {
    this.closeDetail()
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  onCopyOne(e) {
    const key = e.currentTarget.dataset.key
    const fmt = this.data.detailFormats.find((f) => f.key === key)
    if (!fmt) return
    wx.setClipboardData({
      data: fmt.value,
      success: () => wx.showToast({ title: '已复制 ' + fmt.value, icon: 'none' })
    })
  },

  onCopyDetail() {
    const d = this.data.detail
    if (!d) return
    const text = `${d.hex}  ${d.rgbStr}  ${d.hslStr}`
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制色值', icon: 'none' })
    })
  },

  /** 从配色里点某个颜色 → 直接加进色卡 */
  onAddFromHarmony(e) {
    const hex = e.currentTarget.dataset.hex
    this.addColor(hex)
  },

  addColor(hex) {
    const rgb = color.hexToRgb(hex)
    const list = this.data.list
    if (list.some((c) => c.hex === hex)) {
      wx.showToast({ title: '已存在', icon: 'none' })
      return
    }
    const raw = wx.getStorageSync('picker_palette') || []
    raw.unshift({
      hex,
      r: rgb.r, g: rgb.g, b: rgb.b,
      name: '',
      note: '来自配色推荐',
      time: Date.now()
    })
    this.save(raw)
    this.refresh()
    wx.showToast({ title: '已添加 ' + hex, icon: 'none' })
  },

  /* ---------- 删除 / 清空 ---------- */

  onDelete(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.list[index]
    if (!item) return

    wx.showModal({
      title: '删除颜色',
      content: `确定删除 ${item.hex} 吗？`,
      confirmColor: '#FF5A3C',
      success: (r) => {
        if (!r.confirm) return
        const raw = (wx.getStorageSync('picker_palette') || []).filter(
          (c) => c.hex !== item.hex
        )
        this.save(raw)
        if (this.data.detail && this.data.detail.hex === item.hex) {
          this.setData({ detail: null })
        }
        this.refresh()
        wx.showToast({ title: '已删除', icon: 'none' })
      }
    })
  },

  clearAll() {
    wx.showModal({
      title: '清空色卡',
      content: '将删除全部收藏颜色，此操作不可恢复',
      confirmColor: '#FF5A3C',
      success: (r) => {
        if (!r.confirm) return
        this.save([])
        this.setData({ detail: null })
        this.refresh()
        wx.showToast({ title: '已清空', icon: 'none' })
      }
    })
  },

  exportAll() {
    const list = this.data.list
    if (!list.length) return
    const text = list
      .map((c) => {
        const info = color.describe(c.r, c.g, c.b)
        const label = c.name ? `${c.name}\t` : ''
        return `${label}${info.hex}\t${info.rgbStr}\t${info.hslStr}`
      })
      .join('\n')

    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '已导出',
          content: `已复制 ${list.length} 个颜色（HEX / RGB / HSL）到剪贴板，可直接粘贴到表格`,
          showCancel: false
        })
      }
    })
  },

  goPicker() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
