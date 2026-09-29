// 信笺卡片模板（米白双线框 + 衬线排版 + 日期，参考酷狗歌词海报信笺款）
module.exports = {
  id: 'letter',
  name: '信笺',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
  },

  html(data) {
    const { escapeHtml, coverStyle, brandHtml } = this.helpers
    const snippet = data.snippet || '把这首歌分享给你，愿它恰好唱中你的心情。'
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--letter">
  <div class="frame">
    <div class="kicker">NOW PLAYING</div>
    <div class="date">${data.dateText}</div>
    <div class="orn">♪ ♪ ♪</div>
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="artist">${escapeHtml(data.artist)}</div>
    <div class="divider"></div>
    <div class="snippet">${escapeHtml(snippet)}</div>
    <div class="cover-mini" style="${coverStyle(data)}"></div>
    ${brandHtml(data)}
  </div>
</div>`
  },
}
