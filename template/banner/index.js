// 横幅卡片模板（上半封面大图 + 下半信息区 + 分享署名行）
module.exports = {
  id: 'banner',
  name: '横幅',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
  },

  html(data) {
    const { escapeHtml, coverImg, brandHtml, textEllipsis } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--banner">
  ${coverImg(data, 'cover')}
  <div class="fade"></div>
  <div class="info">
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="artist">${escapeHtml(data.artist)}</div>
    ${data.album ? `<div class="album">${escapeHtml(data.album)}</div>` : ''}
    <div class="sign"><span>来自 EchoMusic 的分享</span><span class="dot"></span><span>${data.dateText}</span></div>
  </div>
  ${brandHtml(data)}
</div>`
  },
}
