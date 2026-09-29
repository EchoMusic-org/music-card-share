// 酷狗官方「自然」卡片（模板 id=5）：蓝叶卡纸 + 黑胶露出
module.exports = {
  id: 'kugou-nature',
  name: '自然',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
    this.fg = await ctx.loadDataURL('fg.jpg')
  },

  html(data) {
    const { coverImg, kugouTextHtml, kugouQrHtml } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--kugou-nature">
  <img class="fg" src="${this.fg}" alt="">
  <div class="album">${coverImg({ coverUrl: data.coverUrl }, 'album-img')}</div>
  ${kugouTextHtml({ left: 126, top: 180, size: 48, color: '#1a1c22', alpha: 1, width: 480, text: data.name })}
  ${kugouTextHtml({ left: 126, top: 255, size: 26, color: '#1a1c22', alpha: 0.72, width: 420, bold: false, text: data.artist })}
  ${kugouQrHtml(515, 839, data.qrSvg, 80)}
</div>`
  },
}
