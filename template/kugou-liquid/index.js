// 酷狗官方「液态玻璃」卡片（musicphoto/v1/share/template id=6）
// 前景素材为整幅预渲染玻璃面板背景，动态元素按 json_str 坐标叠加
module.exports = {
  id: 'kugou-liquid',
  name: '液态玻璃',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
    this.fg = await ctx.loadDataURL('fg.jpg')
  },

  html(data) {
    const { coverImg, kugouTextHtml, kugouQrHtml } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--kugou-liquid">
  <img class="fg" src="${this.fg}" alt="">
  <div class="album">${coverImg({ coverUrl: data.coverUrl }, 'album-img')}</div>
  ${kugouTextHtml({ left: 122, top: 620, size: 34, color: '#ffffff', alpha: 1, width: 470, text: data.name })}
  ${kugouTextHtml({ left: 122, top: 674, size: 25, color: '#ffffff', alpha: 0.62, width: 470, bold: false, text: data.artist })}
  ${kugouQrHtml(572, 1007, data.qrSvg, 86)}
</div>`
  },
}
