// 酷狗官方「播放器」卡片（模板 id=3）：黑胶唱机 + 圆形封面嵌入
module.exports = {
  id: 'kugou-player',
  name: '播放器',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
    // 清除底部"酷狗音乐"品牌行
    this.fg = await ctx.loadDataURL('fg.png')
  },

  html(data) {
    const { kugouTextHtml, kugouQrHtml } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--kugou-player">
  <img class="album" src="${data.coverUrl}" referrerpolicy="no-referrer" alt="">
  <img class="fg" src="${this.fg}" alt="">
  ${kugouTextHtml({ left: null, top: 701, size: 50, color: '#ffffff', alpha: 1, align: 'center', text: data.name })}
  ${kugouTextHtml({ left: null, top: 781, size: 36, color: '#ffffff', alpha: 0.85, align: 'center', bold: false, text: data.artist })}
  ${kugouTextHtml({ left: null, top: 865, size: 28, color: '#ffffff', alpha: 0.6, align: 'center', text: '来自 EchoMusic 的分享' })}
  ${kugouQrHtml(582, 993, data.qrSvg, 88)}
</div>`
  },
}
