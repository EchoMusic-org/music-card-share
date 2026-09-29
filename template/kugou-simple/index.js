// 酷狗官方「简洁卡片」（模板 id=1）：白底封面模糊 + 透明卡壳素材
module.exports = {
  id: 'kugou-simple',
  name: '简洁卡片',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
    this.fg = await ctx.loadDataURL('fg.png')
  },

  html(data) {
    const { coverImg, coverStyle, kugouTextHtml, kugouQrHtml } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--kugou-simple">
  <div class="blur" style="${coverStyle(data)}"></div>
  <img class="fg" src="${this.fg}" alt="">
  <div class="album">${coverImg({ coverUrl: data.coverUrl }, 'album-img')}</div>
  ${kugouTextHtml({ left: null, top: 112, size: 50, color: '#141519', alpha: 1, align: 'center', text: data.name })}
  ${kugouTextHtml({ left: null, top: 192, size: 36, color: '#141519', alpha: 0.85, align: 'center', bold: false, text: data.artist })}
  ${kugouTextHtml({ left: null, top: 852, size: 27, color: '#141519', alpha: 0.6, align: 'center', text: '来自 EchoMusic 的分享' })}
  ${kugouQrHtml(582, 991, data.qrSvg, 88)}
</div>`
  },
}
