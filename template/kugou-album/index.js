// 酷狗官方「实体专辑」卡片（模板 id=2）：CD 盒半透明壳叠在封面上（above_album）
module.exports = {
  id: 'kugou-album',
  name: '实体专辑',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
    // 清除底部"酷狗音乐"品牌行
    this.fg = await ctx.loadDataURL('fg.png')
  },

  html(data) {
    const { kugouTextHtml, kugouQrHtml } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--kugou-album">
  <img class="album" src="${data.coverUrl}" referrerpolicy="no-referrer" alt="">
  <img class="fg" src="${this.fg}" alt="">
  ${kugouTextHtml({ left: 51, top: 115, size: 50, color: '#ffffff', alpha: 1, width: 600, text: data.name })}
  ${kugouTextHtml({ left: 51, top: 195, size: 36, color: '#ffffff', alpha: 0.85, width: 600, bold: false, text: data.artist })}
  ${kugouTextHtml({ left: 50, top: 804, size: 28, color: '#ffffff', alpha: 0.8, width: 500, text: '来自 EchoMusic 的分享' })}
  ${kugouQrHtml(590, 993, data.qrSvg, 88)}
</div>`
  },
}
