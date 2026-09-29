// 黑胶唱片卡片模板（封面矩形 + 右侧黑胶唱片露出 + 标题倒影，参考酷狗 ShareMusicCardAlbumView）
module.exports = {
  id: 'vinyl',
  name: '黑胶',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
  },

  html(data) {
    const { escapeHtml, coverStyle, coverImg, brandHtml, textEllipsis } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--vinyl">
  <div class="disc-wrap">
    <div class="disc"><div class="disc-label" style="${coverStyle(data)}"></div></div>
    ${coverImg(data, 'cover')}
  </div>
  <div class="info">
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="artist">${escapeHtml(data.artist)}</div>
    ${data.album ? `<div class="album">专辑 · ${escapeHtml(data.album)}</div>` : ''}
  </div>
  ${brandHtml(data)}
</div>`
  },
}
