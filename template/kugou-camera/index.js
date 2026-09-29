// 酷狗官方「相机」卡片（模板 id=4）：拍立得出纸窗口叠封面
module.exports = {
  id: 'kugou-camera',
  name: '相机',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
    // 清除底部"酷狗音乐"品牌行
    this.fg = await ctx.loadDataURL('fg.jpg')
  },

  html(data) {
    const { coverImg, kugouTextHtml, kugouQrHtml } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--kugou-camera">
  <img class="fg" src="${this.fg}" alt="">
  <div class="album">${coverImg({ coverUrl: data.coverUrl }, 'album-img')}</div>
  ${kugouTextHtml({ left: 50, top: 787, size: 50, color: '#ffffff', alpha: 1, width: 580, text: data.name })}
  ${kugouTextHtml({ left: 50, top: 872, size: 32, color: '#ffffff', alpha: 0.8, width: 580, bold: false, text: data.artist })}
  ${kugouQrHtml(590, 989, data.qrSvg, 86)}
</div>`
  },
}
