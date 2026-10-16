// app.js
App({
  globalData: {
    // 从取色页"保存到色卡"后暂存，切到色卡页时读取
    pendingColor: null
  },

  onLaunch() {
    // 初始化本地色卡存储
    if (!wx.getStorageSync('picker_palette')) {
      wx.setStorageSync('picker_palette', [])
    }
  }
})
